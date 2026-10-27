import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { LectorPortalSii } from '../../src/connectors/sii/lector.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import type { RespuestaCruda } from '../../src/domain/tipos.js';
import { declaracion } from '../helpers/fabricas.js';
import { crearFetchFalso, JSON_CT, sinEsperas } from '../helpers/http-falso.js';

const fixture = (nombre: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', nombre), 'utf8');

describe('LectorPortalSii', () => {
  it('delega en los conectores, normaliza el RUT y entrega las respuestas al sumidero', async () => {
    const { fetchFalso } = crearFetchFalso({
      'POST https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getResumen': { headers: JSON_CT, body: fixture('rcv-resumen-compra-registro.json') },
      'POST https://www4.sii.cl/propuestaf29ui/services/data/facadeAdapterService/getDeclaracionConEstados': { headers: JSON_CT, body: fixture('f29-estados.json') },
    });
    const crudas: RespuestaCruda[] = [];
    const jar = new CookieJar();
    await jar.setCookie('TOKEN=tok123; Domain=.sii.cl; Path=/', 'https://www4.sii.cl/');
    const lector = new LectorPortalSii(new ClienteHttp(jar, { fetch: fetchFalso, temporizador: sinEsperas }), (r) => void crudas.push(r));
    const resumen = await lector.rcvResumen('22.222.222-2', parsePeriodo('2026-09'), 'COMPRA', 'REGISTRO');
    const declaraciones = await lector.f29Declaraciones('22222222-2', parsePeriodo('2026-09'));
    expect(resumen.rut).toBe('22222222-2');
    expect(resumen.filas).toHaveLength(2);
    expect(declaraciones[0]?.folio).toBe(555_001);
    expect(crudas.map((c) => c.superficie)).toEqual(['rcv.resumen.COMPRA.REGISTRO', 'f29.estados']);
  });

  it('lee el PDF del F29 con el lector inyectado', async () => {
    const { fetchFalso } = crearFetchFalso({
      'GET https://www4.sii.cl/rfiInternet/formCompacto': { headers: [['content-type', 'application/pdf']], body: '%PDF-1.4 sintetico' },
    });
    const jar = new CookieJar();
    await jar.setCookie('TOKEN=tok123; Domain=.sii.cl; Path=/', 'https://www4.sii.cl/');
    const inyectado = { version: 'lector-inyectado', extraer: async () => ({ '538': 1 }) };
    const lector = new LectorPortalSii(new ClienteHttp(jar, { fetch: fetchFalso, temporizador: sinEsperas }), () => {}, inyectado);

    const v = await lector.f29Valores('22.222.222-2', declaracion());

    expect(v).toMatchObject({ valores: { '538': 1 }, versionLector: 'lector-inyectado' });
  });
});
