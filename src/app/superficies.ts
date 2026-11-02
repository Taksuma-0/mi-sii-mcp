import { SUPERFICIE_DETALLE_BHE_EMITIDAS } from '../domain/renta.js';
import type { Superficie } from './sincronizar.js';

/**
 * Qué registros de la bitácora produce el lector actual. Los de versiones anteriores (p. ej. `terceros.306`, que hoy se
 * lee como «asistente») quedan con su último intento fallido para siempre: no se reintentan ni cuentan como rotos.
 */

/** De qué superficie de `sincronizar` sale cada registro mensual. */
export const SUPERFICIE_DE_REGISTRO: Readonly<Record<string, Superficie>> = {
  'rcv.VENTA': 'rcv',
  'rcv.COMPRA': 'rcv',
  f29: 'f29',
  'f29.valores': 'f29',
  'f29.propuesta': 'propuesta',
  'bhe.recibidas': 'bhe',
};

/** Registros de la renta (período `ATaaaa`): las DJ de terceros van con su código de 4 dígitos. */
const DE_RENTA = /^(f22|f22\.folio|bhe\.emitidas|terceros|terceros\.\d{4}|asistente)$/;
const PERIODO_RENTA = /^AT\d{4}$/;
const DE_CUENTA = new Set(['cuenta.perfil', 'cuenta.empresas']);

/** Si el lector actual sigue produciendo este registro de la bitácora. */
export function esSuperficieVigente(superficie: string, periodo: string): boolean {
  if (PERIODO_RENTA.test(periodo)) return DE_RENTA.test(superficie);
  if (superficie === SUPERFICIE_DETALLE_BHE_EMITIDAS || DE_CUENTA.has(superficie)) return true;
  return Object.hasOwn(SUPERFICIE_DE_REGISTRO, superficie);
}

/**
 * Año tributario que hay que volver a traer para reintentar un registro de la renta, o null si no es de la renta. El
 * detalle de las boletas emitidas se registra por mes y se trae con la renta del año siguiente.
 */
export function anioDeRenta(superficie: string, periodo: string): string | null {
  if (PERIODO_RENTA.test(periodo)) return periodo.slice(2);
  if (superficie === SUPERFICIE_DETALLE_BHE_EMITIDAS) return String(Number(periodo.slice(0, 4)) + 1);
  return null;
}
