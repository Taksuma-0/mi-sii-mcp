import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearServidorLocal } from '../../src/interfaces/web/servidor.js';
import type { OperacionesEspacio } from '../../src/interfaces/web/espacio.js';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { perfilEmpresa } from '../helpers/fabricas.js';

const contexto = 'contexto ficticio de una pestaña';
const rango = { desde: '2026-08', hasta: '2026-09' };
const total = { monto: null, mesesConDatos: 0, mesesSinDatos: 0 };
const panorama = { perfil: perfilEmpresa(), periodos: [], totales: { ventas: total, compras: total, ivaDebito: total, ivaCredito: total, f29: total } };
const sincronizacion = { estado: 'completo' as const, sincronizacion: 'Resultado ficticio', panorama };
const pagina = { documentos: [], total: 0, pagina: 1, tamano: 50 };
const casos = [
  { ruta: '/conectar', metodo: 'conectar', datos: { rut: '22222222-2', clave: 'clave ficticia' }, args: [{ rut: '22222222-2', clave: 'clave ficticia' }], resultado: { contexto, panorama } },
  { ruta: '/panorama', metodo: 'panorama', datos: { contexto }, args: [contexto], resultado: panorama },
  { ruta: '/sincronizar', metodo: 'sincronizar', datos: { contexto, ...rango, superficies: ['f29'] }, args: [contexto, { ...rango, superficies: ['f29'] }], resultado: sincronizacion },
  { ruta: '/analizar', metodo: 'analizar', datos: { contexto, ...rango }, args: [contexto, rango], resultado: [] },
  { ruta: '/documentos', metodo: 'documentos', datos: { contexto, periodo: '2026-09', lado: 'COMPRA', estado: 'PENDIENTE', pagina: 2 }, args: [contexto, { periodo: '2026-09', lado: 'COMPRA', estado: 'PENDIENTE', pagina: 2 }], resultado: pagina },
  { ruta: '/desconectar', metodo: 'desconectar', datos: { contexto }, args: [contexto], resultado: { desconectado: true } },
] as const;
const cierres: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cerrar of cierres.splice(0)) await cerrar(); });

async function entorno() {
  const espacio = {
    conectar: vi.fn<OperacionesEspacio['conectar']>(async () => ({ contexto, panorama })),
    panorama: vi.fn<OperacionesEspacio['panorama']>(async () => panorama),
    sincronizar: vi.fn<OperacionesEspacio['sincronizar']>(async () => sincronizacion),
    analizar: vi.fn<OperacionesEspacio['analizar']>(async () => []),
    documentos: vi.fn<OperacionesEspacio['documentos']>(async () => pagina),
    desconectar: vi.fn<OperacionesEspacio['desconectar']>(async () => {}),
  };
  const s = await crearServidorLocal({ puerto: 0, espacio });
  cierres.push(s.cerrar);
  const html = await (await fetch(s.url)).text();
  const token = /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? '';
  const headers = { origin: s.url, 'x-csrf-token': token, 'content-type': 'application/json' };
  const post = (ruta: string, datos: unknown, extra: Record<string, string> = {}) => fetch(s.url + ruta, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(datos) });
  const expectSinServicio = () => { for (const metodo of Object.values(espacio)) expect(metodo).not.toHaveBeenCalled(); };
  return { s, espacio, headers, post, expectSinServicio };
}

describe('rutas HTTP del espacio', () => {
  it.each(casos)('despacha $ruta con sus parámetros exactos', async (caso) => {
    const e = await entorno();
    const r = await e.post(caso.ruta, caso.datos);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(caso.resultado);
    expect(e.espacio[caso.metodo]).toHaveBeenCalledExactlyOnceWith(...caso.args);
    for (const [metodo, fn] of Object.entries(e.espacio)) if (metodo !== caso.metodo) expect(fn).not.toHaveBeenCalled();
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('admite opciones ausentes sin inventar filtros ni fuentes', async () => {
    const e = await entorno();
    expect((await e.post('/sincronizar', { contexto, ...rango })).status).toBe(200);
    expect(e.espacio.sincronizar).toHaveBeenCalledExactlyOnceWith(contexto, rango);
    expect((await e.post('/documentos', { contexto, periodo: '2026-09' })).status).toBe(200);
    expect(e.espacio.documentos).toHaveBeenCalledExactlyOnceWith(contexto, { periodo: '2026-09' });
  });

  it.each(casos)('protege $ruta con Host, Origin, token y formato JSON', async (caso) => {
    const e = await entorno();
    const extras: Record<string, string>[] = [{ origin: '' }, { origin: 'https://ajeno.invalid' }, { 'x-csrf-token': '' }, { 'x-csrf-token': 'ajeno' }, { host: 'ajeno.invalid' }, { 'content-type': 'text/plain' }];
    for (const extra of extras) {
      const estado = await new Promise<number>((resolve, reject) => {
        const req = request(e.s.url + caso.ruta, { method: 'POST', headers: { ...e.headers, ...extra } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
        req.on('error', reject);
        req.end(JSON.stringify(caso.datos));
      });
      expect(estado).toBeGreaterThanOrEqual(400);
    }
    e.expectSinServicio();
  });

  it.each(casos)('rechaza estructuras, campos desconocidos y tipos incorrectos en $ruta', async (caso) => {
    const e = await entorno();
    const invalidos: unknown[] = [null, [], 'texto', 7, {}, { ...caso.datos, adicional: true }];
    for (const campo of Object.keys(caso.datos)) {
      const sinCampo: Record<string, unknown> = { ...caso.datos };
      delete sinCampo[campo];
      if (!['superficies', 'lado', 'estado', 'pagina'].includes(campo)) invalidos.push(sinCampo);
      invalidos.push({ ...caso.datos, [campo]: {} }, { ...caso.datos, [campo]: [] }, { ...caso.datos, [campo]: null }, { ...caso.datos, [campo]: '' });
    }
    for (const datos of invalidos) expect((await e.post(caso.ruta, datos)).status).toBe(400);
    e.expectSinServicio();
  });

  it.each(casos.filter(caso => caso.ruta !== '/conectar'))('rechaza RUT adicional en $ruta', async (caso) => {
    const e = await entorno();
    expect((await e.post(caso.ruta, { ...caso.datos, rut: '11111111-1' })).status).toBe(400);
    e.expectSinServicio();
  });

  it.each(casos)('rechaza JSON roto y cuerpos grandes en $ruta', async (caso) => {
    const e = await entorno();
    for (const body of ['{', 'x'.repeat(16 * 1024 + 1)]) {
      const r = await fetch(e.s.url + caso.ruta, { method: 'POST', headers: e.headers, body });
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    e.expectSinServicio();
  });

  it.each([
    { ruta: '/conectar', datos: { rut: 'invalido', clave: 'ficticia' } },
    ...['/sincronizar', '/analizar'].flatMap(ruta => [
      { ruta, datos: { contexto, desde: '2026-99', hasta: '2026-09' } },
      { ruta, datos: { contexto, desde: '2026-09', hasta: '2026-08' } },
      { ruta, datos: { contexto, desde: '2000-01', hasta: '2010-01' } },
    ]),
    ...[[], ['otra'], ['rcv', 'f29', 'rcv'], [1]].map(superficies => ({ ruta: '/sincronizar', datos: { contexto, ...rango, superficies } })),
    ...[{ periodo: '2026-99' }, { lado: 'OTRO' }, { estado: 'OTRO' }, ...[0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1].map(pagina => ({ pagina }))].map(extra => ({ ruta: '/documentos', datos: { contexto, periodo: '2026-09', ...extra } })),
  ])('valida semántica antes del servicio (%#)', async ({ ruta, datos }) => {
    const e = await entorno();
    expect((await e.post(ruta, datos)).status).toBe(400);
    e.expectSinServicio();
  });

  it('reserva ocupado antes de leer cuerpo, rechaza cualquier operación y cierre', async () => {
    const e = await entorno();
    const req = request(e.s.url + '/conectar', { method: 'POST', headers: { ...e.headers, 'content-length': '1000' } });
    cierres.unshift(async () => { req.destroy(); });
    req.on('error', () => {});
    req.write('{');
    const estado = async () => (await (await fetch(e.s.url + '/estado')).json()) as { ocupado: boolean };
    for (let i = 0; i < 40 && !(await estado()).ocupado; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(await estado()).toEqual({ aplicacion: 'impuestocl-local-v1', ocupado: true });
    for (const caso of casos) expect((await e.post(caso.ruta, caso.datos)).status).toBe(409);
    expect((await e.post('/cerrar', {})).status).toBe(409);
    e.expectSinServicio();
    req.destroy();
    for (let i = 0; i < 40 && (await estado()).ocupado; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(await estado()).toEqual({ aplicacion: 'impuestocl-local-v1', ocupado: false });
    expect((await e.post('/conectar', casos[0].datos)).status).toBe(200);
  });

  it('mantiene ocupado mientras el servicio trabaja y libera tras fallo saneado', async () => {
    const e = await entorno();
    let rechazar!: (error: Error) => void;
    let iniciar!: () => void;
    const inicio = new Promise<void>(resolve => { iniciar = resolve; });
    e.espacio.sincronizar.mockImplementationOnce(() => { iniciar(); return new Promise((_resolve, reject) => { rechazar = reject; }); });
    const primera = e.post('/sincronizar', { contexto, ...rango });
    await inicio;
    for (const caso of casos) expect((await e.post(caso.ruta, caso.datos)).status).toBe(409);
    expect((await e.post('/cerrar', {})).status).toBe(409);
    rechazar(new ErrorImpuestocl('SESION_REQUERIDA', 'clave ficticia'));
    const r = await primera;
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain('clave ficticia');
    expect((await e.post('/panorama', { contexto })).status).toBe(200);
  });

  it.each(casos)('sanea errores y no admite consultas GET en $ruta', async (caso) => {
    const e = await entorno();
    e.espacio[caso.metodo].mockRejectedValueOnce(new Error('clave ficticia'));
    const r = await e.post(caso.ruta, caso.datos);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ codigo: 'ERROR_INTERNO', mensaje: expect.any(String) });
    expect((await fetch(e.s.url + caso.ruta)).status).toBe(404);
    expect(await (await fetch(e.s.url + '/estado')).json()).toEqual({ aplicacion: 'impuestocl-local-v1', ocupado: false });
  });
});
