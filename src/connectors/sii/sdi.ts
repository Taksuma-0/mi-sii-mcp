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
}

/** POST JSON a las fachadas SDI de www4 (RCV, F29). Guarda la respuesta cruda antes de interpretarla. */
export async function postSdi(http: Http, sumidero: SumideroRespuestas, pedido: PedidoSdi): Promise<unknown> {
  const conversationId = (await http.cookie(`${HOST_SDI}/`, 'TOKEN')) ?? '';
  const metaData: Record<string, unknown> = { namespace: pedido.namespace, conversationId, transactionId: randomUUID() };
  if (pedido.conPage) metaData['page'] = null;
  const r = exigirSesion(
    await http.solicitar(pedido.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', Origin: HOST_SDI, Referer: pedido.referer },
      body: JSON.stringify({ metaData, data: pedido.data }),
    }),
  );
  sumidero({ superficie: pedido.superficie, parametros: pedido.data, cuerpo: r.texto, obtenidoEn: new Date().toISOString() });
  try {
    return JSON.parse(r.texto) as unknown;
  } catch {
    throw new ErrorImpuestocl('PORTAL_CAMBIO', `El SII no respondió JSON en ${pedido.superficie} (status ${r.status}).`, { detalle: r.texto.slice(0, 500) });
  }
}
