import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { f29Propuesta, sanearPropuesta } from '../../src/connectors/sii/propuesta.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { parseRut } from '../../src/domain/rut.js';
import type { RespuestaCruda } from '../../src/domain/tipos.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, JSON_CT, sinEsperas } from '../helpers/http-falso.js';

const fixture = (nombre: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', nombre), 'utf8');
const RUTA = 'POST https://www4.sii.cl/propuestaf29ui/services/data/facadeAdapterService/getDeclaracionConCondicionesYTipoPropuesta';
const EMPRESA = parseRut('22222222-2');
const SEPT = parsePeriodo('2026-09');

async function preparar(body: string) {
  const { fetchFalso, llamadas } = crearFetchFalso({ [RUTA]: { headers: JSON_CT, body } });
  const jar = new CookieJar();
  await jar.setCookie('TOKEN=tok123; Domain=.sii.cl; Path=/', 'https://www4.sii.cl/');
  const http = new ClienteHttp(jar, { fetch: fetchFalso, temporizador: sinEsperas });
  const crudas: RespuestaCruda[] = [];
  return { http, llamadas, crudas, sumidero: (r: RespuestaCruda) => void crudas.push(r) };
}

/** Un sobre sin errores con `data` propio, para probar la normalización. */
const conData = (data: Record<string, unknown>): string => JSON.stringify({ metaData: { errors: null }, data });

describe('f29Propuesta', () => {
  it('pide la propuesta con los parámetros del portal y la devuelve normalizada', async () => {
    const { http, llamadas, sumidero } = await preparar(fixture('propuesta-tipo-40.json'));

    const r = await f29Propuesta(http, sumidero, EMPRESA, SEPT);

    expect(r).toEqual({
      rut: '22222222-2',
      periodo: '2026-09',
      tipoPropuesta: 40,
      descripcionTipo: 'Propuesta con crédito de documentos',
      estadoCalculo: 1,
      propuestos: { '511': 900_000, '520': 950_000, '519': 50_000, '504': 120_000, '151': 30_000 },
      administrativos: { '9114': 1, '9132': 2, '9137': 3, '9186': 4 },
      sinPropuesta: false,
    });
    const llamada = llamadas[0]!;
    expect(llamada.headers['Referer']).toBe('https://www4.sii.cl/propuestaf29ui/');
    const cuerpo = JSON.parse(llamada.body!) as { metaData: Record<string, unknown>; data: Record<string, unknown> };
    expect(cuerpo.data).toEqual({ rutContribuyente: '22222222', dv: '2', formCodigo: '2', mes: '09', anno: '2026' });
    expect(cuerpo.metaData['namespace']).toBe('cl.sii.sdi.lob.iva.propuestaf29.data.api.interfaces.FacadeAdapterService/getDeclaracionConCondicionesYTipoPropuesta');
    expect('page' in cuerpo.metaData).toBe(false);
  });

  it('un mes sin propuesta (tipo 48, estado de cálculo 5, listas vacías) devuelve sinPropuesta', async () => {
    const { http, sumidero } = await preparar(fixture('propuesta-tipo-48.json'));

    expect(await f29Propuesta(http, sumidero, EMPRESA, SEPT)).toEqual({
      rut: '22222222-2',
      periodo: '2026-09',
      tipoPropuesta: 48,
      descripcionTipo: 'Sin propuesta',
      estadoCalculo: 5,
      propuestos: {},
      administrativos: {},
      sinPropuesta: true,
    });
  });

  it('normaliza los códigos sin ceros a la izquierda, acepta decimales con punto y descarta lo ilegible', async () => {
    const { http, sumidero } = await preparar(
      conData({
        tipopropuesta: '40',
        listCodPropuestos: [
          { codigo: '0520', valor: '1234.5' },
          { codigo: ' 504 ', valor: 77 },
          { codigo: '151', valor: 'abc' },
          { codigo: '', valor: '5' },
          { codigo: 'XX', valor: '5' },
          { codigo: '519', valor: null },
          null,
          'texto',
        ],
        listCodAdministrativos: [{ codigo: '09114', valor: '8' }],
        resultadoCalculoPP29: { estado: '1' },
      }),
    );

    const r = await f29Propuesta(http, sumidero, EMPRESA, SEPT);

    expect(r).toMatchObject({ tipoPropuesta: 40, estadoCalculo: 1, propuestos: { '520': 1234.5, '504': 77 }, administrativos: { '9114': 8 }, sinPropuesta: false });
    expect(Object.keys(r!.propuestos).sort()).toEqual(['504', '520']);
  });

  it('nunca devuelve los códigos de identificación, aunque el SII los mande en las listas', async () => {
    const identificacion = ['01', '02', '03', '05', '06', '08', '09', '55', '314', '610'];
    const { http, sumidero } = await preparar(
      conData({
        tipopropuesta: 40,
        listCodPropuestos: [...identificacion.map((codigo) => ({ codigo, valor: '1' })), { codigo: '0001', valor: '1' }, { codigo: '520', valor: '10' }],
        listCodAdministrativos: [{ codigo: '03', valor: '1' }, { codigo: '9114', valor: '2' }],
      }),
    );

    const r = await f29Propuesta(http, sumidero, EMPRESA, SEPT);

    expect(r!.propuestos).toEqual({ '520': 10 });
    expect(r!.administrativos).toEqual({ '9114': 2 });
  });

  it('con la lista de propuestos vacía pero administrativos con valores no es sinPropuesta', async () => {
    const { http, sumidero } = await preparar(conData({ tipopropuesta: 40, listCodPropuestos: [], listCodAdministrativos: [{ codigo: '9114', valor: '2' }] }));
    expect((await f29Propuesta(http, sumidero, EMPRESA, SEPT))!.sinPropuesta).toBe(false);
  });

  it('sin tipo, descripción ni cálculo los deja en null', async () => {
    const { http, sumidero } = await preparar(conData({ listCodAdministrativos: [{ codigo: '9114', valor: '2' }] }));
    expect(await f29Propuesta(http, sumidero, EMPRESA, SEPT)).toEqual({
      rut: '22222222-2',
      periodo: '2026-09',
      tipoPropuesta: null,
      descripcionTipo: null,
      estadoCalculo: null,
      propuestos: {},
      administrativos: { '9114': 2 },
      sinPropuesta: false,
    });
  });

  it.each([
    ['data vacío', {}],
    ['listas vacías', { listCodPropuestos: [], listCodAdministrativos: [] }],
    ['todo null', { tipopropuesta: null, tipopropuestadescrip: null, listCodPropuestos: null, listCodAdministrativos: null, resultadoCalculoPP29: null }],
    ['cálculo sin estado', { listCodPropuestos: [], resultadoCalculoPP29: { estado: null, glosaError: null } }],
  ])('una propuesta sin tipo, estado ni códigos (%s) es una respuesta nula', async (_caso, data) => {
    const { http, sumidero } = await preparar(conData(data));
    expect(await f29Propuesta(http, sumidero, EMPRESA, SEPT)).toBeNull();
  });

  it('un mes sin propuesta pero con tipo y estado de cálculo no es una respuesta nula', async () => {
    const { http, sumidero } = await preparar(conData({ tipopropuesta: 48, listCodPropuestos: [], resultadoCalculoPP29: { estado: 5 } }));
    expect(await f29Propuesta(http, sumidero, EMPRESA, SEPT)).toMatchObject({ tipoPropuesta: 48, estadoCalculo: 5, sinPropuesta: true });
  });

  it('un error sin clave data sale como SIN_PERMISO o SII_RECHAZO, no como PORTAL_CAMBIO', async () => {
    const a = await preparar('{"metaData":{"errors":[{"descripcion":"El usuario no está autorizado para consultar la propuesta"}]}}');
    expect(await codigoDe(f29Propuesta(a.http, a.sumidero, EMPRESA, SEPT))).toBe('SIN_PERMISO');
    const b = await preparar('{"metaData":{"errors":[{"descripcion":"Periodo fuera de rango"}]}}');
    expect(await codigoDe(f29Propuesta(b.http, b.sumidero, EMPRESA, SEPT))).toBe('SII_RECHAZO');
  });

  it('data null sin errores devuelve null', async () => {
    const { http, sumidero } = await preparar('{"metaData":{"errors":null},"data":null}');
    expect(await f29Propuesta(http, sumidero, EMPRESA, SEPT)).toBeNull();
  });

  it('un error de autorización es SIN_PERMISO y cualquier otro error es SII_RECHAZO', async () => {
    const a = await preparar(fixture('propuesta-error.json'));
    expect(await codigoDe(f29Propuesta(a.http, a.sumidero, EMPRESA, SEPT))).toBe('SIN_PERMISO');
    const b = await preparar('{"metaData":{"errors":[{"descripcion":"Periodo fuera de rango"}]},"data":null}');
    const error = await f29Propuesta(b.http, b.sumidero, EMPRESA, SEPT).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'SII_RECHAZO' });
    expect((error as Error).message).toContain('Periodo fuera de rango');
  });

  it.each([{}, { data: 'ilegible' }, { data: [] }, { data: { listCodPropuestos: 'no es lista' } }, { data: { listCodAdministrativos: {} } }])(
    'un sobre con formato inesperado es PORTAL_CAMBIO: %j',
    async (sobre) => {
      const { http, sumidero } = await preparar(JSON.stringify(sobre));
      expect(await codigoDe(f29Propuesta(http, sumidero, EMPRESA, SEPT))).toBe('PORTAL_CAMBIO');
    },
  );
});

describe('evidencia de la propuesta', () => {
  it('guarda solo la lista permitida: ni listCodBase ni traza ni datos de actividades, y tampoco el token del sobre', async () => {
    const { http, crudas, sumidero } = await preparar(fixture('propuesta-tipo-40.json'));

    await f29Propuesta(http, sumidero, EMPRESA, SEPT);

    expect(crudas).toHaveLength(1);
    expect(crudas[0]!.superficie).toBe('f29.propuesta');
    const guardado = JSON.parse(crudas[0]!.cuerpo) as { metaData: unknown; data: Record<string, unknown> };
    expect(Object.keys(guardado.data).sort()).toEqual(
      ['descripcionEstado', 'estado', 'listCodAdministrativos', 'listCodPropuestos', 'listGlosasProp', 'resultadoCalculoPP29', 'tieneAnotaciones', 'tipopropuesta', 'tipopropuestadescrip'].sort(),
    );
    expect(guardado.data['resultadoCalculoPP29']).toEqual({ estado: 1, glosaError: null });
    expect(guardado.data['listCodPropuestos']).toHaveLength(5);
    expect(guardado.metaData).toEqual({ errors: null });
    for (const prohibido of ['listCodBase', 'traza', 'TRAZA-FICTICIA', 'actividadesEco', 'ACTIVIDAD FICTICIA', 'CALLE FICTICIA', 'EMPRESA DEMO', 'demo@example', 'TOKEN-FICTICIO', 'anotacion', 'vectores', 'inicioActividades', 'trabIndependiente']) {
      expect(crudas[0]!.cuerpo).not.toContain(prohibido);
    }
  });

  it('también sanea una respuesta con error y una con data null', async () => {
    const a = await preparar(fixture('propuesta-error.json'));
    await f29Propuesta(a.http, a.sumidero, EMPRESA, SEPT).catch(() => undefined);
    expect(JSON.parse(a.crudas[0]!.cuerpo)).toEqual({ metaData: { errors: [{ descripcion: 'El usuario no está autorizado para consultar la propuesta' }] }, data: null });
    const b = await preparar('{"metaData":{"errors":null},"data":null}');
    await f29Propuesta(b.http, b.sumidero, EMPRESA, SEPT);
    expect(JSON.parse(b.crudas[0]!.cuerpo)).toEqual({ metaData: { errors: null }, data: null });
  });

  it('el saneo copia solo filas con valor numérico: un texto libre no llega a la evidencia', () => {
    const saneado = sanearPropuesta({
      data: {
        listCodPropuestos: [{ codigo: '7', valor: 'a@b.cl' }, { codigo: '520', valor: '5' }, { codigo: '504', valor: null }],
        listCodAdministrativos: [{ codigo: '9114', valor: 'Calle Falsa 123' }, { codigo: '9132', valor: 2 }],
      },
    });
    expect(saneado).toEqual({
      metaData: { errors: null },
      data: { listCodPropuestos: [{ codigo: '520', valor: '5' }], listCodAdministrativos: [{ codigo: '9132', valor: 2 }] },
    });
    expect(JSON.stringify(saneado)).not.toContain('a@b.cl');
  });

  it('el saneo quita también los códigos de identificación de las listas y los campos de cada fila', () => {
    const saneado = sanearPropuesta({
      data: {
        listCodPropuestos: [{ codigo: '03', valor: 'CALLE', extra: 'x' }, { codigo: '520', valor: '5', extra: 'x' }],
        listCodAdministrativos: [{ codigo: '9114', valor: '1' }],
        campoNuevoDelPortal: 'x',
        resultadoCalculoPP29: { estado: 5, glosaError: 'g', traza: 't', otro: 1 },
      },
    });
    expect(saneado).toEqual({
      metaData: { errors: null },
      data: {
        listCodPropuestos: [{ codigo: '520', valor: '5' }],
        listCodAdministrativos: [{ codigo: '9114', valor: '1' }],
        resultadoCalculoPP29: { estado: 5, glosaError: 'g' },
      },
    });
  });

  it.each([null, 'texto', 42, [], {}, { data: 'texto' }, { data: ['texto'] }, { metaData: 'texto', data: { listCodPropuestos: 'texto' } }])(
    'el saneo no lanza ni deja pasar texto ante una forma inesperada: %j',
    (cuerpo) => {
      expect(() => sanearPropuesta(cuerpo)).not.toThrow();
      expect(JSON.stringify(sanearPropuesta(cuerpo))).not.toContain('texto');
    },
  );
});
