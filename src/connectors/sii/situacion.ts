import { ErrorMiSiiMcp } from '../../domain/errores.js';
import type { AnotacionSii, CumplimientoSii, MensajeSii, RequisitoCumplimiento, SituacionSii } from '../../domain/situacion-sii.js';
import { esObjeto, texto } from './campos.js';
import { exigirSesion, type Http } from './http.js';
import { extraerDatosCntrNow, identidadDesde, URL_MI_SII } from './login.js';

/** Servicio de Mi SII que alimenta su portada (verificado en vivo el 01-11-2026, decisión 0009). */
export const URL_CARTAS_MI_SII = 'https://misiir.sii.cl/cgi_misii/CViewCarta.cgi';
/** Opciones del servicio: anotaciones vigentes, estado de cumplimiento y mensajes informativos. */
export const OPCION_MI_SII = { anotaciones: '28', cumplimiento: '118', mensajes: '33' } as const;
/** «Contribuyente no posee observaciones/alertas vigentes.» */
const SIN_ANOTACIONES = 97;
/** Ligadura «ti» de un documento de Word que el SII deja como carácter privado (U+10019F) en sus glosas. */
const LIGADURA_TI = /\u{10019F}/gu;

/** Glosa del SII en texto plano: sin etiquetas HTML ni entidades, con la ligadura «ti» restaurada y espacios simples. */
export function limpiarGlosa(v: unknown): string {
  return (texto(v) ?? '')
    .replace(LIGADURA_TI, 'ti')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** El SII entrega la descripción de la anotación ya recortada («glosaSubstr»): se marca el corte para no leerla como frase completa. */
const conCorte = (glosa: string): string => (glosa === '' || /[.!?:)»"]$/.test(glosa) ? glosa : `${glosa}…`);

const fechaIso = (v: unknown): string | null => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(texto(v) ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const cambio = (detalle: string): ErrorMiSiiMcp => new ErrorMiSiiMcp('PORTAL_CAMBIO', `Mi SII cambió la forma de ${detalle}.`);

export function anotacionesDesde(json: unknown): AnotacionSii[] {
  if (!esObjeto(json)) throw cambio('las anotaciones');
  if (Number(json['codigo']) === SIN_ANOTACIONES) return [];
  if (Number(json['codigo']) !== 0) throw cambio('las anotaciones');
  const lista = json['objSalida'] ?? [];
  if (!Array.isArray(lista)) throw cambio('las anotaciones');
  return lista.filter(esObjeto).map((a) => ({
    codigo: texto(a['taltCodigo']) ?? '',
    cantidad: Number(a['cantTaltCodigo']) || 1,
    fechaActivacion: fechaIso(a['fechaActivacion']),
    descripcion: conCorte(limpiarGlosa(a['glosaSubstr'])),
    accion: conCorte(limpiarGlosa(a['accionStr'])),
  }));
}

export function cumplimientoDesde(json: unknown): CumplimientoSii | null {
  if (!esObjeto(json)) throw cambio('el estado de cumplimiento');
  const atributos = json['atributos'];
  if (!Array.isArray(atributos)) return null;
  const requisitos = atributos.filter(esObjeto).map(
    (a): RequisitoCumplimiento => ({
      codigo: texto(a['atrCodigo']) ?? '',
      condicion: texto(a['condicion']),
      titulo: limpiarGlosa(a['titulo']),
      cumple: a['cumple'] === 'SI' ? true : a['cumple'] === 'NO' ? false : null,
    }),
  );
  return { estado: texto(json['estado']), periodo: texto(json['semestreActual']), requisitos };
}

export function mensajesDesde(json: unknown): MensajeSii[] {
  if (!esObjeto(json)) throw cambio('los mensajes');
  const lista = json['mensajes'];
  if (!Array.isArray(lista)) return [];
  return lista.filter(esObjeto).map((m) => ({ titulo: limpiarGlosa(m['glosaTitulo']), descripcion: limpiarGlosa(m['glosaDescripcion']), solucion: limpiarGlosa(m['glosaSolucion']) || null }));
}

async function pedir(http: Http, opcion: string): Promise<unknown> {
  const r = exigirSesion(
    await http.solicitar(URL_CARTAS_MI_SII, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: URL_MI_SII },
      body: `opc=${opcion}&VIEW=1`,
    }),
  );
  try {
    return JSON.parse(r.texto);
  } catch {
    throw cambio(`responder la opción ${opcion}`);
  }
}

/**
 * Lee en Mi SII, con la sesión activa, las anotaciones vigentes, el estado de cumplimiento y los mensajes informativos.
 * Mi SII entrega los datos de quien inició sesión: si es otro contribuyente que `rut`, no devuelve nada. Solo lectura.
 */
export async function situacionSii(http: Http, rut: string): Promise<SituacionSii> {
  const datos = extraerDatosCntrNow(exigirSesion(await http.solicitar(URL_MI_SII)).texto);
  if (!datos) throw new ErrorMiSiiMcp('SESION_REQUERIDA', 'El SII no entregó los datos del contribuyente; la sesión no está activa.');
  const identidad = identidadDesde(datos);
  if (identidad.rut !== rut) throw new ErrorMiSiiMcp('PORTAL_CAMBIO', `Mi SII entregó los datos de ${identidad.rut} en vez de ${rut}.`);
  const anotaciones = anotacionesDesde(await pedir(http, OPCION_MI_SII.anotaciones));
  const cumplimiento = cumplimientoDesde(await pedir(http, OPCION_MI_SII.cumplimiento));
  const mensajes = mensajesDesde(await pedir(http, OPCION_MI_SII.mensajes));
  return { anotaciones, cumplimiento, mensajes };
}
