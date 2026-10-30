import { vencimientosF29, type VencimientosF29 } from '../calendar/plazos.js';
import { ErrorMiSiiMcp } from '../domain/errores.js';
import { declaracionVigente } from '../domain/f29.js';
import { diasEntre, fechaEnSantiago } from '../domain/fechas.js';
import { parsePeriodo, periodoAnterior, type Periodo } from '../domain/periodo.js';
import type { F29Valores } from '../domain/tipos.js';
import { estimarF29, type EntradaEstimacionF29, type EstimacionF29 } from '../reconciliation/estimar-f29.js';
import { CODIGO_F29, montoF29 } from '../reconciliation/mapeo-f29.js';
import { perfilExistente } from './consultas.js';
import type { DepsApp } from './deps.js';

/** Datos que el SII no tiene y la persona (o el asistente, desde la página oficial de la UTM) puede informar. */
export interface ParametrosEstimacion {
  readonly utmActual?: number;
  readonly utmAnterior?: number;
  readonly impuestoUnico?: number;
  /** Tasa del PPM en porcentaje (0,25 es 0,25 %). */
  readonly tasaPpm?: number;
}

export interface ResultadoEstimacionF29 extends EstimacionF29 {
  readonly rut: string;
  /** El F29 vigente del mes, si ya se presentó: sirve para comparar la estimación. */
  readonly presentado: { readonly folio: number; readonly totalAPagar: number | null } | null;
  /** Estimado menos presentado; null si no hay F29 presentado o no trae total. */
  readonly diferenciaConPresentado: number | null;
  readonly vence: VencimientosF29;
  /** Días desde el vencimiento que corresponde (con pago si hay que pagar, sin pago si no); null si no está atrasado. */
  readonly diasAtraso: number | null;
}

/** Meses hacia atrás que se estiman para arrastrar el remanente de meses sin F29 presentado. */
const MAX_MESES_REMANENTE = 12;
/** Meses hacia atrás en que se busca la tasa del PPM de un F29 presentado. */
const MAX_MESES_TASA = 24;

function valoresVigentes(deps: DepsApp, rut: string, periodo: string): F29Valores | null {
  const vigente = declaracionVigente(deps.store.declaracionesF29(rut, periodo));
  return vigente ? deps.store.valoresF29(rut, periodo, vigente.folio) : null;
}

const conRcv = (deps: DepsApp, rut: string, periodo: string): boolean => {
  const d = deps.store.disponibilidadFuentes(rut, periodo);
  return d.ventasRcv || d.comprasRcv;
};

/** El remanente que deja el mes anterior: el del F29 presentado o, si ese mes no tiene, estimado mes a mes hacia atrás. */
function remanenteAnterior(deps: DepsApp, rut: string, periodo: Periodo, profundidad: number): EntradaEstimacionF29['remanenteAnterior'] {
  const anterior = periodoAnterior(periodo);
  const valores = valoresVigentes(deps, rut, anterior.texto);
  if (valores) return { monto: montoF29(valores, CODIGO_F29.REMANENTE_PERIODO_SIGUIENTE) ?? 0, origen: 'f29' };
  if (profundidad >= MAX_MESES_REMANENTE || !conRcv(deps, rut, anterior.texto)) return { monto: 0, origen: 'sin_dato' };
  return { monto: estimarF29(entradaDe(deps, rut, anterior, {}, profundidad + 1)).remanenteSiguiente, origen: 'estimado' };
}

/** La tasa del PPM del F29 presentado más reciente, desde el mes hacia atrás. */
function tasaPpm(deps: DepsApp, rut: string, periodo: Periodo): EntradaEstimacionF29['tasaPpm'] {
  let p = periodo;
  for (let i = 0; i <= MAX_MESES_TASA; i++, p = periodoAnterior(p)) {
    const tasa = valoresVigentes(deps, rut, p.texto)?.valores['115'];
    if (tasa !== undefined) return { tasa, origen: 'f29' };
  }
  return null;
}

function entradaDe(deps: DepsApp, rut: string, periodo: Periodo, p: ParametrosEstimacion, profundidad: number): EntradaEstimacionF29 {
  const disponibilidad = deps.store.disponibilidadFuentes(rut, periodo.texto);
  // Los parámetros (UTM, impuesto único) son del mes que se pide; los meses anteriores se estiman sin ellos.
  const delMes = profundidad === 0;
  return {
    periodo,
    resumenes: deps.store.resumenesRcv(rut, periodo.texto),
    retencionHonorarios: disponibilidad.bheRecibidas ? deps.store.totalesBhe(rut, periodo.texto).retencion : null,
    remanenteAnterior: remanenteAnterior(deps, rut, periodo, profundidad),
    tasaPpm: delMes && p.tasaPpm !== undefined ? { tasa: p.tasaPpm, origen: 'parametro' } : tasaPpm(deps, rut, periodo),
    impuestoUnico: delMes ? (p.impuestoUnico ?? null) : null,
    factorRemanente: delMes && p.utmActual !== undefined && p.utmAnterior !== undefined ? p.utmActual / p.utmAnterior : null,
  };
}

function validar(p: ParametrosEstimacion): void {
  if ((p.utmActual === undefined) !== (p.utmAnterior === undefined)) {
    throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'Para reajustar el remanente se necesitan las dos UTM: la del mes y la del mes anterior.');
  }
  for (const [nombre, valor] of [['utm_actual', p.utmActual], ['utm_anterior', p.utmAnterior]] as const) {
    if (valor !== undefined && !(valor > 0)) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', `${nombre} debe ser mayor que cero.`);
  }
  if (p.tasaPpm !== undefined && !(p.tasaPpm >= 0 && p.tasaPpm <= 10)) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'tasa_ppm va en porcentaje, entre 0 y 10.');
  if (p.impuestoUnico !== undefined && !(p.impuestoUnico >= 0)) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'impuesto_unico no puede ser negativo.');
}

/**
 * Estima el F29 de un mes con lo guardado (RCV, boletas recibidas, F29 anteriores) y los parámetros que no están en el SII.
 * Si el mes ya tiene un F29 presentado, lo compara. Solo lee la base local.
 */
export function estimacionF29(deps: DepsApp, rutTexto: string, periodoTexto: string, p: ParametrosEstimacion = {}): ResultadoEstimacionF29 {
  const perfil = perfilExistente(deps, rutTexto);
  const periodo = parsePeriodo(periodoTexto);
  validar(p);
  if (!conRcv(deps, perfil.rut, periodo.texto)) {
    throw new ErrorMiSiiMcp('SIN_DATOS_LOCALES', `No hay RCV guardado de ${periodo.texto} para ${perfil.rut}: sincroniza ese mes antes de estimar su F29.`);
  }
  const estimacion = estimarF29(entradaDe(deps, perfil.rut, periodo, p, 0));
  const vigente = declaracionVigente(deps.store.declaracionesF29(perfil.rut, periodo.texto));
  // Se compara con el total en plazo (91) del F29 leído: el total de la declaración incluye los recargos si se pagó tarde.
  const totalPresentado = vigente ? (deps.store.valoresF29(perfil.rut, periodo.texto, vigente.folio)?.valores[CODIGO_F29.TOTAL_A_PAGAR] ?? vigente.totalAPagar) : null;
  const vence = vencimientosF29(periodo, { autorizadoDia20: deps.store.perfilTributario(perfil.rut)?.autorizadoDia20 ?? null });
  const hoy = fechaEnSantiago(deps.reloj.ahora());
  const plazo = estimacion.totalAPagar > 0 ? vence.conPago : vence.sinPago;
  const atraso = diasEntre(plazo, hoy);
  return {
    ...estimacion,
    rut: perfil.rut,
    presentado: vigente ? { folio: vigente.folio, totalAPagar: totalPresentado } : null,
    diferenciaConPresentado: totalPresentado === null ? null : estimacion.totalAPagar - totalPresentado,
    vence,
    diasAtraso: vigente === null && atraso > 0 ? atraso : null,
  };
}
