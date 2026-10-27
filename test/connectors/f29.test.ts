import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { f29Declaraciones, f29Valores } from '../../src/connectors/sii/f29.js';
import { lectorPdfF29, VERSION_LECTOR_F29 } from '../../src/connectors/sii/f29-pdf.js';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { parseRut } from '../../src/domain/rut.js';
import type { RespuestaCruda } from '../../src/domain/tipos.js';
import { codigoDe } from '../helpers/errores.js';
import { declaracion } from '../helpers/fabricas.js';
import { crearFetchFalso, HTML, JSON_CT, sinEsperas, type RutaFalsa } from '../helpers/http-falso.js';
import { F29_SINTETICO, pdfSintetico } from '../helpers/pdf.js';

const fixture = (nombre: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', nombre), 'utf8');
const RUTA_ESTADOS = 'POST https://www4.sii.cl/propuestaf29ui/services/data/facadeAdapterService/getDeclaracionConEstados';
const RUTA_COMPACTO = 'GET https://www4.sii.cl/rfiInternet/formCompacto';
const EMPRESA = parseRut('22222222-2');

async function preparar(rutas: Record<string, RutaFalsa>) {
  const { fetchFalso, llamadas } = crearFetchFalso(rutas);
  const jar = new CookieJar();
  await jar.setCookie('TOKEN=tok123; Domain=.sii.cl; Path=/', 'https://www4.sii.cl/');
  const http = new ClienteHttp(jar, { fetch: fetchFalso, temporizador: sinEsperas });
  const crudas: RespuestaCruda[] = [];
  return { http, llamadas, crudas, sumidero: (r: RespuestaCruda) => void crudas.push(r) };
}

describe('f29Declaraciones', () => {
  it('lee las declaraciones del período con fecha ISO y código interno', async () => {
    const { http, llamadas, sumidero } = await preparar({ [RUTA_ESTADOS]: { headers: JSON_CT, body: fixture('f29-estados.json') } });
    expect(await f29Declaraciones(http, sumidero, EMPRESA, parsePeriodo('2026-09'))).toEqual([declaracion()]);
    const cuerpo = JSON.parse(llamadas[0]!.body!) as { data: Record<string, unknown> };
    expect(cuerpo.data).toEqual({ rut: '22222222', dv: '2', formId: '2', mes: '09', anno: '2026' });
  });

  it('lee el id del estado y lo deja null cuando el SII no lo informa', async () => {
    const cuerpo = JSON.stringify({
      metaData: { errors: null },
      data: [
        { estadoDeclaracionId: 70, estado: 'Rechazada por pago inconcluso', folio: 555002, declFechaCreacion: '16/10/2026', codigo: 9002 },
        { estado: 'Guardada', folio: 0 },
      ],
    });
    const { http, sumidero } = await preparar({ [RUTA_ESTADOS]: { headers: JSON_CT, body: cuerpo } });
    const r = await f29Declaraciones(http, sumidero, EMPRESA, parsePeriodo('2026-09'));
    expect(r.map((d) => [d.folio, d.estadoId])).toEqual([[555002, 70], [0, null]]);
  });

  it('sin declaraciones devuelve una lista vacía', async () => {
    const { http, sumidero } = await preparar({ [RUTA_ESTADOS]: { headers: JSON_CT, body: '{"metaData":{"errors":null},"data":[]}' } });
    expect(await f29Declaraciones(http, sumidero, EMPRESA, parsePeriodo('2026-09'))).toEqual([]);
  });

  it('data null sin errores devuelve una lista vacía', async () => {
    const { http, sumidero } = await preparar({ [RUTA_ESTADOS]: { headers: JSON_CT, body: '{"metaData":{"errors":null},"data":null}' } });
    expect(await f29Declaraciones(http, sumidero, EMPRESA, parsePeriodo('2026-09'))).toEqual([]);
  });

  it.each([
    {},
    { data: 'ilegible' },
    { data: {} },
    { data: [null] },
    { data: [42] },
  ])('un sobre de estados con formato inesperado es PORTAL_CAMBIO: %j', async (sobre) => {
    const { http, sumidero } = await preparar({ [RUTA_ESTADOS]: { headers: JSON_CT, body: JSON.stringify(sobre) } });
    expect(await codigoDe(f29Declaraciones(http, sumidero, EMPRESA, parsePeriodo('2026-09')))).toBe('PORTAL_CAMBIO');
  });

  it('un error de autorización es SIN_PERMISO', async () => {
    const { http, sumidero } = await preparar({ [RUTA_ESTADOS]: { headers: JSON_CT, body: fixture('f29-estados-error.json') } });
    expect(await codigoDe(f29Declaraciones(http, sumidero, EMPRESA, parsePeriodo('2026-09')))).toBe('SIN_PERMISO');
  });
});

describe('f29Valores', () => {
  it('descarga el PDF compacto, lo guarda como evidencia y extrae los códigos', async () => {
    const pdf = await pdfSintetico(F29_SINTETICO);
    const { http, llamadas, crudas, sumidero } = await preparar({ [RUTA_COMPACTO]: { body: pdf, headers: [['content-type', 'application/pdf']] } });
    const v = await f29Valores(http, sumidero, EMPRESA, declaracion());
    expect(v.folio).toBe(555_001);
    expect(v.valores['538']).toBe(1_234_567);
    expect(v.valores['91']).toBe(1_000_000);
    const url = new URL(llamadas[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ folio: '555001', rut: '22222222', form: '029', codInt: '9001' });
    expect(crudas[0]?.superficie).toBe('f29.formCompacto');
    expect(crudas[0]?.cuerpo.startsWith('JVBER')).toBe(true);
  });

  it('lee el PDF con el lector inyectado y anota su versión; por defecto usa el lector del conector', async () => {
    const pdf = await pdfSintetico(F29_SINTETICO);
    const { http, sumidero } = await preparar({ [RUTA_COMPACTO]: { body: pdf, headers: [['content-type', 'application/pdf']] } });
    const recibidos: Uint8Array[] = [];
    const lector = { version: 'lector-de-prueba', extraer: async (bytes: Uint8Array) => (recibidos.push(bytes), { '538': 5 }) };

    const v = await f29Valores(http, sumidero, EMPRESA, declaracion(), lector);

    expect(v).toEqual({ rut: '22222222-2', periodo: '2026-09', folio: 555_001, valores: { '538': 5 }, versionLector: 'lector-de-prueba' });
    expect(Buffer.from(recibidos[0]!).equals(Buffer.from(pdf))).toBe(true);
    expect(lectorPdfF29.version).toBe(VERSION_LECTOR_F29);
    expect(VERSION_LECTOR_F29).toMatch(/^f29-/);
  });

  it('si no llega un PDF es PORTAL_CAMBIO', async () => {
    const { http, sumidero } = await preparar({ [RUTA_COMPACTO]: { headers: HTML, body: '<html>error</html>' } });
    expect(await codigoDe(f29Valores(http, sumidero, EMPRESA, declaracion()))).toBe('PORTAL_CAMBIO');
  });

  it('un PDF ilegible con cabecera PDF es PORTAL_CAMBIO y conserva evidencia', async () => {
    const pdf = await pdfSintetico(F29_SINTETICO);
    const truncado = pdf.slice(0, 8);
    const { http, crudas, sumidero } = await preparar({ [RUTA_COMPACTO]: { headers: [['content-type', 'application/pdf']], body: truncado } });
    expect(await codigoDe(f29Valores(http, sumidero, EMPRESA, declaracion()))).toBe('PORTAL_CAMBIO');
    expect(crudas[0]?.cuerpo).toBe(Buffer.from(truncado).toString('base64'));
  });

  it('un PDF sin códigos legibles es PORTAL_CAMBIO y conserva evidencia', async () => {
    const pdf = await pdfSintetico([{ x: 50, y: 760, t: 'FORMULARIO 29' }]);
    const { http, crudas, sumidero } = await preparar({ [RUTA_COMPACTO]: { headers: [['content-type', 'application/pdf']], body: pdf } });
    const error = await f29Valores(http, sumidero, EMPRESA, declaracion()).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'PORTAL_CAMBIO', message: 'El PDF del F29 de 2026-09 no trajo códigos legibles.' });
    expect(crudas[0]?.cuerpo).toBe(Buffer.from(pdf).toString('base64'));
  });

  it('una declaración sin folio no se puede descargar', async () => {
    const { http, sumidero } = await preparar({});
    expect(await codigoDe(f29Valores(http, sumidero, EMPRESA, declaracion({ folio: 0 })))).toBe('SII_RECHAZO');
  });
});
