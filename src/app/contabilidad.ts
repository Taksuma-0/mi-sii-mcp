import { CUENTAS, PLAN_CUENTAS_BASE, type CuentaContable, type TipoCuenta } from '../domain/contabilidad.js';
import { ErrorMiSiiMcp } from '../domain/errores.js';
import { declaracionVigente } from '../domain/f29.js';
import { sumarDias } from '../domain/fechas.js';
import { aCsv, type CeldaCsv } from '../domain/formato.js';
import { parsePeriodo, periodoSiguiente, rangoPeriodos, restarPeriodos, type Periodo } from '../domain/periodo.js';
import { parseRut } from '../domain/rut.js';
import { claveDocumento, type DocumentoRcv } from '../domain/tipos.js';
import { asientosDelPeriodo, type Asiento, type EntradaAsientos, type F29Asiento } from '../reconciliation/asientos.js';
import { signoTipoDoc } from '../reconciliation/mapeo-f29.js';
import { conciliacionBancaria } from './banco.js';
import { perfilExistente } from './consultas.js';
import type { DepsApp } from './deps.js';
import { SOLO_RESUMEN_VENTA } from './sincronizar.js';

export type { Asiento } from '../reconciliation/asientos.js';

export interface CuentaDelPlan extends CuentaContable {
  /** La sumó o la renombró el contribuyente; si no, es del plan base. */
  readonly propia: boolean;
}

export interface VistaCuentas {
  readonly rut: string;
  readonly cuentas: readonly CuentaDelPlan[];
  readonly reglas: readonly { readonly rutContraparte: string; readonly cuenta: string; readonly nombreCuenta: string | null }[];
}

const TIPOS: readonly TipoCuenta[] = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto'];
/** A un proveedor solo se le puede asignar una cuenta donde quepa una compra: un gasto o un activo. */
const TIPOS_DE_COMPRA: ReadonlySet<TipoCuenta> = new Set(['gasto', 'activo']);

/** El plan de cuentas del contribuyente: el base con sus cuentas propias encima, por código. */
export function planDeCuentas(deps: DepsApp, rut: string): CuentaDelPlan[] {
  const porCodigo = new Map<string, CuentaDelPlan>(PLAN_CUENTAS_BASE.map((c) => [c.codigo, { ...c, propia: false }]));
  for (const c of deps.store.cuentasPropias(rut)) porCodigo.set(c.codigo, { ...c, propia: true });
  return [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/** Reglas de clasificación de compras del contribuyente: RUT del proveedor → código de cuenta. */
export const reglasDe = (deps: DepsApp, rut: string): Map<string, string> => new Map(deps.store.reglasCuenta(rut).map((r) => [r.rutContraparte, r.cuenta]));

export function vistaCuentas(deps: DepsApp, rutTexto: string): VistaCuentas {
  const perfil = perfilExistente(deps, rutTexto);
  const cuentas = planDeCuentas(deps, perfil.rut);
  const nombre = new Map(cuentas.map((c) => [c.codigo, c.nombre]));
  return { rut: perfil.rut, cuentas, reglas: deps.store.reglasCuenta(perfil.rut).map((r) => ({ ...r, nombreCuenta: nombre.get(r.cuenta) ?? null })) };
}

/** Suma una cuenta al plan del contribuyente, o renombra una existente con el mismo código. */
export function crearCuenta(deps: DepsApp, rutTexto: string, cuenta: CuentaContable): void {
  const perfil = perfilExistente(deps, rutTexto);
  const nombre = cuenta.nombre.trim();
  if (!/^\d{3,6}$/.test(cuenta.codigo)) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'El código de la cuenta va con 3 a 6 dígitos (p. ej. 5210).');
  if (nombre.length < 1 || nombre.length > 80) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'El nombre de la cuenta va con 1 a 80 caracteres.');
  if (!TIPOS.includes(cuenta.tipo)) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', `El tipo de la cuenta es uno de: ${TIPOS.join(', ')}.`);
  deps.store.guardarCuentaPropia(perfil.rut, { codigo: cuenta.codigo, nombre, tipo: cuenta.tipo });
}

/** Clasifica las compras de un proveedor en una cuenta de gasto o de activo; con null quita la regla. */
export function asignarCuenta(deps: DepsApp, rutTexto: string, rutContraparteTexto: string, cuenta: string | null): void {
  const perfil = perfilExistente(deps, rutTexto);
  const rutContraparte = parseRut(rutContraparteTexto).canonico;
  if (cuenta !== null) {
    const destino = planDeCuentas(deps, perfil.rut).find((c) => c.codigo === cuenta);
    if (!destino) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', `La cuenta ${cuenta} no está en el plan: créala primero.`);
    if (!TIPOS_DE_COMPRA.has(destino.tipo)) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', `La cuenta ${cuenta} es de ${destino.tipo}: una compra va a una cuenta de gasto o de activo.`);
  }
  deps.store.guardarReglaCuenta(perfil.rut, rutContraparte, cuenta);
}

/** Lo que sale de los documentos del período (sin F29 ni banco): RCV registrado, boletas de venta y de honorarios. */
function entradaDe(deps: DepsApp, rut: string, periodos: readonly Periodo[]): EntradaAsientos {
  return {
    documentos: periodos.flatMap((p) => deps.store.documentosRcv(rut, p.texto, { estado: 'REGISTRO' })),
    resumenesBoletas: periodos.flatMap((p) =>
      deps.store
        .resumenesRcv(rut, p.texto)
        .filter((r) => r.lado === 'VENTA' && r.estado === 'REGISTRO')
        .flatMap((r) => r.filas.filter((f) => SOLO_RESUMEN_VENTA.has(f.tipoDoc) && f.cantidad > 0).map((f) => ({ periodo: p.texto, ...f }))),
    ),
    boletasRecibidas: periodos.flatMap((p) => deps.store.boletasHonorarios(rut, p.texto)),
    boletasEmitidas: periodos.flatMap((p) => deps.store.boletasEmitidas(rut, p.texto)),
    f29: [],
    banco: [],
    reglas: reglasDe(deps, rut),
  };
}

export interface ResultadoAsientos {
  readonly rut: string;
  readonly desde: string;
  readonly hasta: string;
  readonly asientos: readonly Asiento[];
  /** Sumas del debe y del haber (iguales) y lo que quedó en «por clasificar», que conviene revisar. */
  readonly totales: { readonly asientos: number; readonly debe: number; readonly haber: number; readonly porClasificar: number };
  /** Nombre de cada cuenta usada, según el plan del contribuyente. */
  readonly cuentas: Readonly<Record<string, string>>;
}

/**
 * Asientos propuestos de un rango de meses (`AAAA-MM`) con lo guardado: documentos registrados del RCV, boletas de venta,
 * boletas de honorarios, la centralización de los F29 presentados de esos meses y los movimientos de las cartolas con su
 * conciliación. Usa el plan de cuentas y las reglas por proveedor del contribuyente.
 */
export function asientos(deps: DepsApp, rutTexto: string, desde: string, hasta: string): ResultadoAsientos {
  const perfil = perfilExistente(deps, rutTexto);
  const rut = perfil.rut;
  const periodos = rangoPeriodos(parsePeriodo(desde), parsePeriodo(hasta), 240);
  const f29: F29Asiento[] = periodos.flatMap((p) => {
    const vigente = declaracionVigente(deps.store.declaracionesF29(rut, p.texto));
    const valores = vigente?.fechaPresentacion ? deps.store.valoresF29(rut, p.texto, vigente.folio) : null;
    return vigente && valores ? [{ periodo: p.texto, folio: vigente.folio, fecha: vigente.fechaPresentacion!.slice(0, 10), valores: valores.valores }] : [];
  });
  const primerDia = `${periodos[0]!.texto}-01`;
  const ultimoDia = sumarDias(`${periodoSiguiente(periodos.at(-1)!).texto}-01`, -1);
  const tipoDe = new Map(deps.store.conciliaciones(rut, primerDia, ultimoDia).map((c) => [c.huella, c.tipo]));
  const lista = asientosDelPeriodo({
    ...entradaDe(deps, rut, periodos),
    f29,
    banco: deps.store.movimientosBanco(rut, { desde: primerDia, hasta: ultimoDia }).map((movimiento) => ({ movimiento, tipo: tipoDe.get(movimiento.huella) ?? null })),
  });
  const lineas = lista.flatMap((a) => a.lineas);
  const nombres = new Map(planDeCuentas(deps, rut).map((c) => [c.codigo, c.nombre]));
  return {
    rut,
    desde: periodos[0]!.texto,
    hasta: periodos.at(-1)!.texto,
    asientos: lista,
    totales: {
      asientos: lista.length,
      debe: lineas.reduce((s, l) => s + l.debe, 0),
      haber: lineas.reduce((s, l) => s + l.haber, 0),
      porClasificar: lineas.filter((l) => l.cuenta === CUENTAS.POR_CLASIFICAR).reduce((s, l) => s + l.debe + l.haber, 0),
    },
    cuentas: Object.fromEntries([...new Set(lineas.map((l) => l.cuenta))].map((c) => [c, nombres.get(c) ?? `Cuenta ${c}`])),
  };
}

/** Exporta los asientos a un CSV para Excel o el software contable: una fila por línea, con el número de su asiento. */
export async function exportarAsientos(deps: DepsApp, r: ResultadoAsientos): Promise<string> {
  const filas = r.asientos.flatMap((a, i) => a.lineas.map((l): CeldaCsv[] => [a.fecha, i + 1, l.cuenta, r.cuentas[l.cuenta] ?? null, a.glosa, l.debe, l.haber, a.origen]));
  return deps.archivos.exportar(`asientos-${r.rut}-${r.desde}-${r.hasta}.csv`, aCsv(['Fecha', 'Número', 'Cuenta', 'Nombre de la cuenta', 'Glosa', 'Debe', 'Haber', 'Origen'], filas));
}

export interface LineaResultado {
  readonly cuenta: string;
  readonly nombre: string;
  readonly monto: number;
}

export interface Contraparte {
  readonly rut: string;
  readonly nombre: string | null;
  readonly monto: number;
}

export interface ResultadoDelPeriodo {
  readonly rut: string;
  readonly desde: string;
  readonly hasta: string;
  readonly base: 'devengado' | 'percibido';
  readonly ingresos: readonly LineaResultado[];
  readonly gastos: readonly LineaResultado[];
  readonly totalIngresos: number;
  readonly totalGastos: number;
  readonly resultado: number;
  readonly principalesClientes: readonly Contraparte[];
  readonly principalesProveedores: readonly Contraparte[];
  readonly supuestos: readonly string[];
}

/** Meses antes del rango en que se buscan documentos cobrados o pagados dentro de él. */
const MESES_ANTES_PERCIBIDO = 4;

/** Las 5 contrapartes con más monto de un lado del RCV (las notas de crédito restan). */
function principales(documentos: readonly DocumentoRcv[], lado: 'VENTA' | 'COMPRA'): Contraparte[] {
  const porRut = new Map<string, { nombre: string | null; monto: number }>();
  for (const d of documentos.filter((x) => x.lado === lado)) {
    const actual = porRut.get(d.rutContraparte) ?? { nombre: d.razonSocial, monto: 0 };
    porRut.set(d.rutContraparte, { nombre: actual.nombre ?? d.razonSocial, monto: actual.monto + signoTipoDoc(d.tipoDoc) * d.montoTotal });
  }
  return [...porRut.entries()].map(([rut, c]) => ({ rut, ...c })).sort((a, b) => b.monto - a.monto || a.rut.localeCompare(b.rut)).slice(0, 5);
}

/**
 * Estado de resultados de un rango de meses a partir de los asientos propuestos: devengado (lo facturado del período) o
 * percibido (lo cobrado y pagado según las cartolas conciliadas, como tributa una Pro Pyme), con los 5 principales clientes
 * y proveedores. No incluye sueldos, depreciación ni otros gastos que el SII no conoce.
 */
export function resultadoPeriodo(deps: DepsApp, rutTexto: string, desde: string, hasta: string, base: 'devengado' | 'percibido'): ResultadoDelPeriodo {
  const perfil = perfilExistente(deps, rutTexto);
  const rut = perfil.rut;
  const periodos = rangoPeriodos(parsePeriodo(desde), parsePeriodo(hasta), 240);
  let lista: Asiento[];
  let documentos: DocumentoRcv[];
  const supuestos = ['No incluye sueldos, depreciación ni otros gastos que el SII no conoce: agrégalos para un resultado completo.'];
  if (base === 'devengado') {
    const entrada = entradaDe(deps, rut, periodos);
    lista = asientosDelPeriodo(entrada);
    documentos = [...entrada.documentos];
    supuestos.unshift('Base devengada: lo facturado y las boletas del período, cobrado o no.');
  } else {
    const conciliacion = conciliacionBancaria(deps, rut, desde, hasta);
    const cobradas = new Set(conciliacion.pares.map((p) => p.clave));
    const entrada = entradaDe(deps, rut, rangoPeriodos(restarPeriodos(periodos[0]!, MESES_ANTES_PERCIBIDO), periodos.at(-1)!, 240));
    const sinConciliar = new Set(conciliacion.sinConciliar.map((m) => m.huella));
    const sueltos = deps.store.movimientosBanco(rut, { desde: conciliacion.desde, hasta: conciliacion.hasta }).filter((m) => sinConciliar.has(m.huella));
    const soloBanco: EntradaAsientos = { ...entrada, documentos: [], resumenesBoletas: [], boletasRecibidas: [], boletasEmitidas: [], banco: sueltos.map((movimiento) => ({ movimiento, tipo: null })) };
    lista = [...asientosDelPeriodo(entrada).filter((a) => cobradas.has(a.origen.replace(/^RCV:/, ''))), ...asientosDelPeriodo(soloBanco)];
    documentos = entrada.documentos.filter((d) => cobradas.has(claveDocumento(d)));
    supuestos.unshift('Base percibida: solo lo cobrado y pagado según las cartolas conciliadas; los movimientos sin conciliar quedan en «Por clasificar».');
  }
  const plan = new Map(planDeCuentas(deps, rut).map((c) => [c.codigo, c]));
  const sumas = new Map<string, number>();
  for (const l of lista.flatMap((a) => a.lineas)) {
    const tipo = plan.get(l.cuenta)?.tipo;
    if (tipo === 'ingreso') sumas.set(l.cuenta, (sumas.get(l.cuenta) ?? 0) + l.haber - l.debe);
    if (tipo === 'gasto') sumas.set(l.cuenta, (sumas.get(l.cuenta) ?? 0) + l.debe - l.haber);
  }
  const lineas = (tipo: TipoCuenta): LineaResultado[] =>
    [...sumas.entries()]
      .filter(([cuenta, monto]) => plan.get(cuenta)?.tipo === tipo && monto !== 0)
      .map(([cuenta, monto]) => ({ cuenta, nombre: plan.get(cuenta)!.nombre, monto }))
      .sort((a, b) => a.cuenta.localeCompare(b.cuenta));
  const ingresos = lineas('ingreso');
  const gastos = lineas('gasto');
  const totalIngresos = ingresos.reduce((s, l) => s + l.monto, 0);
  const totalGastos = gastos.reduce((s, l) => s + l.monto, 0);
  return {
    rut,
    desde: periodos[0]!.texto,
    hasta: periodos.at(-1)!.texto,
    base,
    ingresos,
    gastos,
    totalIngresos,
    totalGastos,
    resultado: totalIngresos - totalGastos,
    principalesClientes: principales(documentos, 'VENTA'),
    principalesProveedores: principales(documentos, 'COMPRA'),
    supuestos,
  };
}
