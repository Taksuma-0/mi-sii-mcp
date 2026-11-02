import { estado } from '../presentacion.js';

/**
 * El informe visual: un HTML autónomo (sin fuentes, scripts ni imágenes de fuera) que se abre en el navegador y se
 * imprime o guarda como PDF. Todo texto pasa por `escaparHtml`; los SVG de `graficos` llegan ya escapados.
 */

export type EstadoTarjeta = 'ok' | 'advertencia' | 'critico';

export interface TarjetaInforme {
  readonly etiqueta: string;
  readonly valor: string;
  readonly estado?: EstadoTarjeta;
}

export interface GraficoInforme {
  readonly titulo: string;
  /** SVG armado por `barras()`, que ya escapa sus textos: se inserta tal cual. */
  readonly svg: string;
}

export interface TablaInforme {
  readonly titulo: string;
  readonly encabezados: readonly string[];
  readonly filas: readonly (readonly string[])[];
}

export interface ContenidoInforme {
  readonly titulo: string;
  readonly subtitulo: string;
  readonly generado: string;
  /** La misma primera línea que la respuesta del chat (ícono y conclusión). */
  readonly conclusion?: string;
  readonly tarjetas: readonly TarjetaInforme[];
  readonly graficos: readonly GraficoInforme[];
  readonly tablas: readonly TablaInforme[];
  readonly avisos: readonly string[];
}

const ENTIDADES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escaparHtml = (texto: string): string => texto.replace(/[&<>"']/g, (c) => ENTIDADES[c] ?? c);

/** El estado se lee por el ícono y su texto, no solo por el color del borde. */
const TEXTO_ESTADO: Readonly<Record<EstadoTarjeta, string>> = { ok: 'Al día', advertencia: 'Revisar', critico: 'Urgente' };

const CSP = `default-src 'none'; style-src 'unsafe-inline'; img-src data:`;

const ESTILOS = `
:root{color-scheme:light;--marino:#0f2a44;--turquesa:#3dd6c3;--texto:#183047;--suave:#4f6276;--borde:#dbe4ee;--fondo:#f4f7fb;--linea:#eef2f7;--ok:#0ca30c;--advertencia:#fab219;--critico:#d03b3b}
*{box-sizing:border-box}
body{margin:0;background:var(--fondo);color:var(--texto);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:var(--marino);color:#fff;border-bottom:4px solid var(--turquesa)}
.hoja{max-width:980px;margin:0 auto;padding:0 24px}
header .hoja{padding-top:26px;padding-bottom:22px}
.marca{margin:0 0 6px;font-size:12.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--turquesa)}
h1{margin:0;font-size:28px;line-height:1.2}
.subtitulo{margin:6px 0 0;color:#d6e2ee}
main{padding-bottom:32px}
.conclusion{margin:22px 0 0;padding:14px 18px;background:#fff;border:1px solid var(--borde);border-radius:8px;font-size:17px;font-weight:600;color:var(--marino)}
.tarjetas{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin:24px 0 8px}
.tarjeta{background:#fff;border:1px solid var(--borde);border-left:4px solid var(--borde);border-radius:8px;padding:14px 16px}
.tarjeta.ok{border-left-color:var(--ok)}.tarjeta.advertencia{border-left-color:var(--advertencia)}.tarjeta.critico{border-left-color:var(--critico)}
.etiqueta{margin:0;color:var(--suave);font-size:13px}
.valor{margin:4px 0 0;font-size:22px;font-weight:650;line-height:1.25;overflow-wrap:anywhere}
.estado{margin:6px 0 0;font-size:13px;color:var(--suave)}
section{background:#fff;border:1px solid var(--borde);border-radius:8px;padding:18px 20px;margin:16px 0}
h2{margin:0 0 12px;font-size:17px;color:var(--marino)}
figure{margin:0}
.desplazable{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
th{text-align:left;color:var(--suave);font-weight:600;border-bottom:1px solid var(--borde);padding:6px 8px;white-space:nowrap}
td{border-bottom:1px solid var(--linea);padding:6px 8px;vertical-align:top}
.num{text-align:right;white-space:nowrap}
.fecha{white-space:nowrap}
.avisos ul{margin:0;padding:0;list-style:none}
.avisos li{padding:7px 0;border-bottom:1px solid var(--linea)}
.avisos li:last-child{border-bottom:0}
footer{color:var(--suave);font-size:12.5px;padding:8px 0 32px}
@media print{
body{background:#fff;font-size:12px}
header{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.hoja{max-width:none;padding:0 4px}
section,.tarjeta,tr{break-inside:avoid}
.desplazable{overflow:visible}
@page{size:A4;margin:14mm}
}`;

/** Monto o cantidad: se alinea a la derecha para comparar cifras de un vistazo. */
const esNumero = (celda: string): boolean => /^-?\$?[\d.,]+$/.test(celda.trim());
const esFecha = (celda: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(celda.trim());

/** La clase de una columna: `num` si todas sus celdas son cifras, `fecha` si son fechas (que no se parten en dos líneas). */
function claseColumna(t: TablaInforme, i: number): string {
  const celdas = t.filas.map((f) => f[i] ?? '').filter((c) => c !== '' && c !== '—');
  if (celdas.length === 0) return '';
  if (celdas.every(esNumero)) return ' class="num"';
  return celdas.every(esFecha) ? ' class="fecha"' : '';
}

function htmlTarjeta(t: TarjetaInforme): string {
  const marca = t.estado ? `<p class="estado">${estado(t.estado)} <span>${TEXTO_ESTADO[t.estado]}</span></p>` : '';
  return `<div class="tarjeta${t.estado ? ` ${t.estado}` : ''}"><p class="etiqueta">${escaparHtml(t.etiqueta)}</p><p class="valor">${escaparHtml(t.valor)}</p>${marca}</div>`;
}

function htmlTabla(t: TablaInforme): string {
  const clases = t.encabezados.map((_, i) => claseColumna(t, i));
  const clase = (i: number): string => clases[i] ?? '';
  const cabecera = t.encabezados.map((e, i) => `<th scope="col"${clase(i)}>${escaparHtml(e)}</th>`).join('');
  const cuerpo = t.filas.map((f) => `<tr>${t.encabezados.map((_, i) => `<td${clase(i)}>${escaparHtml(f[i] ?? '')}</td>`).join('')}</tr>`).join('');
  return `<section><h2>${escaparHtml(t.titulo)}</h2><div class="desplazable"><table><thead><tr>${cabecera}</tr></thead><tbody>${cuerpo}</tbody></table></div></section>`;
}

export function paginaInforme(c: ContenidoInforme): string {
  const tarjetas = c.tarjetas.length > 0 ? `<div class="tarjetas">${c.tarjetas.map(htmlTarjeta).join('')}</div>` : '';
  const graficos = c.graficos.map((g) => `<section><h2>${escaparHtml(g.titulo)}</h2><figure>${g.svg}</figure></section>`).join('');
  const avisos = c.avisos.length > 0 ? `<section class="avisos"><h2>Para tener en cuenta</h2><ul>${c.avisos.map((a) => `<li>${escaparHtml(a)}</li>`).join('')}</ul></section>` : '';
  return [
    '<!DOCTYPE html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escaparHtml(c.titulo)} · mi-sii-mcp</title>`,
    `<style>${ESTILOS}</style>`,
    '</head>',
    '<body>',
    `<header><div class="hoja"><p class="marca">mi-sii-mcp · informe</p><h1>${escaparHtml(c.titulo)}</h1><p class="subtitulo">${escaparHtml(c.subtitulo)}</p></div></header>`,
    `<main class="hoja">${c.conclusion ? `<p class="conclusion">${escaparHtml(c.conclusion)}</p>` : ''}${tarjetas}${graficos}${c.tablas.map(htmlTabla).join('')}${avisos}</main>`,
    `<footer class="hoja">Generado el ${escaparHtml(c.generado)} con mi-sii-mcp, a partir de los datos guardados en tu equipo: no se consultó al SII y nada salió del equipo. No es un documento oficial del SII ni asesoría tributaria; confirma las cifras con tu contador.</footer>`,
    '</body>',
    '</html>',
  ].join('\n');
}
