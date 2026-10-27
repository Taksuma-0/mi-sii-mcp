import type { F29Declaracion, PropuestaF29 } from './tipos.js';

/** Estados del SII (`estadoDeclaracionId`) de una declaración que existe pero no se presentó. */
const ESTADO_GUARDADA = 10;
const ESTADO_RECHAZADA = 70;
const TEXTO_NO_PRESENTADA = /guardad|rechazad|anulad/i;

/** Una declaración guardada sin presentar (por su id o porque el texto del estado lo dice). */
export function f29Guardada(d: F29Declaracion): boolean {
  return d.estadoId === ESTADO_GUARDADA || /guardad/i.test(d.estado);
}

/** Una declaración que el SII rechazó (por su id o porque el texto del estado lo dice), aunque tenga folio. */
export function f29Rechazada(d: F29Declaracion): boolean {
  return d.estadoId === ESTADO_RECHAZADA || /rechazad/i.test(d.estado);
}

/** Presentada de verdad: con folio, sin estar guardada, rechazada ni anulada. Un estado desconocido cuenta como presentado. */
export function f29Presentada(d: F29Declaracion): boolean {
  if (d.folio <= 0) return false;
  if (d.estadoId === ESTADO_GUARDADA || d.estadoId === ESTADO_RECHAZADA) return false;
  return !TEXTO_NO_PRESENTADA.test(d.estado);
}

/** La declaración que vale para el período: la marcada vigente o, si ninguna lo está, la presentada más reciente. */
export function declaracionVigente(declaraciones: readonly F29Declaracion[]): F29Declaracion | null {
  const presentadas = declaraciones.filter(f29Presentada);
  const vigentes = presentadas.filter((d) => /vigente/i.test(d.estado));
  const candidatas = vigentes.length > 0 ? vigentes : presentadas;
  const ordenadas = [...candidatas].sort(
    (a, b) => (b.fechaPresentacion ?? '').localeCompare(a.fechaPresentacion ?? '') || b.folio - a.folio,
  );
  return ordenadas[0] ?? null;
}

/** Montos que la propuesta del SII entrega para el IVA: crédito, remanente y retención. No trae débito ni total a pagar. */
export interface MontosPropuesta {
  /** Crédito propuesto (520); si falta, el crédito neto por documentos (511). */
  readonly credito: number | null;
  /** De qué código vino el crédito: el 520 propuesto o, a falta de este, el 511 (informativo); null si no hay crédito. */
  readonly origenCredito: '520' | '511' | null;
  /** Remanente propuesto (504). */
  readonly remanente: number | null;
  /** Retención propuesta (151). */
  readonly retencion: number | null;
}

export function montosPropuesta(p: PropuestaF29): MontosPropuesta {
  const origenCredito = p.propuestos['520'] !== undefined ? '520' : p.propuestos['511'] !== undefined ? '511' : null;
  return {
    credito: origenCredito === null ? null : p.propuestos[origenCredito] ?? null,
    origenCredito,
    remanente: p.propuestos['504'] ?? null,
    retencion: p.propuestos['151'] ?? null,
  };
}
