import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { bheEmitidasAnual } from '../../src/connectors/sii/bhe-emitidas.js';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { parseRut } from '../../src/domain/rut.js';
import type { BheEmitidaMes, RespuestaCruda } from '../../src/domain/tipos.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, HTML, sinEsperas, type DefRespuesta } from '../helpers/http-falso.js';

const RUTA = 'GET https://loa.sii.cl/cgi_IMT/TMBCOC_InformeAnualBhe.cgi';
const PERSONA = parseRut('11111111-1');
const FIXTURE = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', 'bhe-emitidas-anual.html'), 'latin1');
/** Como lo entrega el SII: `text/html` sin charset en el encabezado (el charset viene en el `<meta>`). */
const HTML_SIN_CHARSET: readonly (readonly [string, string])[] = [['content-type', 'text/html']];

/** La fixture con una asignación cambiada (`clave` sin comillas en el valor: va tal cual); null la quita. */
function con(clave: string, valor: string | null, html = FIXTURE): string {
  const asignacion = new RegExp(String.raw`xml_values\['${clave}'\] = [^\n]*\n`);
  if (!asignacion.test(html)) throw new Error(`la fixture no asigna ${clave}`);
  return html.replace(asignacion, valor === null ? '' : `xml_values['${clave}'] = ${valor};\n`);
}

function preparar(def: DefRespuesta) {
  const { fetchFalso, llamadas } = crearFetchFalso({ [RUTA]: def });
  const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
  const crudas: RespuestaCruda[] = [];
  return { http, llamadas, crudas, sumidero: (r: RespuestaCruda) => void crudas.push(r) };
}

const vacio = (mes: number): BheEmitidaMes => ({ mes, bruto: 0, retencionTerceros: 0, retencionPropia: 0, vigentes: 0, anuladas: 0, folioInicial: null, folioFinal: null });

describe('bheEmitidasAnual', () => {
  it('pide el informe anual del año comercial y devuelve los 12 meses; vacío es 0 y sin folios', async () => {
    const { http, llamadas, sumidero } = preparar({ headers: HTML_SIN_CHARSET, body: new Uint8Array(Buffer.from(FIXTURE, 'latin1')) });

    const r = await bheEmitidasAnual(http, sumidero, PERSONA, 2025);

    const url = new URL(llamadas[0]!.url);
    expect(url.origin + url.pathname).toBe('https://loa.sii.cl/cgi_IMT/TMBCOC_InformeAnualBhe.cgi');
    expect(Object.fromEntries(url.searchParams)).toEqual({ rut_arrastre: '11111111', dv_arrastre: '1', cbanoinformeanual: '2025' });
    expect(llamadas).toHaveLength(1);
    expect(r.anioComercial).toBe(2025);
    expect(r.sociedadProfesional).toBe(false);
    expect(r.meses.map((m) => m.mes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(r.meses[0]).toEqual({ mes: 1, bruto: 450_000, retencionTerceros: 61_875, retencionPropia: 0, vigentes: 2, anuladas: 0, folioInicial: 1, folioFinal: 2 });
    expect(r.meses[1]).toEqual(vacio(2));
    expect(r.meses[2]).toEqual({ mes: 3, bruto: 300_000, retencionTerceros: 41_250, retencionPropia: 0, vigentes: 2, anuladas: 1, folioInicial: 3, folioFinal: 5 });
    expect(r.meses[11]).toEqual({ mes: 12, bruto: 250_000, retencionTerceros: 0, retencionPropia: 34_375, vigentes: 1, anuladas: 0, folioInicial: 6, folioFinal: 6 });
    expect(r.meses.slice(3, 11)).toEqual([4, 5, 6, 7, 8, 9, 10, 11].map(vacio));
  });

  it('lee sociedad de profesionales, comillas simples y montos con punto de miles', async () => {
    const html = con('ene1', "'1.250.000'", con('es_sociedad_profesionales', '"SI"'));
    const { http, sumidero } = preparar({ headers: HTML, body: html });

    const r = await bheEmitidasAnual(http, sumidero, PERSONA, 2025);

    expect(r.sociedadProfesional).toBe(true);
    expect(r.meses[0]?.bruto).toBe(1_250_000);
  });

  it('ignora las sumas y totales: son expresiones que la página calcula, no valores', async () => {
    const html = con('tot1', '"999999999"', con('sumene', '"123"'));
    const { http, sumidero } = preparar({ headers: HTML, body: html });

    const r = await bheEmitidasAnual(http, sumidero, PERSONA, 2025);

    expect(r.meses.reduce((s, m) => s + m.bruto, 0)).toBe(1_000_000);
  });

  it('una clave de un mes que falta cuenta como 0, igual que vacía', async () => {
    const { http, sumidero } = preparar({ headers: HTML, body: con('feb1', null) });
    expect((await bheEmitidasAnual(http, sumidero, PERSONA, 2025)).meses[1]).toEqual(vacio(2));
  });

  it('sin ninguna clave de mes es PORTAL_CAMBIO', async () => {
    const sinMeses = FIXTURE.replace(/xml_values\['(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\d'\] = [^\n]*\n/g, '');
    const { http, sumidero } = preparar({ headers: HTML, body: sinMeses });
    expect(await codigoDe(bheEmitidasAnual(http, sumidero, PERSONA, 2025))).toBe('PORTAL_CAMBIO');
  });

  it.each([
    ['otro año', '"2024"'],
    ['un año vacío', '""'],
  ])('anio_consulta con %s es PORTAL_CAMBIO', async (_caso, valor) => {
    const { http, sumidero } = preparar({ headers: HTML, body: con('anio_consulta', valor) });
    expect(await codigoDe(bheEmitidasAnual(http, sumidero, PERSONA, 2025))).toBe('PORTAL_CAMBIO');
  });

  it('sin anio_consulta es PORTAL_CAMBIO: no se puede saber de qué año es', async () => {
    const { http, sumidero } = preparar({ headers: HTML, body: con('anio_consulta', null) });
    expect(await codigoDe(bheEmitidasAnual(http, sumidero, PERSONA, 2025))).toBe('PORTAL_CAMBIO');
  });

  it('un informe de otro RUT es PORTAL_CAMBIO', async () => {
    const { http, sumidero } = preparar({ headers: HTML, body: con('rut_arrastre', '"22222222"') });
    expect(await codigoDe(bheEmitidasAnual(http, sumidero, PERSONA, 2025))).toBe('PORTAL_CAMBIO');
  });

  it.each([
    ['un monto con letras', 'ene1', '"45a000"'],
    ['un monto negativo', 'ene2', '"-100"'],
    ['un monto con decimales', 'mar1', '"300000,5"'],
    ['una cantidad que no es número', 'dic6', '"uno"'],
  ])('%s es PORTAL_CAMBIO: nunca se lee como 0', async (_caso, clave, valor) => {
    const { http, sumidero } = preparar({ headers: HTML, body: con(clave, valor) });
    expect(await codigoDe(bheEmitidasAnual(http, sumidero, PERSONA, 2025))).toBe('PORTAL_CAMBIO');
  });

  it('guarda la evidencia saneada, sin el nombre del contribuyente', async () => {
    const { http, sumidero, crudas } = preparar({ headers: HTML_SIN_CHARSET, body: new Uint8Array(Buffer.from(FIXTURE, 'latin1')) });

    await bheEmitidasAnual(http, sumidero, PERSONA, 2025);

    expect(crudas).toHaveLength(1);
    expect(crudas[0]).toMatchObject({ superficie: 'bhe.emitidas.anual', parametros: { rut_arrastre: '11111111', dv_arrastre: '1', cbanoinformeanual: '2025' } });
    expect(crudas[0]!.cuerpo).not.toContain('CONTRIBUYENTE FICTICIO DEMO');
    expect(crudas[0]!.cuerpo).not.toMatch(/\[\s*'nombre_contribuyente'\s*\]\s*=(?!=)/);
    // La lectura del nombre en el script se queda; los datos del informe también.
    expect(crudas[0]!.cuerpo).toContain("= xml_values['nombre_contribuyente'];");
    expect(crudas[0]!.cuerpo).toContain("xml_values['ene1'] = \"450000\";");
  });

  it('401 es SESION_REQUERIDA y 429 es SII_LIMITE, sin evidencia', async () => {
    const sesion = preparar({ status: 401, headers: HTML, body: 'No autorizado' });
    expect(await codigoDe(bheEmitidasAnual(sesion.http, sesion.sumidero, PERSONA, 2025))).toBe('SESION_REQUERIDA');
    expect(sesion.crudas).toEqual([]);
    const limite = preparar({ status: 429, headers: HTML, body: 'Too many requests' });
    expect(await codigoDe(bheEmitidasAnual(limite.http, limite.sumidero, PERSONA, 2025))).toBe('SII_LIMITE');
    expect(limite.crudas).toEqual([]);
  });

  it('403 es SII_RECHAZO y deja la evidencia', async () => {
    const { http, sumidero, crudas } = preparar({ status: 403, headers: HTML, body: '<html>Acceso denegado</html>' });
    expect(await codigoDe(bheEmitidasAnual(http, sumidero, PERSONA, 2025))).toBe('SII_RECHAZO');
    expect(crudas.map((c) => c.superficie)).toEqual(['bhe.emitidas.anual']);
  });

  it('el muro de login es SESION_REQUERIDA', async () => {
    const crudas: RespuestaCruda[] = [];
    const { fetchFalso } = crearFetchFalso({
      [RUTA]: { status: 302, headers: [['location', 'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html']] },
      'GET https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html': { headers: HTML, body: '<html>login</html>' },
    });
    const conMuro = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });

    expect(await codigoDe(bheEmitidasAnual(conMuro, (r) => void crudas.push(r), PERSONA, 2025))).toBe('SESION_REQUERIDA');
    expect(crudas).toEqual([]);
  });
});
