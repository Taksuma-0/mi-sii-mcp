import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { postSdi, type PedidoSdi } from '../../src/connectors/sii/sdi.js';
import type { RespuestaCruda } from '../../src/domain/tipos.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, HTML, JSON_CT, sinEsperas, type DefRespuesta } from '../helpers/http-falso.js';

const URL_PEDIDO = 'https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getResumen';
const RUTA = `POST ${URL_PEDIDO}`;
const PEDIDO: PedidoSdi = { superficie: 'rcv.resumen.COMPRA.REGISTRO', url: URL_PEDIDO, namespace: 'ns/getResumen', referer: 'https://www4.sii.cl/ref', data: { a: 1 } };

async function preparar(respuesta: DefRespuesta, conToken: boolean) {
  const { fetchFalso, llamadas } = crearFetchFalso({ [RUTA]: respuesta });
  const jar = new CookieJar();
  if (conToken) await jar.setCookie('TOKEN=tok123; Domain=.sii.cl; Path=/', 'https://www4.sii.cl/');
  const http = new ClienteHttp(jar, { fetch: fetchFalso, temporizador: sinEsperas });
  const crudas: RespuestaCruda[] = [];
  return { http, llamadas, crudas, sumidero: (r: RespuestaCruda) => void crudas.push(r) };
}

const OK: DefRespuesta = { headers: JSON_CT, body: '{"data":[]}' };

describe('postSdi', () => {
  it('sin cookie TOKEN exige sesión antes de pedir: no hay fetch ni respuesta cruda', async () => {
    const { http, llamadas, crudas, sumidero } = await preparar(OK, false);
    expect(await codigoDe(postSdi(http, sumidero, PEDIDO))).toBe('SESION_REQUERIDA');
    expect(llamadas).toHaveLength(0);
    expect(crudas).toHaveLength(0);
  });

  it('con TOKEN lo manda como conversationId', async () => {
    const { http, llamadas, sumidero } = await preparar(OK, true);
    await postSdi(http, sumidero, PEDIDO);
    const cuerpo = JSON.parse(llamadas[0]!.body!) as { metaData: Record<string, unknown> };
    expect(cuerpo.metaData['conversationId']).toBe('tok123');
  });

  it('con exigeToken false y sin TOKEN pide igual con conversationId vacío', async () => {
    const { http, llamadas, sumidero } = await preparar(OK, false);
    await postSdi(http, sumidero, { ...PEDIDO, exigeToken: false });
    expect(llamadas).toHaveLength(1);
    const cuerpo = JSON.parse(llamadas[0]!.body!) as { metaData: Record<string, unknown> };
    expect(cuerpo.metaData['conversationId']).toBe('');
  });

  it('con exigeToken false y con TOKEN lo manda igual', async () => {
    const { http, llamadas, sumidero } = await preparar(OK, true);
    await postSdi(http, sumidero, { ...PEDIDO, exigeToken: false });
    const cuerpo = JSON.parse(llamadas[0]!.body!) as { metaData: Record<string, unknown> };
    expect(cuerpo.metaData['conversationId']).toBe('tok123');
  });

  it('401 es SESION_REQUERIDA', async () => {
    const { http, sumidero } = await preparar({ status: 401, headers: HTML, body: 'No autorizado' }, true);
    expect(await codigoDe(postSdi(http, sumidero, PEDIDO))).toBe('SESION_REQUERIDA');
  });

  it('429 es SII_LIMITE (fatal) y dice que el SII limitó las consultas', async () => {
    const { http, sumidero } = await preparar({ status: 429, headers: HTML, body: 'Too many requests' }, true);
    const error = await postSdi(http, sumidero, PEDIDO).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'SII_LIMITE' });
    expect((error as Error).message).toContain('limitó las consultas; reintenta más tarde');
  });

  it('403 con cuerpo que no es JSON es SII_RECHAZO', async () => {
    const { http, sumidero } = await preparar({ status: 403, headers: HTML, body: '<html>Acceso denegado</html>' }, true);
    expect(await codigoDe(postSdi(http, sumidero, PEDIDO))).toBe('SII_RECHAZO');
  });

  it('403 con cuerpo JSON se interpreta como cualquier respuesta JSON', async () => {
    const { http, sumidero } = await preparar({ status: 403, headers: JSON_CT, body: '{"metaData":{"errors":[{"descripcion":"No autorizado"}]}}' }, true);
    expect(await postSdi(http, sumidero, PEDIDO)).toEqual({ metaData: { errors: [{ descripcion: 'No autorizado' }] } });
  });

  it('un 200 que no es JSON sigue siendo PORTAL_CAMBIO', async () => {
    const { http, sumidero } = await preparar({ headers: HTML, body: '<html>otra cosa</html>' }, true);
    expect(await codigoDe(postSdi(http, sumidero, PEDIDO))).toBe('PORTAL_CAMBIO');
  });
});

describe('postSdi: saneo de la evidencia', () => {
  const CUERPO = '{"data":{"rut":"11111111-1","valor":5}}';
  const sanear = (c: unknown): unknown => ({ ...(c as { data: Record<string, unknown> }), data: { valor: (c as { data: { valor: number } }).data.valor } });

  it('el sumidero recibe la evidencia saneada y el parseo ve el cuerpo completo', async () => {
    const { http, crudas, sumidero } = await preparar({ headers: JSON_CT, body: CUERPO }, true);
    const r = await postSdi(http, sumidero, { ...PEDIDO, sanear });
    expect(r).toEqual({ data: { rut: '11111111-1', valor: 5 } });
    expect(crudas).toHaveLength(1);
    expect(crudas[0]!.cuerpo).toBe('{"data":{"valor":5}}');
  });

  it('sin sanear guarda el texto tal cual', async () => {
    const { http, crudas, sumidero } = await preparar({ headers: JSON_CT, body: CUERPO }, true);
    await postSdi(http, sumidero, PEDIDO);
    expect(crudas[0]!.cuerpo).toBe(CUERPO);
  });

  it('si sanear devuelve undefined se guarda el texto "null", nunca undefined', async () => {
    const { http, crudas, sumidero } = await preparar({ headers: JSON_CT, body: CUERPO }, true);
    const r = await postSdi(http, sumidero, { ...PEDIDO, sanear: () => undefined });
    expect(r).toEqual({ data: { rut: '11111111-1', valor: 5 } });
    expect(crudas).toHaveLength(1);
    expect(crudas[0]!.cuerpo).toBe('null');
  });

  it('si sanear lanza falla como PORTAL_CAMBIO y el sumidero nunca recibe el cuerpo', async () => {
    const { http, crudas, sumidero } = await preparar({ headers: JSON_CT, body: CUERPO }, true);
    const error = await postSdi(http, sumidero, { ...PEDIDO, sanear: () => { throw new TypeError('forma inesperada'); } }).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'PORTAL_CAMBIO', message: `No se pudo sanear la evidencia de ${PEDIDO.superficie}.` });
    expect(crudas).toHaveLength(0);
  });

  it('un cuerpo que no es JSON llega al sumidero tal cual, sin llamar a sanear', async () => {
    const { http, crudas, sumidero } = await preparar({ headers: HTML, body: '<html>otra cosa</html>' }, true);
    let llamado = false;
    await postSdi(http, sumidero, { ...PEDIDO, sanear: (c) => { llamado = true; return c; } }).catch(() => undefined);
    expect(crudas[0]!.cuerpo).toBe('<html>otra cosa</html>');
    expect(llamado).toBe(false);
  });
});

describe('postSdi: el TOKEN no queda en la evidencia', () => {
  /** Las fachadas de www4 devuelven en `metaData.conversationId` la cookie TOKEN de la sesión. */
  const CON_TOKEN = '{"data":{"valor":5},"metaData":{"conversationId":"tok123","transactionId":"t-1","errors":null}}';

  it('sin sanear guarda la evidencia con conversationId redactado y el parseo ve el cuerpo completo', async () => {
    const { http, crudas, sumidero } = await preparar({ headers: JSON_CT, body: CON_TOKEN }, true);
    const r = await postSdi(http, sumidero, PEDIDO);
    expect(r).toEqual(JSON.parse(CON_TOKEN));
    expect(crudas[0]!.cuerpo).not.toContain('tok123');
    expect(JSON.parse(crudas[0]!.cuerpo)).toEqual({ data: { valor: 5 }, metaData: { conversationId: '[REDACTADO]', transactionId: 't-1', errors: null } });
  });

  it('con sanear, sanear recibe el cuerpo ya redactado y lo que devuelve tampoco lleva el TOKEN', async () => {
    const { http, crudas, sumidero } = await preparar({ headers: JSON_CT, body: CON_TOKEN }, true);
    let visto: unknown;
    const r = await postSdi(http, sumidero, { ...PEDIDO, sanear: (c) => { visto = c; return c; } });
    expect((r as { metaData: { conversationId: string } }).metaData.conversationId).toBe('tok123');
    expect(JSON.stringify(visto)).not.toContain('tok123');
    expect(crudas[0]!.cuerpo).not.toContain('tok123');
    expect(crudas[0]!.cuerpo).toContain('[REDACTADO]');
  });

  it('un 403 JSON con el TOKEN también se guarda redactado', async () => {
    const { http, crudas, sumidero } = await preparar({ status: 403, headers: JSON_CT, body: '{"metaData":{"conversationId":"tok123","errors":[{"descripcion":"No autorizado"}]}}' }, true);
    await postSdi(http, sumidero, PEDIDO);
    expect(crudas[0]!.cuerpo).not.toContain('tok123');
  });

  it('sin conversationId (o vacío) guarda el texto tal cual', async () => {
    const vacio = '{"data":1,"metaData":{"conversationId":"","errors":null}}';
    const { http, crudas, sumidero } = await preparar({ headers: JSON_CT, body: vacio }, true);
    await postSdi(http, sumidero, PEDIDO);
    expect(crudas[0]!.cuerpo).toBe(vacio);
  });
});
