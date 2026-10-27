import { vencimientoF29, vencimientoReclamo } from '../calendar/plazos.js';
import { ErrorImpuestocl } from '../domain/errores.js';
import { declaracionVigente, montosPropuesta } from '../domain/f29.js';
import { diasEntre, fechaEnSantiago } from '../domain/fechas.js';
import { formatearClp, nombreTipoDocumento } from '../domain/formato.js';
import { compararPeriodos, parsePeriodo, periodoAnterior, periodoDeFecha, rangoPeriodos, restarPeriodos, type Periodo } from '../domain/periodo.js';
import { parseRut } from '../domain/rut.js';
import {
  claveDocumento,
  type DisponibilidadFuentes,
  type DocumentoRcv,
  type EstadoRcv,
  type F29Valores,
  type Hallazgo,
  type Lado,
  type Perfil,
  type Plazo,
  type RcvResumenFila,
  type TotalesBheMes,
} from '../domain/tipos.js';
import type { FiltroDocumentos, FiltroHallazgos, Frescura, HallazgoGuardado } from '../ports/index.js';
import { conciliarPeriodo, type Comparaciones } from '../reconciliation/conciliar.js';
import { CODIGO_F29, montoF29 } from '../reconciliation/mapeo-f29.js';
import type { EntradaConciliacion } from '../reconciliation/reglas.js';
import type { DepsApp } from './deps.js';

export interface ResumenIva {
  readonly rut: string;
  readonly periodo: string;
  readonly disponibilidad: DisponibilidadFuentes;
  readonly ventas: { readonly porTipo: readonly RcvResumenFila[]; readonly debito: number | null };
  readonly compras: { readonly porTipo: readonly RcvResumenFila[]; readonly credito: number | null; readonly pendientes: number | null; readonly reclamados: number | null };
  readonly f29: {
    readonly folio: number;
    readonly estado: string;
    readonly fechaPresentacion: string | null;
    readonly totalAPagar: number | null;
    readonly valores: Readonly<Record<string, number>>;
  } | null;
  /** Propuesta del SII del mes, si se sincronizó y trajo datos; no entra en la conciliación. */
  readonly propuesta: {
    readonly tipo: number | null;
    readonly sinPropuesta: boolean;
    readonly credito: number | null;
    readonly remanente: number | null;
    readonly retencion: number | null;
  } | null;
  /** Boletas de honorarios recibidas del mes (cantidad con anuladas; montos sin ellas), solo si se consultaron. */
  readonly honorarios: TotalesBheMes | null;
  readonly venceF29: string;
  readonly comparaciones: Comparaciones;
  readonly hallazgos: readonly Hallazgo[];
  readonly frescura: Frescura;
}

export interface FilaHistorialF29 {
  readonly periodo: string;
  readonly presentado: boolean;
  readonly folio: number | null;
  readonly estado: string | null;
  readonly fechaPresentacion: string | null;
  readonly totalAPagar: number | null;
  readonly debitos: number | null;
  readonly creditos: number | null;
  /** Retención declarada en el código 151 del F29 vigente; null si no se leyó. */
  readonly retencion151: number | null;
  /** Retención de las boletas de honorarios recibidas no anuladas del mes; null si no se consultaron. */
  readonly retencionBoletas: number | null;
  /** Último momento en que se consultó el F29 de ese mes, o null si nunca. */
  readonly sincronizado: string | null;
}

export interface PaginaDocumentos {
  readonly total: number;
  readonly pagina: number;
  readonly tamano: number;
  readonly documentos: readonly DocumentoRcv[];
}

export function perfilExistente(deps: DepsApp, rutTexto: string): Perfil {
  const rut = parseRut(rutTexto).canonico;
  const perfil = deps.store.contribuyente(rut);
  if (!perfil) throw new ErrorImpuestocl('PERFIL_NO_EXISTE', `No existe el perfil ${rut}.`);
  return perfil;
}

const hoy = (deps: DepsApp): string => fechaEnSantiago(deps.reloj.ahora());

function valoresVigentes(deps: DepsApp, rut: string, periodo: string): F29Valores | null {
  const vigente = declaracionVigente(deps.store.declaracionesF29(rut, periodo));
  return vigente ? deps.store.valoresF29(rut, periodo, vigente.folio) : null;
}

function conciliarYGuardar(deps: DepsApp, perfil: Perfil, periodo: Periodo) {
  const declaraciones = deps.store.declaracionesF29(perfil.rut, periodo.texto);
  const vigente = declaracionVigente(declaraciones);
  const entrada = {
    rut: perfil.rut,
    tipo: perfil.tipo,
    periodo,
    hoy: hoy(deps),
    resumenes: deps.store.resumenesRcv(perfil.rut, periodo.texto),
    documentos: deps.store.documentosRcv(perfil.rut, periodo.texto),
    declaraciones,
    valores: vigente ? deps.store.valoresF29(perfil.rut, periodo.texto, vigente.folio) : null,
    valoresAnterior: periodo.texto === '2000-01' ? null : valoresVigentes(deps, perfil.rut, periodoAnterior(periodo).texto),
    snapshots: vigente?.fechaPresentacion ? deps.store.snapshotsRcv(perfil.rut, periodo.texto) : [],
    toleranciaPesos: deps.toleranciaPesos,
    disponibilidad: deps.store.disponibilidadFuentes(perfil.rut, periodo.texto),
  } satisfies EntradaConciliacion;
  const resultado = conciliarPeriodo(entrada);
  deps.store.reemplazarHallazgos(perfil.rut, periodo.texto, resultado.hallazgos, resultado.versionReglas, deps.reloj.ahora().toISOString());
  return { entrada, resultado, vigente };
}

export function resumenIva(deps: DepsApp, rutTexto: string, periodoTexto: string): ResumenIva {
  const perfil = perfilExistente(deps, rutTexto);
  const periodo = parsePeriodo(periodoTexto);
  const { entrada, resultado, vigente } = conciliarYGuardar(deps, perfil, periodo);
  const disponibilidad = entrada.disponibilidad;
  const propuesta = disponibilidad.propuestaF29 ? deps.store.propuestaF29(perfil.rut, periodo.texto) : null;
  const filas = (lado: Lado, estado: EstadoRcv): RcvResumenFila[] =>
    entrada.resumenes.filter((r) => r.lado === lado && r.estado === estado).flatMap((r) => [...r.filas]);
  const cantidad = (estado: EstadoRcv): number | null => disponibilidad.comprasRcv ? filas('COMPRA', estado).reduce((s, f) => s + f.cantidad, 0) : null;
  return {
    rut: perfil.rut,
    periodo: periodo.texto,
    disponibilidad,
    ventas: { porTipo: filas('VENTA', 'REGISTRO'), debito: resultado.comparaciones.debitoRcv },
    compras: { porTipo: filas('COMPRA', 'REGISTRO'), credito: resultado.comparaciones.creditoRcv, pendientes: cantidad('PENDIENTE'), reclamados: cantidad('RECLAMADO') },
    f29: vigente
      ? { folio: vigente.folio, estado: vigente.estado, fechaPresentacion: vigente.fechaPresentacion, totalAPagar: vigente.totalAPagar, valores: entrada.valores?.valores ?? {} }
      : null,
    propuesta: propuesta ? { tipo: propuesta.tipoPropuesta, sinPropuesta: propuesta.sinPropuesta, ...montosPropuesta(propuesta) } : null,
    honorarios: disponibilidad.bheRecibidas ? deps.store.totalesBhe(perfil.rut, periodo.texto) : null,
    venceF29: vencimientoF29(periodo),
    comparaciones: resultado.comparaciones,
    hallazgos: resultado.hallazgos,
    frescura: deps.store.frescura(perfil.rut, periodo.texto),
  };
}

export function hallazgos(deps: DepsApp, rutTexto: string, filtro: FiltroHallazgos = {}): HallazgoGuardado[] {
  const desde = filtro.desde === undefined ? undefined : parsePeriodo(filtro.desde);
  const hasta = filtro.hasta === undefined ? undefined : parsePeriodo(filtro.hasta);
  if (desde && hasta && compararPeriodos(desde, hasta) > 0) {
    throw new ErrorImpuestocl('PERIODO_INVALIDO', `El inicio ${desde.texto} es posterior al fin ${hasta.texto}`);
  }
  const normalizado: FiltroHallazgos = { ...filtro, desde: desde?.texto, hasta: hasta?.texto };
  const perfil = perfilExistente(deps, rutTexto);
  for (const p of deps.store.periodosConDatos(perfil.rut)) {
    if ((normalizado.desde && p < normalizado.desde) || (normalizado.hasta && p > normalizado.hasta)) continue;
    conciliarYGuardar(deps, perfil, parsePeriodo(p));
  }
  return deps.store.hallazgos(perfil.rut, normalizado);
}

export function plazos(deps: DepsApp, rutTexto: string, dias = 30): Plazo[] {
  const perfil = perfilExistente(deps, rutTexto);
  const fechaHoy = hoy(deps);
  const actual = periodoDeFecha(fechaHoy);
  const limite = restarPeriodos(actual, 12);
  const out: Plazo[] = [];

  const candidatos = new Set<string>([periodoAnterior(actual).texto, ...deps.store.periodosConDatos(perfil.rut)]);
  for (const texto of [...candidatos].sort()) {
    const periodo = parsePeriodo(texto);
    if (compararPeriodos(periodo, actual) >= 0 || compararPeriodos(periodo, limite) < 0) continue;
    if (declaracionVigente(deps.store.declaracionesF29(perfil.rut, texto))) continue;
    const sincronizado = deps.store.frescura(perfil.rut, texto).f29 !== null;
    const conMovimiento = deps.store.resumenesRcv(perfil.rut, texto).some((r) => r.estado === 'REGISTRO' && r.filas.some((f) => f.cantidad > 0));
    if (perfil.tipo !== 'empresa' && !conMovimiento) continue;
    const vence = vencimientoF29(periodo);
    const restantes = diasEntre(fechaHoy, vence);
    if (restantes > dias) continue;
    const descripcion = !sincronizado
      ? `F29 de ${texto}: sin sincronizar; sincroniza ese mes para confirmar si está presentado`
      : restantes < 0
        ? `F29 de ${texto} no presentado (vencido)`
        : `Presentar el F29 de ${texto}`;
    out.push({ rut: perfil.rut, tipo: 'F29', vence, diasRestantes: restantes, descripcion, referencia: texto });
  }

  for (const texto of [periodoAnterior(actual).texto, actual.texto]) {
    for (const d of deps.store.documentosRcv(perfil.rut, texto, { lado: 'COMPRA', estado: 'PENDIENTE' })) {
      if (!d.fechaRecepcion) continue;
      const vence = vencimientoReclamo(d.fechaRecepcion);
      const restantes = diasEntre(fechaHoy, vence);
      if (restantes < 0 || restantes > dias) continue;
      out.push({
        rut: perfil.rut,
        tipo: 'RECLAMO_FACTURA',
        vence,
        diasRestantes: restantes,
        descripcion: `Aceptar o reclamar ${nombreTipoDocumento(d.tipoDoc)} folio ${d.folio} de ${d.razonSocial ?? d.rutContraparte} (${formatearClp(d.montoTotal)})`,
        referencia: claveDocumento(d),
      });
    }
  }
  return out.sort((a, b) => a.vence.localeCompare(b.vence) || a.tipo.localeCompare(b.tipo));
}

export function f29Historial(deps: DepsApp, rutTexto: string, desde: string, hasta: string): FilaHistorialF29[] {
  const perfil = perfilExistente(deps, rutTexto);
  return rangoPeriodos(parsePeriodo(desde), parsePeriodo(hasta)).map((periodo) => {
    const vigente = declaracionVigente(deps.store.declaracionesF29(perfil.rut, periodo.texto));
    const valores = vigente ? deps.store.valoresF29(perfil.rut, periodo.texto, vigente.folio) : null;
    return {
      periodo: periodo.texto,
      presentado: vigente !== null,
      folio: vigente?.folio ?? null,
      estado: vigente?.estado ?? null,
      fechaPresentacion: vigente?.fechaPresentacion ?? null,
      totalAPagar: vigente?.totalAPagar ?? null,
      debitos: montoF29(valores, CODIGO_F29.TOTAL_DEBITOS),
      creditos: montoF29(valores, CODIGO_F29.TOTAL_CREDITOS),
      retencion151: montoF29(valores, CODIGO_F29.RETENCION_HONORARIOS),
      retencionBoletas: deps.store.disponibilidadFuentes(perfil.rut, periodo.texto).bheRecibidas ? deps.store.totalesBhe(perfil.rut, periodo.texto).retencion : null,
      sincronizado: deps.store.frescura(perfil.rut, periodo.texto).f29,
    };
  });
}

export function documentos(deps: DepsApp, rutTexto: string, periodoTexto: string, filtro: FiltroDocumentos = {}, pagina = 1, tamano = 50): PaginaDocumentos {
  const perfil = perfilExistente(deps, rutTexto);
  const periodo = parsePeriodo(periodoTexto);
  const p = Number.isFinite(pagina) ? Math.max(1, Math.trunc(pagina)) : 1;
  const t = Number.isFinite(tamano) ? Math.min(200, Math.max(1, Math.trunc(tamano))) : 50;
  const resultado = deps.store.documentosRcvPaginados(perfil.rut, periodo.texto, filtro, p, t);
  return { ...resultado, pagina: p, tamano: t };
}
