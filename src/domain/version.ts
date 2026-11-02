/** Versión semántica simple (`mayor.menor.parche`), sin sufijos de prueba: lo que publica npm. */
export const ES_VERSION = /^\d+(\.\d+){0,2}(-[\w.]+)?$/;

const partes = (v: string): number[] => {
  const [numeros = ''] = v.split('-');
  const p = numeros.split('.').map((n) => Number(n));
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
};

/** -1, 0 o 1 según `a` sea menor, igual o mayor que `b`; los sufijos (`-test`, `-beta`) no cuentan. */
export function compararVersiones(a: string, b: string): -1 | 0 | 1 {
  const [pa, pb] = [partes(a), partes(b)];
  for (let i = 0; i < 3; i++) {
    if (pa[i]! > pb[i]!) return 1;
    if (pa[i]! < pb[i]!) return -1;
  }
  return 0;
}

/** Si `candidata` es una versión válida y mayor que `actual`. */
export const esMasNueva = (candidata: string | null, actual: string): boolean => candidata !== null && ES_VERSION.test(candidata) && compararVersiones(candidata, actual) > 0;
