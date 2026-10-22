/** Primer valor no vacío entre varios nombres posibles de un campo: el portal a veces cambia los nombres. */
export function primero(fila: Record<string, unknown>, claves: readonly string[]): unknown {
  for (const clave of claves) {
    const v = fila[clave];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export const texto = (v: unknown): string | null => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

/** Entero; lo ausente o inválido vale 0 (montos). */
export function entero(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Número o null; conserva decimales (por ejemplo tasas). */
export function numero(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
