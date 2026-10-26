import { extractTextItems } from 'unpdf';
import { CODIGOS_F29 } from './codigos-f29.js';

export interface TokenPdf {
  readonly s: string;
  readonly x: number;
  /**
   * El token es un código que inicia una celda: en una línea que empieza con un número, un texto completo de 1 a 4
   * dígitos seguido de un texto con letras (su glosa) que es el primero de la línea, sigue a un texto sin letras (el
   * valor de la celda izquierda) o, bajo la cabecera de la tabla, está en una columna de código (la celda izquierda no
   * tenía valor). Es límite de celda aunque no esté en el catálogo y nunca es un valor. Sin el campo, se infiere del
   * contexto.
   */
  readonly inicioCelda?: boolean;
  /** El token es un número suelto entre dos textos con letras fuera de una columna de código (una glosa partida): ni valor ni código. */
  readonly enGlosa?: boolean;
}

const ES_MONTO = /^-?\d{1,3}(?:\.\d{3})+$|^-?\d+$/;
/** Coma decimal, o punto decimal con `0.` inicial o 1 a 2 decimales (`0.5`, `1.25`); 3 dígitos tras un punto son miles. */
const ES_DECIMAL = /^-?\d+,\d+$|^-?0\.\d+$|^-?\d+\.\d{1,2}$/;
const ES_CODIGO_DE_CELDA = /^\d{1,4}$/;
const TIENE_LETRAS = /\p{L}/u;
const PASO_PALABRA_X = 0.001;

const aNumero = (s: string): number => (ES_DECIMAL.test(s) ? Number(s.replace(',', '.')) : Number(s.replace(/\./g, '')));
const esValor = (s: string): boolean => ES_MONTO.test(s) || ES_DECIMAL.test(s);
/** La cabecera de la tabla del PDF compacto («Código Glosa Valor», una vez por columna). */
const PALABRAS_CABECERA = ['código', 'glosa', 'valor'];
const esCabeceraDeTabla = (textos: readonly string[]): boolean => PALABRAS_CABECERA.every((p) => textos.some((t) => t.toLowerCase() === p));
/** Cada código de la tabla va entre 3 y 5 puntos a la derecha del «Código» de su columna en la cabecera. */
const HOLGURA_COLUMNA_CODIGO = { antes: 2, despues: 10 } as const;
/** El PDF trae algunos códigos con ceros a la izquierda (`077`); el catálogo y la salida usan la forma sin ellos (`77`). */
const codigoNormalizado = (s: string): string => (/^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s);

/** Agrupa los textos del PDF en líneas (misma y, con tolerancia) y los parte en tokens ordenados por x. */
export function lineasDeItems(items: readonly { str: string; x: number; y: number }[], tolerancia = 2): TokenPdf[][] {
  const ordenados = items.filter((i) => i.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const lineas: { y: number; items: { str: string; x: number }[] }[] = [];
  for (const item of ordenados) {
    let linea = lineas.find((l) => Math.abs(l.y - item.y) <= tolerancia);
    if (!linea) {
      linea = { y: item.y, items: [] };
      lineas.push(linea);
    }
    linea.items.push({ str: item.str.trim(), x: item.x });
  }
  // Columnas de código de la tabla: la x de cada «Código» de su cabecera, si la página la tiene.
  const indiceCabecera = lineas.findIndex((l) => esCabeceraDeTabla(l.items.flatMap((i) => i.str.split(/\s+/))));
  const columnasCodigo = indiceCabecera < 0 ? [] : lineas[indiceCabecera]!.items.filter((i) => i.str.toLowerCase() === 'código').map((i) => i.x);
  const enColumnaDeCodigo = (x: number): boolean => columnasCodigo.some((c) => x >= c - HOLGURA_COLUMNA_CODIGO.antes && x <= c + HOLGURA_COLUMNA_CODIGO.despues);
  return lineas.map((l, indice) => {
    const enOrden = [...l.items].sort((a, b) => a.x - b.x);
    const bajoCabecera = indiceCabecera >= 0 && indice > indiceCabecera;
    // Una línea que empieza con glosa (el pie: glosa-código-monto) no tiene celdas: tras el monto puede venir una unidad.
    const empiezaConGlosa = TIENE_LETRAS.test(enOrden[0]?.str ?? '');
    return enOrden.flatMap((item, i) => {
      // En la tabla del PDF compacto cada texto es una celda completa: un número suelto seguido de su glosa es un código.
      // Tras otro texto con letras es parte de esa glosa, salvo que esté en una columna de código de la cabecera: entonces
      // la celda izquierda no tenía valor y este número abre la siguiente.
      const siguiente = enOrden[i + 1];
      if (!empiezaConGlosa && ES_CODIGO_DE_CELDA.test(item.str) && siguiente !== undefined && TIENE_LETRAS.test(siguiente.str)) {
        const anterior = enOrden[i - 1];
        const trasGlosa = anterior !== undefined && TIENE_LETRAS.test(anterior.str);
        if (trasGlosa && !(bajoCabecera && enColumnaDeCodigo(item.x))) return [{ s: item.str, x: item.x, enGlosa: true }];
        return [{ s: item.str, x: item.x, inicioCelda: true }];
      }
      return item.str.split(/\s+/).map((parte, j) => ({ s: parte, x: item.x + j * PASO_PALABRA_X }));
    });
  });
}

/**
 * Reserva el monto de cada celda desde la derecha, antes de buscar su código hacia la izquierda. Bajo la cabecera de la
 * tabla («Código Glosa Valor») se lee toda celda con valor, esté o no su código en `conocidos`; sobre ella (la
 * identificación del contribuyente) o en una página sin cabecera, solo los códigos de `conocidos`.
 */
export function codigosDesdeLineas(lineas: readonly (readonly TokenPdf[])[], conocidos: ReadonlySet<string> = CODIGOS_F29): Record<string, number> {
  const out: Record<string, number> = {};
  let bajoCabecera = false;
  for (const tokens of lineas) {
    if (esCabeceraDeTabla(tokens.map((t) => t.s))) {
      bajoCabecera = true;
      continue;
    }
    const primero = tokens[0];
    const tieneCodigoInicial = primero !== undefined && (primero.inicioCelda === true || conocidos.has(codigoNormalizado(primero.s)));
    const celdas: [string, number][] = [];
    let valor: string | null = null;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i]!;
      if (token.enGlosa) continue;
      const codigo = codigoNormalizado(token.s);
      if (token.inicioCelda) {
        // El valor reservado es de esta celda: se guarda si la celda está en la tabla o su código es conocido; si no, se descarta.
        if (valor !== null && (bajoCabecera || conocidos.has(codigo))) celdas.push([codigo, aNumero(valor)]);
        valor = null;
        continue;
      }
      const anterior = tokens[i - 1];
      // Sin código inicial, admite glosa-código-monto. Con celda ya iniciada, un numeral separado puede pertenecer a su glosa.
      const separadoTrasGlosa = !tieneCodigoInicial && anterior !== undefined && token.x - anterior.x > 2 * PASO_PALABRA_X && esValor(tokens[i + 1]?.s ?? '');
      if (valor !== null && conocidos.has(codigo) && (i === 0 || (!anterior!.enGlosa && esValor(anterior!.s)) || separadoTrasGlosa)) {
        celdas.push([codigo, aNumero(valor)]);
        valor = null;
      } else if (valor === null && esValor(token.s)) {
        valor = token.s;
      }
    }
    // Se recorrieron las celdas al revés; restablece el orden para conservar la primera aparición.
    for (const [codigo, monto] of celdas.reverse()) {
      if (!(codigo in out)) out[codigo] = monto;
    }
  }
  return out;
}

export async function extraerCodigosF29(bytes: Uint8Array): Promise<Record<string, number>> {
  const { items } = await extractTextItems(new Uint8Array(bytes));
  const out: Record<string, number> = {};
  for (const pagina of items) {
    for (const [codigo, valor] of Object.entries(codigosDesdeLineas(lineasDeItems(pagina)))) {
      if (!(codigo in out)) out[codigo] = valor;
    }
  }
  return out;
}
