import { diaSemana, sumarDias } from '../domain/fechas.js';
import type { Periodo } from '../domain/periodo.js';
import { FERIADOS } from './feriados.js';

/** Día del mes siguiente hasta el que vence el F29 con pago para quien el SII autoriza (Mi SII `autorizadoDeclararDia20`). */
export const DIA_VENCIMIENTO_F29 = 20;
/** Plazo general del F29 con pago: día 12 del mes siguiente. */
export const DIA_VENCIMIENTO_F29_GENERAL = 12;
/** Declaraciones sin pago presentadas por Internet: día 28 del mes siguiente. */
export const DIA_VENCIMIENTO_F29_SIN_PAGO = 28;
export const DIAS_PLAZO_RECLAMO = 8;

/** No es hábil un sábado, un domingo, un feriado ni el 31 de diciembre (regla del SII para los vencimientos). */
export function esDiaHabil(fecha: string): boolean {
  const dia = diaSemana(fecha);
  return dia !== 0 && dia !== 6 && !FERIADOS.has(fecha) && !fecha.endsWith('-12-31');
}

export function siguienteDiaHabil(fecha: string): string {
  let f = fecha;
  while (!esDiaHabil(f)) f = sumarDias(f, 1);
  return f;
}

export interface VencimientosF29 {
  /** Vencimiento si el F29 lleva pago. */
  readonly conPago: string;
  /** Vencimiento de la declaración sin pago por Internet. */
  readonly sinPago: string;
}

export interface OpcionesVencimientosF29 {
  /** El SII autoriza declarar y pagar hasta el día 20; null si se desconoce, y entonces se mantiene el día 20. */
  readonly autorizadoDia20: boolean | null;
}

/**
 * Vencimientos oficiales del F29 de un período (docs/decisiones/0004-plazos-f29.md): con pago, el día 20 del mes siguiente
 * si el SII lo autoriza (o se desconoce) y si no el día 12, trasladado al primer día hábil siguiente si cae en sábado,
 * domingo, feriado o 31 de diciembre; sin pago por Internet, el día 28, que no se traslada.
 */
export function vencimientosF29(periodo: Periodo, opciones: OpcionesVencimientosF29): VencimientosF29 {
  const anio = periodo.anio + (periodo.mes === 12 ? 1 : 0);
  const mes = String((periodo.mes % 12) + 1).padStart(2, '0');
  const dia = (d: number): string => `${anio}-${mes}-${String(d).padStart(2, '0')}`;
  const diaConPago = opciones.autorizadoDia20 === false ? DIA_VENCIMIENTO_F29_GENERAL : DIA_VENCIMIENTO_F29;
  return { conPago: siguienteDiaHabil(dia(diaConPago)), sinPago: dia(DIA_VENCIMIENTO_F29_SIN_PAGO) };
}

/** Regla del plan (Ley 19.983, art. 3): 8 días corridos siguientes a la recepción en el SII para reclamar el documento. */
export const vencimientoReclamo = (fechaRecepcion: string): string => sumarDias(fechaRecepcion.slice(0, 10), DIAS_PLAZO_RECLAMO);

/**
 * Vencimiento de la renta anual (F22) con pago: el 30 de abril del año tributario (art. 69 de la Ley de la Renta). Sin pago
 * o con devolución el SII fija cada año un plazo posterior (en 2026, el 8 de mayo), y un plazo que cae en día inhábil lo
 * resuelve su calendario: aquí no se traslada ni se inventa.
 */
export const vencimientoF22 = (anioTributario: number): string => `${anioTributario}-04-30`;
