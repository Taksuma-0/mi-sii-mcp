import { createHash } from 'node:crypto';
import type { ColumnaCartola, CriterioConciliacion, MapeoColumnas, MovimientoBancario, MovimientoLeido, TipoPartida } from '../domain/banco.js';
import { ErrorMiSiiMcp } from '../domain/errores.js';
import { declaracionVigente } from '../domain/f29.js';
import { diasEntre, fechaEnSantiago, sumarDias } from '../domain/fechas.js';
import { parsePeriodo, periodoSiguiente, rangoPeriodos } from '../domain/periodo.js';
import { f22Vigente } from '../domain/renta.js';
import { claveDocumento } from '../domain/tipos.js';
import { conciliarBanco, type Partida } from '../reconciliation/conciliar-banco.js';
import { signoTipoDoc } from '../reconciliation/mapeo-f29.js';
import { perfilExistente } from './consultas.js';
import type { DepsApp } from './deps.js';

/** Tamaño máximo de una cartola: un año de movimientos de una pyme cabe con holgura. */
export const MAX_BYTES_CARTOLA = 5 * 1024 * 1024;
/** Alias de la cuenta cuando la persona no indica uno. */
export const CUENTA_POR_DEFECTO = 'principal';
const ALIAS_CUENTA = /^[\p{L}\p{N} _-]{1,40}$/u;

export interface ResultadoImportacion {
  readonly rut: string;
  readonly cuenta: string;
  /** Nombre del archivo, sin carpeta. */
  readonly archivo: string;
  readonly leidos: number;
  readonly nuevos: number;
  readonly repetidos: number;
  /** Filas que no eran movimientos: preámbulo, saldo inicial, totales. */
  readonly descartadas: number;
  readonly desde: string | null;
  readonly hasta: string | null;
  /** Qué columna de la cartola se usó para cada dato. */
  readonly columnas: Readonly<Record<ColumnaCartola, string | null>>;
  /** Si el saldo de cada fila sigue al anterior más su monto; null si la cartola no trae saldos. */
  readonly saldoCuadra: boolean | null;
  readonly avisos: readonly string[];
}

/**
 * Revisa que el saldo de cada movimiento sea el anterior más su monto, en el orden de la cartola o, si viene de la más
 * nueva a la más antigua, al revés. Devuelve los tramos en que se corta (faltan movimientos).
 */
function cortesDeSaldo(movimientos: readonly MovimientoLeido[]): { readonly cuadra: boolean | null; readonly cortes: readonly [string, string][] } {
  const conSaldo = movimientos.filter((m) => m.saldo !== null);
  if (conSaldo.length < 2) return { cuadra: null, cortes: [] };
  const ordenados = conSaldo[0]!.fecha > conSaldo.at(-1)!.fecha ? [...conSaldo].reverse() : conSaldo;
  const cortes: [string, string][] = [];
  for (let i = 1; i < ordenados.length; i++) {
    const anterior = ordenados[i - 1]!;
    const actual = ordenados[i]!;
    if (Math.abs(anterior.saldo! + actual.monto - actual.saldo!) > 1) cortes.push([anterior.fecha, actual.fecha]);
  }
  return { cuadra: cortes.length === 0, cortes };
}

export interface OpcionesImportacion {
  readonly cuenta?: string;
  readonly columnas?: MapeoColumnas;
}

/**
 * Importa una cartola bancaria (CSV o TXT) que indica la persona por su ruta en el equipo: la lee, guarda sus movimientos
 * en la cuenta indicada sin repetir los que ya estaban y revisa que el saldo no se corte. Solo escribe en la base local.
 */
export async function importarCartola(deps: DepsApp, rutTexto: string, ruta: string, opciones: OpcionesImportacion = {}): Promise<ResultadoImportacion> {
  perfilExistente(deps, rutTexto);
  aliasCuenta(opciones);
  return importarCartolaDatos(deps, rutTexto, await deps.archivos.leer(ruta, MAX_BYTES_CARTOLA), opciones);
}

function aliasCuenta(opciones: OpcionesImportacion): string {
  const cuenta = (opciones.cuenta ?? CUENTA_POR_DEFECTO).trim();
  if (!ALIAS_CUENTA.test(cuenta)) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'El alias de la cuenta debe tener entre 1 y 40 letras, números, espacios, guiones o guiones bajos.');
  return cuenta;
}

/** Como `importarCartola`, con el archivo ya leído (p. ej. subido desde la página local). */
export function importarCartolaDatos(deps: DepsApp, rutTexto: string, archivo: { readonly nombre: string; readonly bytes: Uint8Array }, opciones: OpcionesImportacion = {}): ResultadoImportacion {
  const perfil = perfilExistente(deps, rutTexto);
  const cuenta = aliasCuenta(opciones);
  const { nombre, bytes } = archivo;
  if (bytes.length > MAX_BYTES_CARTOLA) throw new ErrorMiSiiMcp('ARCHIVO_INVALIDO', `La cartola pasa del máximo de ${MAX_BYTES_CARTOLA / 1024 / 1024} MB.`);
  const leida = deps.lectorCartola.leer(bytes, opciones.columnas);
  // La huella del lector no conoce la cuenta: con ella, la misma cartola en dos cuentas son movimientos distintos.
  const movimientos = leida.movimientos.map((m) => ({ ...m, huella: createHash('sha256').update(`${cuenta}|${m.huella}`).digest('hex') }));
  const { nuevos, repetidos } = deps.store.guardarImportacionBanco(
    perfil.rut,
    cuenta,
    { archivo: nombre, sha256: createHash('sha256').update(bytes).digest('hex'), filas: movimientos.length },
    movimientos,
    deps.reloj.ahora().toISOString(),
  );
  const fechas = movimientos.map((m) => m.fecha).sort();
  const saldo = cortesDeSaldo(movimientos);
  return {
    rut: perfil.rut,
    cuenta,
    archivo: nombre,
    leidos: movimientos.length,
    nuevos,
    repetidos,
    descartadas: leida.descartadas,
    desde: fechas[0] ?? null,
    hasta: fechas.at(-1) ?? null,
    columnas: leida.columnas,
    saldoCuadra: saldo.cuadra,
    avisos: [...leida.avisos, ...saldo.cortes.map(([desde, hasta]) => `El saldo no cuadra entre el ${desde} y el ${hasta}: faltan movimientos en la cartola.`)],
  };
}

// --- conciliación bancaria ---------------------------------------------------------------------

/** Documentos del RCV que se pagan o cobran por el banco: facturas, notas de débito y de crédito (también de exportación). */
const TIPOS_VENTA: ReadonlySet<number> = new Set([33, 34, 56, 61, 110, 111, 112]);
const TIPOS_COMPRA: ReadonlySet<number> = new Set([33, 34, 56, 61]);
/** Días antes de un rango en que se buscan documentos: una factura se paga hasta meses después de emitida. */
const DIAS_ANTES_PARTIDAS = 120;
/** «… depositará $215.280 …»: el monto que la Tesorería deposita por la devolución del F22. */
const DEPOSITO_F22 = /deposit\w*\s+\$\s?([\d.]+)/i;

/** Todo lo que debería verse en el banco entre dos fechas: ventas y compras del RCV, boletas, F29 pagados y el F22. */
function partidasEntre(deps: DepsApp, rut: string, desde: string, hasta: string): Partida[] {
  const out: Partida[] = [];
  const agregar = (p: Partida): void => {
    if (p.fecha >= desde && p.fecha <= hasta) out.push(p);
  };
  for (const periodo of rangoPeriodos(parsePeriodo(desde.slice(0, 7)), parsePeriodo(hasta.slice(0, 7)), 240)) {
    const p = periodo.texto;
    for (const d of deps.store.documentosRcv(rut, p)) {
      const fecha = d.fechaEmision?.slice(0, 10) ?? `${p}-01`;
      const base = { clave: claveDocumento(d), rutContraparte: d.rutContraparte, nombre: d.razonSocial, fecha };
      if (d.lado === 'VENTA' && d.estado === 'REGISTRO' && TIPOS_VENTA.has(d.tipoDoc)) agregar({ ...base, tipo: 'venta', monto: signoTipoDoc(d.tipoDoc) * d.montoTotal });
      if (d.lado === 'COMPRA' && (d.estado === 'REGISTRO' || d.estado === 'PENDIENTE') && TIPOS_COMPRA.has(d.tipoDoc)) agregar({ ...base, tipo: 'compra', monto: -signoTipoDoc(d.tipoDoc) * d.montoTotal });
    }
    for (const b of deps.store.boletasHonorarios(rut, p)) {
      if (!b.anulada) agregar({ tipo: 'bhe_recibida', clave: `BHE:R:${b.rutEmisor}:${b.folio}`, rutContraparte: b.rutEmisor, nombre: b.nombreEmisor, fecha: b.fecha ?? `${p}-01`, monto: -b.liquido });
    }
    for (const b of deps.store.boletasEmitidas(rut, p)) {
      if (!b.anulada) agregar({ tipo: 'bhe_emitida', clave: `BHE:E:${b.folio}`, rutContraparte: b.rutReceptor, nombre: b.nombreReceptor, fecha: b.fecha ?? `${p}-01`, monto: b.liquido });
    }
    const f29 = declaracionVigente(deps.store.declaracionesF29(rut, p));
    if (f29?.fechaPresentacion && (f29.totalAPagar ?? 0) > 0) {
      agregar({ tipo: 'f29', clave: `F29:${p}:${f29.folio}`, rutContraparte: null, nombre: `F29 de ${p}`, fecha: f29.fechaPresentacion.slice(0, 10), monto: -f29.totalAPagar! });
    }
  }
  for (const anio of new Set(deps.store.declaracionesF22(rut).map((d) => d.anioTributario))) {
    const vigente = f22Vigente(deps.store.declaracionesF22(rut, anio));
    if (!vigente) continue;
    const nombre = `F22 AT${anio}`;
    for (const e of deps.store.detalleF22(rut, anio, vigente.folio).eventos) {
      const deposito = DEPOSITO_F22.exec(e.nombre ?? '');
      if (deposito && e.fecha) agregar({ tipo: 'f22', clave: `F22:AT${anio}:${vigente.folio}`, rutContraparte: null, nombre, fecha: e.fecha, monto: Number(deposito[1]!.replace(/\./g, '')) });
    }
    if ((vigente.impuestoPagado ?? 0) > 0) agregar({ tipo: 'f22', clave: `F22:AT${anio}:${vigente.folio}:pago`, rutContraparte: null, nombre, fecha: vigente.fechaIngreso ?? `${anio}-04-30`, monto: -vigente.impuestoPagado! });
  }
  return out;
}

/** Primer y último día de un rango de meses `AAAA-MM`. */
function fechasDe(desde: string, hasta: string): { readonly desde: string; readonly hasta: string } {
  const [inicio] = rangoPeriodos(parsePeriodo(desde), parsePeriodo(hasta), 240);
  return { desde: `${inicio!.texto}-01`, hasta: sumarDias(`${periodoSiguiente(parsePeriodo(hasta)).texto}-01`, -1) };
}

/** Recalcula la conciliación automática de los movimientos entre dos fechas, respetando lo manual y lo de otros rangos. */
function conciliarRango(deps: DepsApp, rut: string, desde: string, hasta: string): { readonly movimientos: readonly MovimientoBancario[]; readonly partidas: readonly Partida[] } {
  const todos = deps.store.movimientosBanco(rut);
  const fechaDe = new Map(todos.map((m) => [m.huella, m.fecha]));
  const movimientos = todos.filter((m) => m.fecha >= desde && m.fecha <= hasta);
  const partidas = partidasEntre(deps, rut, sumarDias(desde, -DIAS_ANTES_PARTIDAS), sumarDias(hasta, 5));
  // Lo manual y lo conciliado en otros rangos queda fijo: sus movimientos y partidas no se vuelven a emparejar aquí.
  const fijados = deps.store.conciliaciones(rut).filter((c) => {
    const fecha = fechaDe.get(c.huella) ?? '';
    return c.criterio === 'manual' || fecha < desde || fecha > hasta;
  });
  const r = conciliarBanco(movimientos, partidas, fijados);
  deps.store.reemplazarConciliacionAutomatica(rut, desde, hasta, r.pares, deps.reloj.ahora().toISOString());
  return { movimientos, partidas };
}

export interface ParDetalle {
  readonly huella: string;
  readonly fecha: string;
  readonly monto: number;
  readonly descripcion: string;
  readonly tipo: TipoPartida;
  readonly clave: string;
  readonly nombre: string | null;
  readonly criterio: CriterioConciliacion;
  readonly dias: number | null;
}

export interface ResumenConciliacion {
  readonly rut: string;
  readonly desde: string;
  readonly hasta: string;
  readonly movimientos: number;
  /** Movimientos con su partida (automáticos y manuales). */
  readonly conciliados: number;
  readonly manuales: number;
  readonly descartados: number;
  readonly pares: readonly ParDetalle[];
  readonly sinConciliar: readonly { readonly huella: string; readonly fecha: string; readonly descripcion: string; readonly monto: number }[];
  /** Partidas del rango que no aparecen en la cartola (facturas por cobrar o pagar, F29 sin pago visto…). */
  readonly partidasSinMovimiento: readonly Partida[];
}

function exigirCartolas(deps: DepsApp, rut: string): void {
  if (deps.store.cuentasBanco(rut).length === 0) {
    throw new ErrorMiSiiMcp('SIN_DATOS_LOCALES', `No hay cartolas importadas de ${rut}: importa una con banco_importar o en la página «Abrir mi-sii-mcp.cmd».`);
  }
}

/**
 * Concilia los movimientos bancarios de un rango de meses con lo que sabe mi-sii-mcp: ventas y compras del RCV, boletas
 * de honorarios, F29 pagados y devoluciones del F22. Guarda los pares automáticos y respeta lo fijado a mano.
 */
export function conciliacionBancaria(deps: DepsApp, rutTexto: string, desdePeriodo: string, hastaPeriodo: string): ResumenConciliacion {
  const perfil = perfilExistente(deps, rutTexto);
  exigirCartolas(deps, perfil.rut);
  const { desde, hasta } = fechasDe(desdePeriodo, hastaPeriodo);
  const { movimientos, partidas } = conciliarRango(deps, perfil.rut, desde, hasta);
  const guardadas = deps.store.conciliaciones(perfil.rut, desde, hasta);
  const porHuella = new Map(movimientos.map((m) => [m.huella, m]));
  const porClave = new Map(partidas.map((p) => [p.clave, p]));
  const pares = guardadas.flatMap((c): ParDetalle[] => {
    const m = porHuella.get(c.huella);
    if (!m || c.tipo === null || c.clave === null) return [];
    return [{ huella: m.huella, fecha: m.fecha, monto: m.monto, descripcion: m.descripcion, tipo: c.tipo, clave: c.clave, nombre: porClave.get(c.clave)?.nombre ?? null, criterio: c.criterio, dias: c.dias }];
  });
  const conPar = new Set(guardadas.map((c) => c.huella));
  const claves = new Set(guardadas.flatMap((c) => (c.clave === null ? [] : [c.clave])));
  return {
    rut: perfil.rut,
    desde,
    hasta,
    movimientos: movimientos.length,
    conciliados: pares.length,
    manuales: pares.filter((p) => p.criterio === 'manual').length,
    descartados: guardadas.filter((c) => c.clave === null).length,
    pares,
    sinConciliar: movimientos.filter((m) => !conPar.has(m.huella)).map(({ huella, fecha, descripcion, monto }) => ({ huella, fecha, descripcion, monto })),
    partidasSinMovimiento: partidas.filter((p) => p.fecha >= desde && p.fecha <= hasta && !claves.has(p.clave)),
  };
}

/**
 * Fija a mano la conciliación de un movimiento: `asignar` lo une a una partida (una factura, boleta, F29 o F22 que
 * mi-sii-mcp conoce) y `descartar` lo deja sin partida (p. ej. una comisión del banco). Lo manual manda sobre lo automático.
 */
export function fijarConciliacion(deps: DepsApp, rutTexto: string, accion: 'asignar' | 'descartar', huella: string, clave?: string): void {
  const perfil = perfilExistente(deps, rutTexto);
  // Se acepta la huella completa o su comienzo (desde 8 caracteres), siempre que identifique un solo movimiento.
  const candidatos = deps.store.movimientosBanco(perfil.rut).filter((m) => m.huella === huella || (huella.length >= 8 && m.huella.startsWith(huella)));
  const movimiento = candidatos.length === 1 ? candidatos[0] : candidatos.find((m) => m.huella === huella);
  if (!movimiento) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'No hay un solo movimiento guardado con esa huella: tómala del resultado de banco_conciliar.');
  huella = movimiento.huella;
  const ahora = deps.reloj.ahora().toISOString();
  if (accion === 'descartar') {
    deps.store.fijarConciliacionManual(perfil.rut, huella, null, ahora);
    return;
  }
  const partida = partidasEntre(deps, perfil.rut, sumarDias(movimiento.fecha, -365), sumarDias(movimiento.fecha, 31)).find((p) => p.clave === clave);
  if (!partida) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'No se encontró esa partida cerca de la fecha del movimiento: usa una clave del resultado de banco_conciliar.');
  deps.store.fijarConciliacionManual(perfil.rut, huella, { tipo: partida.tipo, clave: partida.clave }, ahora);
}

export type TramoAntiguedad = '0-30' | '31-60' | '61-90' | '+90';

export interface CuentaPendiente {
  readonly tipo: TipoPartida;
  readonly clave: string;
  readonly contraparte: string | null;
  readonly rutContraparte: string | null;
  readonly fecha: string;
  /** Lo que falta cobrar o pagar; una nota de crédito resta. */
  readonly monto: number;
  readonly dias: number;
  readonly tramo: TramoAntiguedad;
}

export interface LadoPendiente {
  readonly total: number;
  readonly tramos: Readonly<Record<TramoAntiguedad, number>>;
  readonly documentos: readonly CuentaPendiente[];
}

export interface CuentasPendientes {
  readonly rut: string;
  readonly al: string;
  /** Primera fecha de las cartolas: lo emitido antes no se puede saber si se pagó. */
  readonly cartolaDesde: string;
  /** Desde cuándo se consideran los documentos. */
  readonly documentosDesde: string;
  readonly porCobrar: LadoPendiente;
  readonly porPagar: LadoPendiente;
}

const tramoDe = (dias: number): TramoAntiguedad => (dias <= 30 ? '0-30' : dias <= 60 ? '31-60' : dias <= 90 ? '61-90' : '+90');

function ladoPendiente(documentos: CuentaPendiente[]): LadoPendiente {
  const tramos: Record<TramoAntiguedad, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '+90': 0 };
  for (const d of documentos) tramos[d.tramo] += d.monto;
  return { total: documentos.reduce((s, d) => s + d.monto, 0), tramos, documentos: documentos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.clave.localeCompare(b.clave)) };
}

/**
 * Cuentas por cobrar y por pagar al día `al`: lo facturado (ventas, compras y boletas de honorarios) que no aparece en las
 * cartolas importadas, con su antigüedad. Solo considera documentos desde 120 días antes de la primera cartola.
 */
export function cuentasPendientes(deps: DepsApp, rutTexto: string, al?: string, lado?: 'cobrar' | 'pagar'): CuentasPendientes {
  const perfil = perfilExistente(deps, rutTexto);
  exigirCartolas(deps, perfil.rut);
  const fechaAl = al ?? fechaEnSantiago(deps.reloj.ahora());
  const cartolaDesde = deps.store.movimientosBanco(perfil.rut)[0]!.fecha;
  conciliarRango(deps, perfil.rut, cartolaDesde, fechaAl);
  const conciliadas = new Set(deps.store.conciliaciones(perfil.rut).flatMap((c) => (c.clave === null ? [] : [c.clave])));
  const documentosDesde = sumarDias(cartolaDesde, -DIAS_ANTES_PARTIDAS);
  const pendientes = partidasEntre(deps, perfil.rut, documentosDesde, fechaAl).filter((p) => !conciliadas.has(p.clave) && p.tipo !== 'f29' && p.tipo !== 'f22');
  const cuenta = (p: Partida, signo: 1 | -1): CuentaPendiente => {
    const dias = diasEntre(p.fecha, fechaAl);
    return { tipo: p.tipo, clave: p.clave, contraparte: p.nombre, rutContraparte: p.rutContraparte, fecha: p.fecha, monto: signo * p.monto, dias, tramo: tramoDe(dias) };
  };
  const cobrar = lado === 'pagar' ? [] : pendientes.filter((p) => p.tipo === 'venta' || p.tipo === 'bhe_emitida').map((p) => cuenta(p, 1));
  const pagar = lado === 'cobrar' ? [] : pendientes.filter((p) => p.tipo === 'compra' || p.tipo === 'bhe_recibida').map((p) => cuenta(p, -1));
  return { rut: perfil.rut, al: fechaAl, cartolaDesde, documentosDesde, porCobrar: ladoPendiente(cobrar), porPagar: ladoPendiente(pagar) };
}
