import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { transportePipe } from '../../src/connectors/navegador/cdp.js';

/**
 * Tuberías falsas como las de `--remote-debugging-pipe`: el navegador lee las órdenes de una y escribe las respuestas en
 * otra, cada mensaje JSON terminado en NUL. Nunca se lanza un navegador real.
 */
function tuberias(responder: (mensaje: { id: number; method: string }) => unknown[] | null = (m) => [{ id: m.id, result: {} }]) {
  const haciaNavegador = new PassThrough();
  const desdeNavegador = new PassThrough();
  const recibidos: { id: number; method: string; params: unknown }[] = [];
  let pendiente = '';
  haciaNavegador.on('data', (parte: Buffer) => {
    pendiente += parte.toString('utf8');
    let fin: number;
    while ((fin = pendiente.indexOf('\0')) >= 0) {
      const mensaje = JSON.parse(pendiente.slice(0, fin)) as { id: number; method: string; params: unknown };
      pendiente = pendiente.slice(fin + 1);
      recibidos.push(mensaje);
      for (const respuesta of responder(mensaje) ?? []) desdeNavegador.write(`${JSON.stringify(respuesta)}\0`);
    }
  });
  return { haciaNavegador, desdeNavegador, recibidos };
}

describe('transportePipe', () => {
  it('envía órdenes terminadas en NUL y entrega el resultado de cada una por su id', async () => {
    const t = tuberias((m) => [{ id: m.id, result: m.method === 'Storage.getCookies' ? { cookies: [] } : {} }]);
    const cdp = transportePipe(t.haciaNavegador, t.desdeNavegador);
    expect(await cdp.enviar('Storage.getCookies')).toEqual({ cookies: [] });
    expect(await cdp.enviar('Browser.close')).toEqual({});
    cdp.cerrar();
    expect(t.recibidos).toEqual([
      { id: 1, method: 'Storage.getCookies', params: {} },
      { id: 2, method: 'Browser.close', params: {} },
    ]);
  });

  it('arma mensajes que llegan partidos o juntos, e ignora los eventos del navegador', async () => {
    const t = tuberias(() => null);
    const cdp = transportePipe(t.haciaNavegador, t.desdeNavegador);
    const primera = cdp.enviar('Storage.getCookies');
    const segunda = cdp.enviar('Browser.getVersion');
    await new Promise((resolve) => setImmediate(resolve));
    const texto = `${JSON.stringify({ method: 'Target.targetCreated', params: {} })}\0${JSON.stringify({ id: 2, result: { product: 'x' } })}\0${JSON.stringify({ id: 1, result: { cookies: [1] } })}\0`;
    t.desdeNavegador.write(texto.slice(0, 17));
    t.desdeNavegador.write(texto.slice(17, 60));
    t.desdeNavegador.write(texto.slice(60));
    expect(await primera).toEqual({ cookies: [1] });
    expect(await segunda).toEqual({ product: 'x' });
    cdp.cerrar();
  });

  it('rechaza la orden que el navegador responde con error', async () => {
    const t = tuberias((m) => [{ id: m.id, error: { message: 'método desconocido' } }]);
    const cdp = transportePipe(t.haciaNavegador, t.desdeNavegador);
    await expect(cdp.enviar('Storage.getCookies')).rejects.toThrow('método desconocido');
    cdp.cerrar();
  });

  it('si el navegador cierra su tubería, lo pendiente y lo siguiente fallan', async () => {
    const t = tuberias(() => null);
    const cdp = transportePipe(t.haciaNavegador, t.desdeNavegador);
    const pendiente = cdp.enviar('Storage.getCookies');
    t.desdeNavegador.end();
    await expect(pendiente).rejects.toThrow('cerr');
    await expect(cdp.enviar('Storage.getCookies')).rejects.toThrow('cerr');
  });

  it('un error de las tuberías no derriba el proceso: rechaza lo pendiente', async () => {
    const t = tuberias(() => null);
    const cdp = transportePipe(t.haciaNavegador, t.desdeNavegador);
    const pendiente = cdp.enviar('Storage.getCookies');
    t.desdeNavegador.destroy(new Error('EPIPE'));
    t.haciaNavegador.destroy(new Error('EPIPE'));
    await expect(pendiente).rejects.toThrow();
  });

  it('cada orden tiene su plazo', async () => {
    const t = tuberias(() => null);
    const cdp = transportePipe(t.haciaNavegador, t.desdeNavegador, 20);
    await expect(cdp.enviar('Storage.getCookies')).rejects.toThrow('a tiempo');
    cdp.cerrar();
  });

  it('cerrar rechaza lo pendiente', async () => {
    const t = tuberias(() => null);
    const cdp = transportePipe(t.haciaNavegador, t.desdeNavegador);
    const pendiente = cdp.enviar('Storage.getCookies');
    cdp.cerrar();
    await expect(pendiente).rejects.toThrow('cerr');
  });
});
