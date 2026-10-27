import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { empresasAutorizadas, sanearEmpresas } from '../../src/connectors/sii/empresas.js';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import type { RespuestaCruda } from '../../src/domain/tipos.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, JSON_CT, sinEsperas } from '../helpers/http-falso.js';

const fixture = (nombre: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', nombre), 'utf8');
const RUTA = 'POST https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getDcvEmpresasAutorizadas';

async function preparar(body: string, conToken = true) {
  const { fetchFalso, llamadas } = crearFetchFalso({ [RUTA]: { headers: JSON_CT, body } });
  const jar = new CookieJar();
  if (conToken) await jar.setCookie('TOKEN=tok123; Domain=.sii.cl; Path=/', 'https://www4.sii.cl/');
  const http = new ClienteHttp(jar, { fetch: fetchFalso, temporizador: sinEsperas });
  const crudas: RespuestaCruda[] = [];
  return { http, llamadas, crudas, sumidero: (r: RespuestaCruda) => void crudas.push(r) };
}

describe('empresasAutorizadas', () => {
  it('pide las empresas con page null y data vacía, y devuelve filas normalizadas', async () => {
    const { http, llamadas, sumidero } = await preparar(fixture('empresas-autorizadas.json'));

    const r = await empresasAutorizadas(http, sumidero);

    expect(r).toEqual([
      { rutEmpresa: '22222222-2', razonSocial: 'EMPRESA DEMO SPA', privilegios: 'ADMIN', fechaDesautorizacion: null },
      { rutEmpresa: '33333333-3', razonSocial: 'OTRA EMPRESA DEMO LTDA', privilegios: 'CONSULTA', fechaDesautorizacion: null },
      { rutEmpresa: '44444444-4', razonSocial: null, privilegios: null, fechaDesautorizacion: '2025-06-30' },
    ]);
    const llamada = llamadas[0]!;
    expect(llamada.headers['Referer']).toBe('https://www4.sii.cl/consdcvinternetui/');
    const cuerpo = JSON.parse(llamada.body!) as { metaData: Record<string, unknown>; data: unknown };
    expect(cuerpo.data).toEqual({});
    expect(cuerpo.metaData['page']).toBeNull();
    expect('page' in cuerpo.metaData).toBe(true);
    expect(cuerpo.metaData['namespace']).toBe('cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getDcvEmpresasAutorizadas');
  });

  it('no exige la cookie TOKEN: sin ella igual consulta', async () => {
    const { http, llamadas, sumidero } = await preparar(fixture('empresas-autorizadas.json'), false);
    expect(await empresasAutorizadas(http, sumidero)).toHaveLength(3);
    expect((JSON.parse(llamadas[0]!.body!) as { metaData: { conversationId: string } }).metaData.conversationId).toBe('');
  });

  it('si solo la empresa se desautorizó, la fecha de la empresa cuenta', async () => {
    const sobre = JSON.parse(fixture('empresas-autorizadas.json')) as { data: Record<string, unknown>[] };
    sobre.data = [{ ...sobre.data[0]!, empFechaDesautorizacion: '2026-01-15' }];
    const { http, sumidero } = await preparar(JSON.stringify(sobre));
    expect((await empresasAutorizadas(http, sumidero))[0]!.fechaDesautorizacion).toBe('2026-01-15');
  });

  it('deduplica por RUT de empresa: la fila vigente gana a la desautorizada y, a igualdad, la primera', async () => {
    const fila = (rut: string, extra: Record<string, unknown> = {}) => ({ usrEmpRut: rut, usrEmpDv: rut === '22222222' ? '2' : '3', razonSocONombreEmp: `EMPRESA ${rut}`, usrPrivilegios: 'ADMIN', ...extra });
    const data = [
      fila('22222222', { usrFechaDesautorizacion: '2025-01-01' }),
      fila('33333333', { usrPrivilegios: 'PRIMERA' }),
      fila('22222222'),
      fila('33333333', { usrPrivilegios: 'SEGUNDA' }),
    ];
    const { http, sumidero } = await preparar(JSON.stringify({ data, respEstado: { codRespuesta: 0 } }));

    const r = await empresasAutorizadas(http, sumidero);

    expect(r.map((e) => e.rutEmpresa)).toEqual(['22222222-2', '33333333-3']);
    expect(r[0]).toMatchObject({ fechaDesautorizacion: null });
    expect(r[1]).toMatchObject({ privilegios: 'PRIMERA' });
  });

  it('una respuesta sin filas es una lista vacía', async () => {
    const { http, sumidero } = await preparar(JSON.stringify({ data: [], respEstado: { codRespuesta: 0 } }));
    expect(await empresasAutorizadas(http, sumidero)).toEqual([]);
  });

  it('codRespuesta distinto de 0 es SII_RECHAZO con el mensaje del SII', async () => {
    const { http, sumidero } = await preparar(fixture('empresas-error.json'));
    const error = await empresasAutorizadas(http, sumidero).catch((e: unknown) => e);
    expect((error as { codigo: string }).codigo).toBe('SII_RECHAZO');
    expect((error as Error).message).toContain('Servicio no disponible para este contribuyente');
  });

  it('un mensaje de falta de autorización es SIN_PERMISO', async () => {
    const { http, sumidero } = await preparar(JSON.stringify({ data: null, respEstado: { codRespuesta: 5, msgeRespuesta: 'No está autorizado' } }));
    expect(await codigoDe(empresasAutorizadas(http, sumidero))).toBe('SIN_PERMISO');
  });

  it.each([
    ['sin respEstado', JSON.stringify({ data: [] })],
    ['data que no es lista', JSON.stringify({ data: {}, respEstado: { codRespuesta: 0 } })],
    ['fila sin RUT de empresa', JSON.stringify({ data: [{ usrEmpDv: '2' }], respEstado: { codRespuesta: 0 } })],
    ['RUT inválido', JSON.stringify({ data: [{ usrEmpRut: '22222222', usrEmpDv: '9' }], respEstado: { codRespuesta: 0 } })],
    ['fila que no es objeto', JSON.stringify({ data: [5], respEstado: { codRespuesta: 0 } })],
  ])('%s es PORTAL_CAMBIO', async (_nombre, body) => {
    const { http, sumidero } = await preparar(body);
    expect(await codigoDe(empresasAutorizadas(http, sumidero))).toBe('PORTAL_CAMBIO');
  });

  it('una respuesta que no es JSON es PORTAL_CAMBIO', async () => {
    const { http, sumidero } = await preparar('<html>caído</html>');
    expect(await codigoDe(empresasAutorizadas(http, sumidero))).toBe('PORTAL_CAMBIO');
  });

  it('guarda como evidencia solo la lista permitida de campos', async () => {
    const sobre = JSON.parse(fixture('empresas-autorizadas.json')) as { data: Record<string, unknown>[] };
    sobre.data[0]!['correoFicticio'] = 'dato.ficticio@ejemplo.invalid';
    sobre.data[0]!['nombreUsuarioFicticio'] = 'NOMBRE FICTICIO';
    const { http, crudas, sumidero } = await preparar(JSON.stringify(sobre));

    await empresasAutorizadas(http, sumidero);

    expect(crudas).toHaveLength(1);
    expect(crudas[0]!.superficie).toBe('cuenta.empresas');
    expect(crudas[0]!.cuerpo).not.toMatch(/ejemplo\.invalid|FICTICIO|usrUsuarioRut|rutAutenticado/);
    expect(JSON.parse(crudas[0]!.cuerpo)).toEqual({
      data: [
        { usrEmpRut: '22222222', usrEmpDv: '2', usrPrivilegios: 'ADMIN', usrFechaDesautorizacion: null, empFechaDesautorizacion: null, razonSocONombreEmp: 'EMPRESA DEMO SPA' },
        { usrEmpRut: '33333333', usrEmpDv: '3', usrPrivilegios: 'CONSULTA', usrFechaDesautorizacion: null, empFechaDesautorizacion: null, razonSocONombreEmp: 'OTRA EMPRESA DEMO LTDA' },
        { usrEmpRut: '44444444', usrEmpDv: '4', usrPrivilegios: null, usrFechaDesautorizacion: '2025-06-30', empFechaDesautorizacion: null, razonSocONombreEmp: null },
      ],
      respEstado: { codRespuesta: 0, msgeRespuesta: 'OK' },
    });
  });
});

describe('sanearEmpresas', () => {
  it('nunca lanza y devuelve una forma estable ante cualquier entrada', () => {
    for (const entrada of [null, undefined, 5, 'x', [], {}, { data: 'x' }, { data: [null, 3, {}] }]) {
      expect(() => sanearEmpresas(entrada)).not.toThrow();
      const s = sanearEmpresas(entrada) as Record<string, unknown>;
      expect(s).toHaveProperty('data');
      expect(s).toHaveProperty('respEstado');
    }
  });
});
