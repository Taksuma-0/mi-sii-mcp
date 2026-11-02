import { escaparHtml } from './plantilla.js';

/**
 * Gráfico de barras horizontales en SVG, sin scripts (el informe no los permite): una sola serie, así que no lleva
 * leyenda; el título de la figura dice qué se grafica. Cada barra tiene su valor en la punta y un `<title>` que el
 * navegador muestra al pasar el mouse sobre toda la fila. Los valores bajo cero (una devolución) crecen hacia la
 * izquierda desde la línea del cero.
 */

export interface PuntoSerie {
  readonly etiqueta: string;
  readonly valor: number;
}

export interface OpcionesBarras {
  readonly formato?: (n: number) => string;
}

/** Turquesa de la marca con croma y contraste suficientes sobre blanco (validado: ≥ 3:1 y croma ≥ 0,1). */
export const COLOR_BARRA = '#00897b';
const TEXTO = '#183047';
const LINEA = '#c9d4e0';

const ANCHO = 880;
const ANCHO_ETIQUETA = 168;
const ESPACIO_VALOR = 104;
const ALTO_FILA = 32;
const GROSOR = 16;
const RADIO = 4;
const MARGEN_VERTICAL = 8;
const MAX_ETIQUETA = 26;

const n = (v: number): string => String(Math.round(v * 10) / 10);

/** Barra con el extremo de datos redondeado y el lado de la línea base recto. */
function barra(base: number, fin: number, arriba: number): string {
  const ancho = Math.abs(fin - base);
  if (ancho === 0) return '';
  const r = Math.min(RADIO, ancho, GROSOR / 2);
  const abajo = arriba + GROSOR;
  const s = fin > base ? 1 : -1;
  const codo = fin - s * r;
  return `<path d="M${n(base)} ${n(arriba)}H${n(codo)}A${r} ${r} 0 0 ${s > 0 ? 1 : 0} ${n(fin)} ${n(arriba + r)}V${n(abajo - r)}A${r} ${r} 0 0 ${s > 0 ? 1 : 0} ${n(codo)} ${n(abajo)}H${n(base)}Z" fill="${COLOR_BARRA}"/>`;
}

const recortar = (texto: string): string => (texto.length > MAX_ETIQUETA ? `${texto.slice(0, MAX_ETIQUETA - 1)}…` : texto);

export function barras(series: readonly PuntoSerie[], opciones: OpcionesBarras = {}): string {
  if (series.length === 0) return '';
  const formato = opciones.formato ?? ((v: number) => String(v));
  const valores = series.map((p) => (Number.isFinite(p.valor) ? p.valor : 0));
  const maximo = Math.max(0, ...valores);
  const minimo = Math.min(0, ...valores);
  const rango = maximo - minimo || 1;
  const desde = ANCHO_ETIQUETA;
  const hasta = ANCHO - ESPACIO_VALOR;
  const x = (v: number): number => desde + ((v - minimo) / rango) * (hasta - desde);
  const cero = x(0);
  const alto = series.length * ALTO_FILA + MARGEN_VERTICAL * 2;
  const descripcion = series.map((p, i) => `${p.etiqueta}: ${formato(valores[i] ?? 0)}`).join('; ');

  const filas = series.map((p, i) => {
    const valor = valores[i] ?? 0;
    const y = MARGEN_VERTICAL + i * ALTO_FILA;
    const arriba = y + (ALTO_FILA - GROSOR) / 2;
    const medio = y + ALTO_FILA / 2;
    const fin = x(valor);
    const texto = escaparHtml(formato(valor));
    return [
      `<g><title>${escaparHtml(p.etiqueta)}: ${texto}</title>`,
      `<rect x="0" y="${n(y)}" width="${ANCHO}" height="${ALTO_FILA}" fill="transparent"/>`,
      `<text x="${desde - 8}" y="${n(medio)}" text-anchor="end" dominant-baseline="middle" fill="${TEXTO}">${escaparHtml(recortar(p.etiqueta))}</text>`,
      barra(cero, fin, arriba),
      `<text x="${n(Math.max(fin, cero) + 6)}" y="${n(medio)}" dominant-baseline="middle" fill="${TEXTO}" font-weight="600">${texto}</text></g>`,
    ].join('');
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ANCHO} ${alto}" width="100%" role="img" aria-label="${escaparHtml(descripcion)}" font-size="13">`,
    `<line x1="${n(cero)}" y1="${MARGEN_VERTICAL}" x2="${n(cero)}" y2="${alto - MARGEN_VERTICAL}" stroke="${LINEA}" stroke-width="1"/>`,
    ...filas,
    '</svg>',
  ].join('');
}
