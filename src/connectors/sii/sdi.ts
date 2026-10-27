import { randomUUID } from 'node:crypto';
import { ErrorImpuestocl } from '../../domain/errores.js';
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
    throw new ErrorImpuestocl('SESION_REQUERIDA', 'La sesión del SII no tiene la cookie TOKEN; hay que iniciar sesión de nuevo.');
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
  if (r.status === 401) throw new ErrorImpuestocl('SESION_REQUERIDA', 'El SII no reconoció la sesión (401).');
  if (r.status === 429) throw new ErrorImpuestocl('SII_NO_DISPONIBLE', 'El SII limitó las consultas; reintenta más tarde.');
  sumidero({ superficie: pedido.superficie, parametros: pedido.data, cuerpo: evidencia(r.texto, pedido.sanear), obtenidoEn: new Date().toISOString() });
  try {
    return JSON.parse(r.texto) as unknown;
  } catch {
    if (r.status === 403) throw new ErrorImpuestocl('SII_RECHAZO', `El SII rechazó la consulta de ${pedido.superficie} (403).`, { detalle: r.texto.slice(0, 500) });
    throw new ErrorImpuestocl('PORTAL_CAMBIO', `El SII no respondió JSON en ${pedido.superficie} (status ${r.status}).`, { detalle: r.texto.slice(0, 500) });
  }
}

/** El texto tal cual, o saneado si el pedido lo pide y el texto es JSON. Si `sanear` falla, falla la consulta: nunca se guarda el cuerpo sin sanear. */
function evidencia(texto: string, sanear: PedidoSdi['sanear']): string {
  if (!sanear) return texto;
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return texto;
  }
  return JSON.stringify(sanear(cuerpo));
}
