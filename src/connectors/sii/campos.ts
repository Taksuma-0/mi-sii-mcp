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

/** Monto en formato chileno: miles con punto (`12.345.678`) o sin separador. */
const ES_MONTO = /^-?\d{1,3}(?:\.\d{3})+$|^-?\d+$/;
/** Coma decimal, o punto decimal con `0.` inicial o 1 a 2 decimales (`0.5`, `1.25`); 3 dígitos tras un punto son miles. */
const ES_DECIMAL = /^-?\d+,\d+$|^-?0\.\d+$|^-?\d+\.\d{1,2}$/;
/** Miles con punto y decimales con coma (`1.234,5`). */
const ES_MILES_CON_DECIMALES = /^-?\d{1,3}(?:\.\d{3})+,\d+$/;

/** El texto es un número en formato chileno que `aNumero` sabe leer (sin signo `+` ni espacios). */
export const esValor = (s: string): boolean => ES_MONTO.test(s) || ES_DECIMAL.test(s);

/** Número de un texto en formato chileno ya validado (`esValor`): punto de miles, coma decimal. */
export function aNumero(s: string): number {
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  return ES_DECIMAL.test(s) ? Number(s) : Number(s.replace(/\./g, ''));
}

/**
 * Número de un valor del SII en formato chileno (`12.345.678`, `-250.000`, `+1.000`, `12,5`, `1.234,5`) o ya numérico;
 * lo vacío, ausente o no numérico (fechas, textos) vale null, nunca 0.
 */
export function numeroChileno(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/^([+-])\s+/, '$1').replace(/^\+/, '');
  if (!esValor(t) && !ES_MILES_CON_DECIMALES.test(t)) return null;
  const n = aNumero(t);
  return Number.isFinite(n) ? n : null;
}
