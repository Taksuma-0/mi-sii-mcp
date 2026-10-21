import { diaSemana, sumarDias } from '../domain/fechas.js';
import { periodoSiguiente, type Periodo } from '../domain/periodo.js';
import { FERIADOS } from './feriados.js';

export const DIA_VENCIMIENTO_F29 = 20;
export const DIAS_PLAZO_RECLAMO = 8;

export function esDiaHabil(fecha: string): boolean {
  const dia = diaSemana(fecha);
  return dia !== 0 && dia !== 6 && !FERIADOS.has(fecha);
}

export function siguienteDiaHabil(fecha: string): string {
  let f = fecha;
  while (!esDiaHabil(f)) f = sumarDias(f, 1);
  return f;
}

/**
 * Regla asumida para F29 de quienes facturan electrónicamente y declaran por internet:
 * día 20 del mes siguiente; si no es hábil, el siguiente día hábil.
 * Pendiente de validación manual en T23; ver docs/decisiones/0002-plazos.md.
 */
export function vencimientoF29(periodo: Periodo): string {
  const siguiente = periodoSiguiente(periodo);
  return siguienteDiaHabil(`${siguiente.texto}-${String(DIA_VENCIMIENTO_F29).padStart(2, '0')}`);
}

/** Regla del plan (Ley 19.983, art. 3): 8 días corridos siguientes a la recepción en el SII para reclamar el documento. */
export const vencimientoReclamo = (fechaRecepcion: string): string => sumarDias(fechaRecepcion.slice(0, 10), DIAS_PLAZO_RECLAMO);
