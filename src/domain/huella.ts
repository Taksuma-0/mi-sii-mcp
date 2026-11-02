/**
 * Huella de una respuesta del SII: los nombres de sus campos como rutas (`data[].detMntNeto`), sin un solo valor. Sirve
 * para notar que el SII agregó o quitó campos (decisión 0010). Las llaves numéricas (códigos, años) se normalizan a `#`
 * y las filas de una lista se unen, para que dos meses con distintos datos tengan la misma huella.
 */
const PROFUNDIDAD_MAXIMA = 8;
const RUTAS_MAXIMAS = 400;
const LLAVE_NUMERICA = /^\d+$/;
const CAMPO_ARREGLO_BOLETAS = /arr_informe_mensual\['([A-Za-z_]+?)_\d+'\]/g;
const CAMPO_XML_BOLETAS = /xml_values\['(\w+)'\]/g;

function recorrer(valor: unknown, ruta: string, profundidad: number, rutas: Set<string>): void {
  if (rutas.size >= RUTAS_MAXIMAS || profundidad > PROFUNDIDAD_MAXIMA) return;
  if (Array.isArray(valor)) {
    const lista = `${ruta}[]`;
    if (profundidad + 1 > PROFUNDIDAD_MAXIMA) return;
    rutas.add(lista);
    for (const elemento of valor) recorrer(elemento, lista, profundidad + 1, rutas);
    return;
  }
  if (valor === null || typeof valor !== 'object') return;
  for (const [llave, hijo] of Object.entries(valor)) {
    if (rutas.size >= RUTAS_MAXIMAS) return;
    const nombre = LLAVE_NUMERICA.test(llave) ? '#' : llave;
    const siguiente = ruta === '' ? nombre : `${ruta}.${nombre}`;
    if (profundidad + 1 > PROFUNDIDAD_MAXIMA) return;
    rutas.add(siguiente);
    recorrer(hijo, siguiente, profundidad + 1, rutas);
  }
}

function deJson(cuerpo: string): string[] | null {
  let datos: unknown;
  try {
    datos = JSON.parse(cuerpo);
  } catch {
    return null;
  }
  const rutas = new Set<string>();
  recorrer(datos, '', 0, rutas);
  return [...rutas].sort();
}

function deBoletas(cuerpo: string): string[] | null {
  const rutas = new Set<string>();
  for (const m of cuerpo.matchAll(CAMPO_ARREGLO_BOLETAS)) rutas.add(`html:arr.${m[1]}`);
  for (const m of cuerpo.matchAll(CAMPO_XML_BOLETAS)) rutas.add(`html:xml.${m[1]}`);
  return rutas.size === 0 ? null : [...rutas].sort();
}

/** Rutas de los campos de una respuesta (JSON o página de boletas), ordenadas; null si no tiene una forma que describir (PDF, texto). */
export function huellaRespuesta(cuerpo: string): string[] | null {
  const inicio = cuerpo.trimStart();
  if (inicio.startsWith('{') || inicio.startsWith('[')) return deJson(inicio);
  return deBoletas(cuerpo);
}

/** Superficie de la huella: los segmentos numéricos (tipo de documento, código de DJ) se agrupan como `N`. */
export const superficieHuella = (superficie: string): string => superficie.replace(/\.\d+(?=\.|$)/g, '.N');
