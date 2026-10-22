import { extractTextItems } from 'unpdf';
import { CODIGOS_F29 } from './codigos-f29.js';

export interface TokenPdf {
  readonly s: string;
  readonly x: number;
}

const ES_MONTO = /^-?\d{1,3}(?:\.\d{3})+$|^-?\d+$/;
const ES_DECIMAL = /^\d+,\d+$/;
const PASO_PALABRA_X = 0.001;

const aNumero = (s: string): number => (ES_DECIMAL.test(s) ? Number(s.replace(',', '.')) : Number(s.replace(/\./g, '')));
const esValor = (s: string): boolean => ES_MONTO.test(s) || ES_DECIMAL.test(s);

/** Agrupa los textos del PDF en líneas (misma y, con tolerancia) y los parte en tokens ordenados por x. */
export function lineasDeItems(items: readonly { str: string; x: number; y: number }[], tolerancia = 2): TokenPdf[][] {
  const ordenados = items.filter((i) => i.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const lineas: { y: number; tokens: TokenPdf[] }[] = [];
  for (const item of ordenados) {
    let linea = lineas.find((l) => Math.abs(l.y - item.y) <= tolerancia);
    if (!linea) {
      linea = { y: item.y, tokens: [] };
      lineas.push(linea);
    }
    item.str
      .trim()
      .split(/\s+/)
      .forEach((parte, i) => linea.tokens.push({ s: parte, x: item.x + i * PASO_PALABRA_X }));
  }
  return lineas.map((l) => [...l.tokens].sort((a, b) => a.x - b.x));
}

/** Reserva el monto de cada celda desde la derecha, antes de buscar su código hacia la izquierda. */
export function codigosDesdeLineas(lineas: readonly (readonly TokenPdf[])[], conocidos: ReadonlySet<string> = CODIGOS_F29): Record<string, number> {
  const out: Record<string, number> = {};
  for (const tokens of lineas) {
    const tieneCodigoInicial = conocidos.has(tokens[0]?.s ?? '');
    const celdas: [string, number][] = [];
    let valor: string | null = null;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const s = tokens[i]!.s;
      const anterior = tokens[i - 1];
      // Sin código inicial, admite glosa-código-monto. Con celda ya iniciada, un numeral separado puede pertenecer a su glosa.
      const separadoTrasGlosa = !tieneCodigoInicial && anterior !== undefined && tokens[i]!.x - anterior.x > 2 * PASO_PALABRA_X && esValor(tokens[i + 1]?.s ?? '');
      if (valor !== null && conocidos.has(s) && (i === 0 || esValor(anterior!.s) || separadoTrasGlosa)) {
        celdas.push([s, aNumero(valor)]);
        valor = null;
      } else if (valor === null && esValor(s)) {
        valor = s;
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
