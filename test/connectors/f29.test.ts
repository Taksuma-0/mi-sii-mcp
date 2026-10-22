import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { f29Declaraciones, f29Valores } from '../../src/connectors/sii/f29.js';
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

function preparar(rutas: Record<string, RutaFalsa>) {
  const { fetchFalso, llamadas } = crearFetchFalso(rutas);
  const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
  const crudas: RespuestaCruda[] = [];
  return { http, llamadas, crudas, sumidero: (r: RespuestaCruda) => void crudas.push(r) };
}

describe('f29Declaraciones', () => {
  it('lee las declaraciones del período con fecha ISO y código interno', async () => {
    const { http, llamadas, sumidero } = preparar({ [RUTA_ESTADOS]: { headers: JSON_CT, body: fixture('f29-estados.json') } });
    expect(await f29Declaraciones(http, sumidero, EMPRESA, parsePeriodo('2026-09'))).toEqual([declaracion()]);
    const cuerpo = JSON.parse(llamadas[0]!.body!) as { data: Record<string, unknown> };
    expect(cuerpo.data).toEqual({ rut: '22222222', dv: '2', formId: '2', mes: '09', anno: '2026' });
  });

  it('sin declaraciones devuelve una lista vacía', async () => {
    const { http, sumidero } = preparar({ [RUTA_ESTADOS]: { headers: JSON_CT, body: '{"metaData":{"errors":null},"data":[]}' } });
    expect(await f29Declaraciones(http, sumidero, EMPRESA, parsePeriodo('2026-09'))).toEqual([]);
  });

  it('data null sin errores devuelve una lista vacía', async () => {
    const { http, sumidero } = preparar({ [RUTA_ESTADOS]: { headers: JSON_CT, body: '{"metaData":{"errors":null},"data":null}' } });
    expect(await f29Declaraciones(http, sumidero, EMPRESA, parsePeriodo('2026-09'))).toEqual([]);
  });

  it.each([
    {},
    { data: 'ilegible' },
    { data: {} },
    { data: [null] },
    { data: [42] },
  ])('un sobre de estados con formato inesperado es PORTAL_CAMBIO: %j', async (sobre) => {
    const { http, sumidero } = preparar({ [RUTA_ESTADOS]: { headers: JSON_CT, body: JSON.stringify(sobre) } });
    expect(await codigoDe(f29Declaraciones(http, sumidero, EMPRESA, parsePeriodo('2026-09')))).toBe('PORTAL_CAMBIO');
  });

  it('un error de autorización es SIN_PERMISO', async () => {
    const { http, sumidero } = preparar({ [RUTA_ESTADOS]: { headers: JSON_CT, body: fixture('f29-estados-error.json') } });
    expect(await codigoDe(f29Declaraciones(http, sumidero, EMPRESA, parsePeriodo('2026-09')))).toBe('SIN_PERMISO');
  });
});

describe('f29Valores', () => {
  it('descarga el PDF compacto, lo guarda como evidencia y extrae los códigos', async () => {
    const pdf = await pdfSintetico(F29_SINTETICO);
    const { http, llamadas, crudas, sumidero } = preparar({ [RUTA_COMPACTO]: { body: pdf, headers: [['content-type', 'application/pdf']] } });
    const v = await f29Valores(http, sumidero, EMPRESA, declaracion());
    expect(v.folio).toBe(555_001);
    expect(v.valores['538']).toBe(1_234_567);
    expect(v.valores['91']).toBe(1_000_000);
    const url = new URL(llamadas[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ folio: '555001', rut: '22222222', form: '029', codInt: '9001' });
    expect(crudas[0]?.superficie).toBe('f29.formCompacto');
    expect(crudas[0]?.cuerpo.startsWith('JVBER')).toBe(true);
  });

  it('si no llega un PDF es PORTAL_CAMBIO', async () => {
    const { http, sumidero } = preparar({ [RUTA_COMPACTO]: { headers: HTML, body: '<html>error</html>' } });
    expect(await codigoDe(f29Valores(http, sumidero, EMPRESA, declaracion()))).toBe('PORTAL_CAMBIO');
  });

  it('un PDF ilegible con cabecera PDF es PORTAL_CAMBIO y conserva evidencia', async () => {
    const pdf = await pdfSintetico(F29_SINTETICO);
    const truncado = pdf.slice(0, 8);
    const { http, crudas, sumidero } = preparar({ [RUTA_COMPACTO]: { headers: [['content-type', 'application/pdf']], body: truncado } });
    expect(await codigoDe(f29Valores(http, sumidero, EMPRESA, declaracion()))).toBe('PORTAL_CAMBIO');
    expect(crudas[0]?.cuerpo).toBe(Buffer.from(truncado).toString('base64'));
  });

  it('una declaración sin folio no se puede descargar', async () => {
    const { http, sumidero } = preparar({});
    expect(await codigoDe(f29Valores(http, sumidero, EMPRESA, declaracion({ folio: 0 })))).toBe('SII_RECHAZO');
  });
});
