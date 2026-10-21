import type { F29Declaracion } from './tipos.js';

/** La declaración que vale para el período: la marcada vigente o, si ninguna lo está, la presentada más reciente. */
export function declaracionVigente(declaraciones: readonly F29Declaracion[]): F29Declaracion | null {
  const presentadas = declaraciones.filter((d) => d.folio > 0);
  const vigentes = presentadas.filter((d) => /vigente/i.test(d.estado));
  const candidatas = vigentes.length > 0 ? vigentes : presentadas;
  const ordenadas = [...candidatas].sort(
    (a, b) => (b.fechaPresentacion ?? '').localeCompare(a.fechaPresentacion ?? '') || b.folio - a.folio,
  );
  return ordenadas[0] ?? null;
}
