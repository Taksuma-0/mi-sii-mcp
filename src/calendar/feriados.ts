/**
 * Feriados nacionales de Chile, tabla estática del plan para 2025–2027.
 * Fuentes previstas para su actualización y contraste:
 * https://api.boostr.cl/holidays/<año>.json y https://date.nager.at/.
 * No se consultaron esas fuentes durante esta implementación.
 * Para agregar un año: `node scripts/actualizar-feriados.mjs 2028` y revisar la salida antes de pegarla aquí.
 */
export const FERIADOS: ReadonlySet<string> = new Set([
  // 2025
  '2025-01-01', '2025-04-18', '2025-04-19', '2025-05-01', '2025-05-21', '2025-06-20', '2025-06-29',
  '2025-07-16', '2025-08-15', '2025-09-18', '2025-09-19', '2025-10-12', '2025-10-31', '2025-11-01',
  '2025-11-16', '2025-12-08', '2025-12-25',
  // 2026
  '2026-01-01', '2026-04-03', '2026-04-04', '2026-05-01', '2026-05-21', '2026-06-21', '2026-06-29',
  '2026-07-16', '2026-08-15', '2026-09-18', '2026-09-19', '2026-10-12', '2026-10-31', '2026-11-01',
  '2026-12-08', '2026-12-25',
  // 2027
  '2027-01-01', '2027-03-26', '2027-03-27', '2027-05-01', '2027-05-21', '2027-06-21', '2027-06-28',
  '2027-07-16', '2027-08-15', '2027-09-17', '2027-09-18', '2027-09-19', '2027-10-11', '2027-10-31',
  '2027-11-01', '2027-12-08', '2027-12-25',
]);

export const ANIOS_CUBIERTOS = { desde: 2025, hasta: 2027 } as const;
