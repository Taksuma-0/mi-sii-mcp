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

  it('429 es SII_NO_DISPONIBLE y dice que el SII limitó las consultas', async () => {
    const { http, sumidero } = await preparar({ status: 429, headers: HTML, body: 'Too many requests' }, true);
    const error = await postSdi(http, sumidero, PEDIDO).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'SII_NO_DISPONIBLE' });
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
