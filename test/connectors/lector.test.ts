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
  it('lee las declaraciones y el detalle del F22 normalizando el RUT', async () => {
    const base = 'POST https://www4.sii.cl/consultaestadof22ui/services/data/facadeService';
    const { fetchFalso, llamadas } = crearFetchFalso({
      [`${base}/buscaDeclVgte`]: { headers: JSON_CT, body: fixture('f22-declaraciones.json') },
      [`${base}/f22Compacto`]: { headers: JSON_CT, body: fixture('f22-compacto.json') },
      [`${base}/situacionObservacion`]: { headers: JSON_CT, body: fixture('f22-observaciones.json') },
      [`${base}/buscaEventos`]: { headers: JSON_CT, body: fixture('f22-eventos.json') },
    });
    const crudas: RespuestaCruda[] = [];
    const jar = new CookieJar();
    await jar.setCookie('TOKEN=tok123; Domain=.sii.cl; Path=/', 'https://www4.sii.cl/');
    const lector = new LectorPortalSii(new ClienteHttp(jar, { fetch: fetchFalso, temporizador: sinEsperas }), (r) => void crudas.push(r));

    const declaraciones = await lector.f22Declaraciones('22.222.222-2', 2026);
    const detalle = await lector.f22Detalle('22.222.222-2', 2026, declaraciones[0]!.folio);

    expect(declaraciones.map((d) => [d.rut, d.folio])).toEqual([['22222222-2', 123_456_789], ['22222222-2', 98_765_432]]);
    expect(detalle.valores.length).toBeGreaterThan(0);
    expect(JSON.parse(llamadas[1]!.body!).data).toMatchObject({ rut: '22222222', dv: '2', folio: '123456789' });
    expect(crudas.map((c) => c.superficie)).toEqual(['f22', 'f22.compacto', 'f22.observaciones', 'f22.eventos']);
  });

  it('lee el informe anual de boletas de honorarios emitidas normalizando el RUT', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({
      'GET https://loa.sii.cl/cgi_IMT/TMBCOC_InformeAnualBhe.cgi': { headers: [['content-type', 'text/html']], body: new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', 'bhe-emitidas-anual.html'))) },
    });
    const crudas: RespuestaCruda[] = [];
    const lector = new LectorPortalSii(new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas }), (r) => void crudas.push(r));

    const informe = await lector.bheEmitidasAnual('11.111.111-1', 2025);

    expect(informe.meses).toHaveLength(12);
    expect(new URL(llamadas[0]!.url).searchParams.get('rut_arrastre')).toBe('11111111');
    expect(crudas.map((c) => c.superficie)).toEqual(['bhe.emitidas.anual']);
  });

  it('lee el detalle mensual de boletas de honorarios emitidas normalizando el RUT', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({
      'GET https://loa.sii.cl/cgi_IMT/TMBCOC_InformeMensualBhe.cgi': { headers: [['content-type', 'text/html']], body: new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', 'bhe-emitidas-mensual.html'))) },
    });
    const crudas: RespuestaCruda[] = [];
    const lector = new LectorPortalSii(new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas }), (r) => void crudas.push(r));

    const informe = await lector.bheEmitidasMes('11.111.111-1', parsePeriodo('2025-03'));

    expect(informe?.boletas.map((b) => b.folio)).toEqual([1, 2, 3]);
    expect(new URL(llamadas[0]!.url).searchParams.get('rut_arrastre')).toBe('11111111');
    expect(crudas.map((c) => c.superficie)).toEqual(['bhe.emitidas.mensual']);
  });
});
