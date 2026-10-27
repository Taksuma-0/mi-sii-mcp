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

/** Texto de los errores de un sobre SDI (`metaData.errors`: lista, objeto o texto), o null si no hay. */
export function mensajeDeError(errores: unknown): string | null {
  if (errores === null || errores === undefined) return null;
  if (Array.isArray(errores)) {
    const textos = errores.map((e) => (esObjeto(e) ? texto(e['descripcion']) : texto(e))).filter((x): x is string => x !== null);
    return textos.length > 0 ? textos.join('; ') : null;
  }
  if (esObjeto(errores)) return texto(errores['descripcion']);
  return texto(errores);
}
