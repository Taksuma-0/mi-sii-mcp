import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { conectarCdp } from '../../src/connectors/navegador/cdp.js';

/** Servidor WebSocket mínimo (solo texto, sin fragmentar) que responde como el navegador. Sin navegadores reales. */
function servidorCdp(responder: (mensaje: { id: number; method: string }) => unknown | null) {
  const recibidos: { id: number; method: string; params: unknown }[] = [];
  const sockets: Socket[] = [];
  const servidor: Server = createServer();
  servidor.on('upgrade', (req, socket: Socket) => {
    sockets.push(socket);
    const aceptar = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${aceptar}\r\n\r\n`);
    let pendiente = Buffer.alloc(0);
    socket.on('data', (datos: Buffer) => {
      pendiente = Buffer.concat([pendiente, datos]);
      while (pendiente.length >= 2) {
        const opcode = pendiente[0]! & 0x0f;
        let largo = pendiente[1]! & 0x7f;
        let inicio = 2;
        if (largo === 126) {
          largo = pendiente.readUInt16BE(2);
          inicio = 4;
        }
        if (pendiente.length < inicio + 4 + largo) return;
        const mascara = pendiente.subarray(inicio, inicio + 4);
        const cuerpo = Buffer.from(pendiente.subarray(inicio + 4, inicio + 4 + largo).map((b, i) => b ^ mascara[i % 4]!));
        pendiente = pendiente.subarray(inicio + 4 + largo);
        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode !== 0x1) continue;
        const mensaje = JSON.parse(cuerpo.toString('utf8')) as { id: number; method: string; params: unknown };
        recibidos.push(mensaje);
        const respuesta = responder(mensaje);
        if (respuesta === null) continue;
        const texto = Buffer.from(JSON.stringify(respuesta));
        const cabecera = texto.length < 126 ? Buffer.from([0x81, texto.length]) : Buffer.from([0x81, 126, texto.length >> 8, texto.length & 0xff]);
        socket.write(Buffer.concat([cabecera, texto]));
      }
    });
  });
  return {
    recibidos,
    escuchar: () =>
      new Promise<number>((resolve) => {
        servidor.listen(0, '127.0.0.1', () => resolve((servidor.address() as { port: number }).port));
      }),
    cerrar: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        servidor.close(() => resolve());
      }),
  };
}

describe('conectarCdp', () => {
  let cerrar: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await cerrar?.();
    cerrar = null;
  });

  it('envía órdenes con id y entrega el resultado de cada una', async () => {
    const s = servidorCdp((m) => (m.method === 'Storage.getCookies' ? { id: m.id, result: { cookies: [] } } : { id: m.id, result: {} }));
    cerrar = s.cerrar;
    const puerto = await s.escuchar();
    const t = await conectarCdp(`ws://127.0.0.1:${puerto}/devtools/browser/abc`);
    expect(await t.enviar('Storage.getCookies')).toEqual({ cookies: [] });
    expect(await t.enviar('Browser.close')).toEqual({});
    t.cerrar();
    expect(s.recibidos).toEqual([
      { id: 1, method: 'Storage.getCookies', params: {} },
      { id: 2, method: 'Browser.close', params: {} },
    ]);
  });

  it('rechaza la orden que el navegador responde con error', async () => {
    const s = servidorCdp((m) => ({ id: m.id, error: { message: 'método desconocido' } }));
    cerrar = s.cerrar;
    const puerto = await s.escuchar();
    const t = await conectarCdp(`ws://127.0.0.1:${puerto}/devtools/browser/abc`);
    await expect(t.enviar('Storage.getCookies')).rejects.toThrow('método desconocido');
    t.cerrar();
  });

  it('una orden sin respuesta falla al cerrarse la conexión', async () => {
    const s = servidorCdp(() => null);
    cerrar = s.cerrar;
    const puerto = await s.escuchar();
    const t = await conectarCdp(`ws://127.0.0.1:${puerto}/devtools/browser/abc`);
    const pendiente = t.enviar('Storage.getCookies');
    t.cerrar();
    await expect(pendiente).rejects.toThrow('cerr');
  });

  it.each(['ws://localhost:9222/devtools/browser/abc', 'ws://192.168.1.10:9222/devtools/browser/abc', 'wss://127.0.0.1:9222/devtools/browser/abc'])(
    'solo se conecta a ws://127.0.0.1 (%s no)',
    async (url) => {
      await expect(conectarCdp(url)).rejects.toThrow('127.0.0.1');
    },
  );
});
