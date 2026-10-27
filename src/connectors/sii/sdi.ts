import { randomUUID } from 'node:crypto';
import { ErrorMiSiiMcp } from '../../domain/errores.js';
import type { SumideroRespuestas } from '../../ports/index.js';
import { exigirSesion, type Http } from './http.js';

export const HOST_SDI = 'https://www4.sii.cl';

export interface PedidoSdi {
  readonly superficie: string;
  readonly url: string;
  readonly namespace: string;
  readonly referer: string;
  readonly data: Record<string, unknown>;
  /** El RCV incluye `metaData.page: null`; el F29 no. */
  readonly conPage?: boolean;
  /** Por defecto true: sin la cookie TOKEN no se pide. Solo las empresas autorizadas lo desactivan (se manda el TOKEN si existe). */
  readonly exigeToken?: boolean;
  /** Quita datos personales de la evidencia guardada; el parseo sigue usando el cuerpo completo. */
  readonly sanear?: (cuerpo: unknown) => unknown;
}

/** POST JSON a las fachadas SDI de www4 (RCV, F29). Guarda la respuesta cruda antes de interpretarla. */
export async function postSdi(http: Http, sumidero: SumideroRespuestas, pedido: PedidoSdi): Promise<unknown> {
  const token = await http.cookie(`${HOST_SDI}/`, 'TOKEN');
  if (!token && pedido.exigeToken !== false) {
    throw new ErrorMiSiiMcp('SESION_REQUERIDA', 'La sesión del SII no tiene la cookie TOKEN; hay que iniciar sesión de nuevo.');
  }
  const conversationId = token ?? '';
  const metaData: Record<string, unknown> = { namespace: pedido.namespace, conversationId, transactionId: randomUUID() };
  if (pedido.conPage) metaData['page'] = null;
  const r = exigirSesion(
    await http.solicitar(pedido.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', Origin: HOST_SDI, Referer: pedido.referer },
      body: JSON.stringify({ metaData, data: pedido.data }),
    }),
  );
  if (r.status === 401) throw new ErrorMiSiiMcp('SESION_REQUERIDA', 'El SII no reconoció la sesión (401).');
  if (r.status === 429) throw new ErrorMiSiiMcp('SII_LIMITE', 'El SII limitó las consultas; reintenta más tarde.');
  sumidero({ superficie: pedido.superficie, parametros: pedido.data, cuerpo: evidencia(r.texto, pedido.sanear, pedido.superficie), obtenidoEn: new Date().toISOString() });
  try {
    return JSON.parse(r.texto) as unknown;
  } catch {
    if (r.status === 403) throw new ErrorMiSiiMcp('SII_RECHAZO', `El SII rechazó la consulta de ${pedido.superficie} (403).`, { detalle: r.texto.slice(0, 500) });
    throw new ErrorMiSiiMcp('PORTAL_CAMBIO', `El SII no respondió JSON en ${pedido.superficie} (status ${r.status}).`, { detalle: r.texto.slice(0, 500) });
  }
}

/** Lo que queda en la evidencia en lugar del TOKEN de la sesión. */
export const TOKEN_REDACTADO = '[REDACTADO]';

/**
 * Las fachadas de www4 devuelven en `metaData.conversationId` la cookie TOKEN de la sesión: si viene, se reemplaza en el
 * cuerpo (ya parseado, una copia propia de la evidencia). Devuelve si cambió algo.
 */
function redactarToken(cuerpo: unknown): boolean {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) return false;
  const metaData = (cuerpo as Record<string, unknown>)['metaData'];
  if (typeof metaData !== 'object' || metaData === null || Array.isArray(metaData)) return false;
  const id = (metaData as Record<string, unknown>)['conversationId'];
  if (typeof id !== 'string' || id === '' || id === TOKEN_REDACTADO) return false;
  (metaData as Record<string, unknown>)['conversationId'] = TOKEN_REDACTADO;
  return true;
}

/**
 * El texto tal cual, o saneado si el pedido lo pide y el texto es JSON. Si es JSON, el TOKEN de `metaData.conversationId`
 * se redacta siempre, antes de sanear (y otra vez en lo que devuelve `sanear`). Si `sanear` falla, falla la consulta con
 * PORTAL_CAMBIO: nunca se guarda el cuerpo sin sanear. Si devuelve `undefined`, se guarda `null` explícito. Sin TOKEN que
 * redactar ni `sanear`, se guarda el texto original sin reformatear.
 */
function evidencia(texto: string, sanear: PedidoSdi['sanear'], superficie: string): string {
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return texto;
  }
  const redactado = redactarToken(cuerpo);
  if (!sanear) return redactado ? JSON.stringify(cuerpo) : texto;
  try {
    const saneado = sanear(cuerpo);
    redactarToken(saneado);
    return JSON.stringify(saneado) ?? 'null';
  } catch (cause) {
    throw new ErrorMiSiiMcp('PORTAL_CAMBIO', `No se pudo sanear la evidencia de ${superficie}.`, { cause });
  }
}
