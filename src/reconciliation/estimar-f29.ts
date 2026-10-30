import type { Periodo } from '../domain/periodo.js';
import type { RcvResumen } from '../domain/tipos.js';
import { creditoRcv, debitoRcv, signoTipoDoc } from './mapeo-f29.js';

/** Todo lo que necesita la estimación de un F29; lo que no se sabe llega como null y queda en faltantes. */
export interface EntradaEstimacionF29 {
  readonly periodo: Periodo;
  readonly resumenes: readonly RcvResumen[];
  /** Retención de las boletas de honorarios recibidas no anuladas del mes; null si no se consultaron. */
  readonly retencionHonorarios: number | null;
  /** Remanente de crédito que deja el mes anterior (su código 77): del F29 presentado, estimado o sin dato. */
  readonly remanenteAnterior: { readonly monto: number; readonly origen: 'f29' | 'estimado' | 'sin_dato' };
  /** Tasa del PPM en porcentaje (0,25 es 0,25 %), del último F29 presentado o de un parámetro; null si no se sabe. */
  readonly tasaPpm: { readonly tasa: number; readonly origen: 'f29' | 'parametro' } | null;
  /** Impuesto único retenido a los trabajadores (código 48): el SII no lo tiene; null si no se informó. */
  readonly impuestoUnico: number | null;
  /** UTM del mes ÷ UTM del mes anterior, para reajustar el remanente; null si no se informó. */
  readonly factorRemanente: number | null;
}

export interface LineaEstimada {
  readonly codigo: string;
  readonly glosa: string;
  readonly monto: number;
  /** De dónde sale el monto (RCV, boletas, F29 anterior, parámetro, cálculo…). */
  readonly origen: string;
}

export interface EstimacionF29 {
  readonly periodo: string;
  readonly lineas: readonly LineaEstimada[];
  /** Código 91: total a pagar dentro del plazo. */
  readonly totalAPagar: number;
  /** Código 77: remanente de crédito para el período siguiente. */
  readonly remanenteSiguiente: number;
  readonly supuestos: readonly string[];
  /** Lo que no se pudo estimar: su línea va en cero hasta que se informe. */
  readonly faltantes: readonly string[];
}

/** Ingresos del mes para la base del PPM: neto y exento de las ventas registradas, con las notas de crédito restando. */
function basePpm(resumenes: readonly RcvResumen[]): number {
  return resumenes
    .filter((r) => r.lado === 'VENTA' && r.estado === 'REGISTRO')
    .flatMap((r) => r.filas)
    .reduce((suma, f) => suma + signoTipoDoc(f.tipoDoc) * (f.neto + f.exento), 0);
}

/**
 * Estima el F29 de un mes con lo que ya está guardado: IVA del RCV, remanente del mes anterior (reajustado por la UTM si
 * se informa), PPM con la tasa del último F29 y retención de las boletas recibidas. Es una estimación: no considera otras
 * líneas del formulario (impuestos adicionales, créditos especiales) ni los recargos de un F29 atrasado.
 */
export function estimarF29(e: EntradaEstimacionF29): EstimacionF29 {
  const supuestos: string[] = [];
  const faltantes: string[] = [];
  const debito = debitoRcv(e.resumenes);
  const creditoDocumentos = creditoRcv(e.resumenes);
  const remanente = Math.round(e.remanenteAnterior.monto * (e.factorRemanente ?? 1));
  if (e.remanenteAnterior.origen === 'estimado') supuestos.push('El remanente del mes anterior es estimado: ese F29 no está presentado.');
  if (e.factorRemanente === null && e.remanenteAnterior.monto > 0) supuestos.push('Remanente sin reajuste: falta la UTM del mes y la del mes anterior.');
  const credito = creditoDocumentos + remanente;
  const iva = Math.max(debito - credito, 0);
  const remanenteSiguiente = Math.max(credito - debito, 0);
  const base = basePpm(e.resumenes);
  if (e.tasaPpm === null) faltantes.push('La tasa del PPM: no hay un F29 anterior con el código 115; infórmala como parámetro.');
  else if (e.tasaPpm.origen === 'f29') supuestos.push(`Tasa del PPM tomada del último F29 presentado (${e.tasaPpm.tasa} %).`);
  const ppm = e.tasaPpm === null ? 0 : Math.round((base * e.tasaPpm.tasa) / 100);
  if (e.retencionHonorarios === null) faltantes.push('Las boletas de honorarios recibidas del mes: sincronízalas (superficie bhe) para saber la retención.');
  const retencion = e.retencionHonorarios ?? 0;
  if (e.remanenteAnterior.origen === 'sin_dato') faltantes.push('El remanente del mes anterior: no hay F29 ni datos de los meses anteriores.');
  if (e.impuestoUnico === null) supuestos.push('Sin impuesto único de trabajadores (código 48): el SII no lo tiene; infórmalo si hubo sueldos.');
  const impuestoUnico = e.impuestoUnico ?? 0;
  const total = iva + ppm + retencion + impuestoUnico;
  const lineas: LineaEstimada[] = [
    { codigo: '538', glosa: 'Total débitos', monto: debito, origen: 'RCV ventas' },
    { codigo: '520', glosa: 'Crédito por documentos (neto de notas de crédito)', monto: creditoDocumentos, origen: 'RCV compras registradas' },
    { codigo: '504', glosa: 'Remanente de crédito del mes anterior', monto: remanente, origen: e.remanenteAnterior.origen === 'f29' ? 'F29 anterior' : e.remanenteAnterior.origen },
    { codigo: '537', glosa: 'Total créditos', monto: credito, origen: 'cálculo' },
    { codigo: '89', glosa: 'IVA determinado', monto: iva, origen: 'cálculo' },
    { codigo: '77', glosa: 'Remanente de crédito para el período siguiente', monto: remanenteSiguiente, origen: 'cálculo' },
    { codigo: '563', glosa: 'Base imponible del PPM (ingresos del mes)', monto: base, origen: 'RCV ventas' },
    { codigo: '115', glosa: 'Tasa del PPM (%)', monto: e.tasaPpm?.tasa ?? 0, origen: e.tasaPpm?.origen === 'parametro' ? 'parámetro' : e.tasaPpm ? 'F29 anterior' : 'sin dato' },
    { codigo: '62', glosa: 'PPM', monto: ppm, origen: 'cálculo' },
    { codigo: '151', glosa: 'Retención de honorarios', monto: retencion, origen: e.retencionHonorarios === null ? 'sin dato' : 'boletas recibidas' },
    { codigo: '48', glosa: 'Impuesto único de trabajadores', monto: impuestoUnico, origen: e.impuestoUnico === null ? 'no informado' : 'parámetro' },
    { codigo: '91', glosa: 'Total a pagar dentro del plazo', monto: total, origen: 'cálculo' },
  ];
  return { periodo: e.periodo.texto, lineas, totalAPagar: total, remanenteSiguiente, supuestos, faltantes };
}
