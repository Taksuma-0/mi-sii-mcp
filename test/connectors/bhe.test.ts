import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { bheRecibidas, sanearBhe } from '../../src/connectors/sii/bhe.js';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { parseRut } from '../../src/domain/rut.js';
import type { RespuestaCruda } from '../../src/domain/tipos.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, HTML, sinEsperas, type DefRespuesta } from '../helpers/http-falso.js';

const fixture = (nombre: string): Uint8Array => new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', nombre)));
const RUTA = 'GET https://loa.sii.cl/cgi_IMT/TMBCOC_InformeMensualBheRec.cgi';
const EMPRESA = parseRut('22222222-2');
const SEPT = parsePeriodo('2026-09');
/** Como lo entrega el SII: `text/html` sin charset en el encabezado (el charset viene en el `<meta>`). */
const HTML_SIN_CHARSET: readonly (readonly [string, string])[] = [['content-type', 'text/html']];

interface FilaSintetica {
  readonly folio: number;
  readonly rutemisor?: string;
  readonly dv?: string;
  readonly retencion?: number;
}

/** Página sintética del informe: `total` es `total_boletas`; null lo omite. */
function pagina(total: number | null, filas: readonly FilaSintetica[]): string {
  const xml = [
    ...(total === null ? [] : [`xml_values['total_boletas'] = ${total};`]),
    `xml_values['cant_boletas'] = ${filas.length};`,
    "xml_values['nombre_contribuyente'] = \"EMPRESA DEMO SPA\";",
  ];
  const arr = filas.flatMap((f, i) => {
    const n = i + 1;
    return [
      `arr_informe_mensual['nroboleta_${n}'] = "${f.folio}";`,
      `arr_informe_mensual['rutemisor_${n}'] = "${f.rutemisor ?? '33333333'}";`,
      `arr_informe_mensual['dvemisor_${n}'] = "${f.dv ?? '3'}";`,
      `arr_informe_mensual['nombre_emisor_${n}'] = "Emisor Ficticio";`,
      `arr_informe_mensual['fecha_boleta_${n}'] = "01/09/2026";`,
      `arr_informe_mensual['totalhonorarios_${n}'] = formatMiles("100000",'.');`,
      `arr_informe_mensual['honorariosliquidos_${n}'] = formatMiles("84750",'.');`,
      `arr_informe_mensual['es_soc_profesional_${n}'] = "NO";`,
      `arr_informe_mensual['cod_comuna_${n}'] = "13101";`,
      `arr_informe_mensual['retencion_receptor_${n}'] = formatMiles("${f.retencion ?? 15250}",'.');`,
      `arr_informe_mensual['estado_${n}'] = "N";`,
      `arr_informe_mensual['fechaanulacion_${n}'] = "";`,
      `arr_informe_mensual['codigobarras_${n}'] = "BHE${f.folio}";`,
    ];
  });
  return `<html><head><meta charset="iso-8859-1"><script>\n${[...xml, ...arr].join('\n')}\n</script></head><body></body></html>`;
}

function preparar(ruta: DefRespuesta | ((n: number) => DefRespuesta)) {
  const { fetchFalso, llamadas } = crearFetchFalso({ [RUTA]: typeof ruta === 'function' ? (_l, n) => ruta(n) : ruta });
  const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
  const crudas: RespuestaCruda[] = [];
  return { http, llamadas, crudas, sumidero: (r: RespuestaCruda) => void crudas.push(r) };
}

const paginaDe = (url: string): string | null => new URL(url).searchParams.get('pagina_solicitada');

describe('bheRecibidas', () => {
  it('pide el informe mensual página a página y devuelve las boletas normalizadas, con la anulada marcada', async () => {
    const { http, llamadas, sumidero } = preparar((n) => ({ headers: HTML_SIN_CHARSET, body: fixture(n === 1 ? 'bhe-mensual.html' : 'bhe-mensual-pagina-2.html') }));

    const r = await bheRecibidas(http, sumidero, EMPRESA, SEPT);

    const url = new URL(llamadas[0]!.url);
    expect(url.origin + url.pathname).toBe('https://loa.sii.cl/cgi_IMT/TMBCOC_InformeMensualBheRec.cgi');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      rut_arrastre: '22222222',
      dv_arrastre: '2',
      cbanoinformemensual: '2026',
      cbmesinformemensual: '09',
      pagina_solicitada: '0',
    });
    expect(llamadas.map((l) => paginaDe(l.url))).toEqual(['0', '1']);
    expect(r).toEqual({
      boletas: [
        {
          rut: '22222222-2',
          periodo: '2026-09',
          rutEmisor: '33333333-3',
          folio: 101,
          nombreEmisor: 'José Ñúñez Peñaloza',
          fecha: '2026-09-05',
          bruto: 1_000_000,
          retencion: 152_500,
          liquido: 847_500,
          sociedadProfesional: false,
          anulada: false,
          fechaAnulacion: null,
        },
        {
          rut: '22222222-2',
          periodo: '2026-09',
          rutEmisor: '44444444-4',
          folio: 7,
          nombreEmisor: 'Consultora Árbol Limitada',
          fecha: '2026-09-12',
          bruto: 200_000,
          retencion: 30_500,
          liquido: 169_500,
          sociedadProfesional: true,
          anulada: true,
          fechaAnulacion: '2026-09-15',
        },
        {
          rut: '22222222-2',
          periodo: '2026-09',
          rutEmisor: '33333333-3',
          folio: 102,
          nombreEmisor: 'José Ñúñez Peñaloza',
          fecha: '2026-09-20',
          bruto: 500_000,
          retencion: 76_250,
          liquido: 423_750,
          sociedadProfesional: false,
          anulada: false,
          fechaAnulacion: null,
        },
      ],
      totales: { total: 3, bruto: 1_500_000, retencion: 228_750, liquido: 1_271_250 },
    });
  });

  it('decodifica el latin1 del SII por el <meta> aunque el encabezado no traiga charset', async () => {
    const bytes = fixture('bhe-mensual.html');
    // La fixture es latin1 de verdad: la ñ es un solo byte 0xF1, no la secuencia UTF-8.
    expect(bytes.includes(0xf1)).toBe(true);
    expect(Buffer.from(bytes).includes(Buffer.from('ñ', 'utf8'))).toBe(false);
    const { http, sumidero, crudas } = preparar((n) => ({ headers: HTML_SIN_CHARSET, body: fixture(n === 1 ? 'bhe-mensual.html' : 'bhe-mensual-pagina-2.html') }));

    const informe = await bheRecibidas(http, sumidero, EMPRESA, SEPT);

    expect(informe?.boletas.map((b) => b.nombreEmisor)).toEqual(['José Ñúñez Peñaloza', 'Consultora Árbol Limitada', 'José Ñúñez Peñaloza']);
    expect(crudas[0]!.cuerpo).toContain('Ñúñez');
  });

  it('para cuando ya tiene total_boletas filas: no pide una página de más', async () => {
    const { http, llamadas, sumidero } = preparar({ headers: HTML, body: pagina(2, [{ folio: 1 }, { folio: 2 }]) });

    const r = await bheRecibidas(http, sumidero, EMPRESA, SEPT);

    expect(llamadas).toHaveLength(1);
    expect(r?.boletas.map((b) => b.folio)).toEqual([1, 2]);
  });

  it('el SII repite la última página cuando no hay más: deduplica por emisor y folio, y si faltan boletas es DATOS_INCOMPLETOS', async () => {
    const { http, llamadas, sumidero } = preparar({ headers: HTML, body: pagina(3, [{ folio: 1 }, { folio: 2 }]) });

    const e = await bheRecibidas(http, sumidero, EMPRESA, SEPT).catch((x: unknown) => x);

    expect(await codigoDe(Promise.reject(e))).toBe('DATOS_INCOMPLETOS');
    expect((e as Error).message).toContain('2 de 3');
    expect(llamadas.map((l) => paginaDe(l.url))).toEqual(['0', '1']);
  });

  it('una boleta de otro emisor con el mismo folio no es repetida', async () => {
    const { http, sumidero } = preparar((n) =>
      n === 1 ? { headers: HTML, body: pagina(2, [{ folio: 1 }]) } : { headers: HTML, body: pagina(2, [{ folio: 1, rutemisor: '44444444', dv: '4' }]) },
    );

    const r = await bheRecibidas(http, sumidero, EMPRESA, SEPT);

    expect(r?.boletas.map((b) => `${b.rutEmisor}:${b.folio}`)).toEqual(['33333333-3:1', '44444444-4:1']);
  });

  it('pide como máximo 50 páginas', async () => {
    const { http, llamadas, sumidero } = preparar((n) => ({ headers: HTML, body: pagina(1000, [{ folio: n }]) }));

    expect(await codigoDe(bheRecibidas(http, sumidero, EMPRESA, SEPT))).toBe('DATOS_INCOMPLETOS');
    expect(llamadas).toHaveLength(50);
    expect(paginaDe(llamadas[49]!.url)).toBe('49');
  });

  it('total_boletas 0 es un mes sin boletas válido', async () => {
    const { http, llamadas, sumidero } = preparar({ headers: HTML, body: pagina(0, []) });

    expect(await bheRecibidas(http, sumidero, EMPRESA, SEPT)).toEqual({ boletas: [], totales: { total: 0, bruto: 0, retencion: 0, liquido: 0 } });
    expect(llamadas).toHaveLength(1);
  });

  it('sin total_boletas ni boletas la respuesta es ambigua: devuelve null', async () => {
    const { http, sumidero } = preparar({ headers: HTML, body: pagina(null, []) });

    expect(await bheRecibidas(http, sumidero, EMPRESA, SEPT)).toBeNull();
  });

  it('con boletas pero sin total_boletas no se puede saber si está completo: PORTAL_CAMBIO', async () => {
    const { http, sumidero } = preparar({ headers: HTML, body: pagina(null, [{ folio: 1 }]) });

    expect(await codigoDe(bheRecibidas(http, sumidero, EMPRESA, SEPT))).toBe('PORTAL_CAMBIO');
  });

  it('una página sin arr_informe_mensual ni xml_values es PORTAL_CAMBIO', async () => {
    const { http, sumidero } = preparar({ headers: HTML, body: '<html><body>Servicio en mantención</body></html>' });

    expect(await codigoDe(bheRecibidas(http, sumidero, EMPRESA, SEPT))).toBe('PORTAL_CAMBIO');
  });

  it('una boleta con un RUT de emisor inválido es PORTAL_CAMBIO', async () => {
    const { http, sumidero } = preparar({ headers: HTML, body: pagina(1, [{ folio: 1, dv: '9' }]) });

    expect(await codigoDe(bheRecibidas(http, sumidero, EMPRESA, SEPT))).toBe('PORTAL_CAMBIO');
  });

  it('el muro de login es SESION_REQUERIDA', async () => {
    const crudas: RespuestaCruda[] = [];
    const { fetchFalso } = crearFetchFalso({
      [RUTA]: { status: 302, headers: [['location', 'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html']] },
      'GET https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html': { headers: HTML, body: '<html>login</html>' },
    });
    const conMuro = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });

    expect(await codigoDe(bheRecibidas(conMuro, (r) => void crudas.push(r), EMPRESA, SEPT))).toBe('SESION_REQUERIDA');
    expect(crudas).toEqual([]);
  });

  it('guarda cada página como evidencia saneada: sin código de barras, comuna ni nombre del contribuyente', async () => {
    const { http, sumidero, crudas } = preparar((n) => ({ headers: HTML_SIN_CHARSET, body: fixture(n === 1 ? 'bhe-mensual.html' : 'bhe-mensual-pagina-2.html') }));

    await bheRecibidas(http, sumidero, EMPRESA, SEPT);

    expect(crudas.map((c) => [c.superficie, c.parametros['pagina_solicitada']])).toEqual([
      ['bhe.recibidas.mensual', 0],
      ['bhe.recibidas.mensual', 1],
    ]);
    for (const c of crudas) {
      expect(c.cuerpo).not.toMatch(/codigobarras_\d|cod_comuna_\d|nombre_contribuyente|BHE0\d+FICTICIO|EMPRESA DEMO SPA|13101/);
      expect(c.cuerpo).toContain("arr_informe_mensual['nroboleta_1']");
      expect(c.cuerpo).toContain("xml_values['total_boletas']");
    }
  });
});

describe('sanearBhe', () => {
  it('quita las asignaciones de codigobarras_N, cod_comuna_N y nombre_contribuyente con cualquier espaciado', () => {
    const html = [
      'xml_values[\'nombre_contribuyente\']="EMPRESA; DEMO";',
      "arr_informe_mensual [ 'codigobarras_12' ]  =  \"X1\" ;",
      "arr_informe_mensual['cod_comuna_3'] = '13101';",
      "arr_informe_mensual['nombre_emisor_3'] = \"Emisor Ficticio\";",
    ].join('\n');

    const saneado = sanearBhe(html);

    expect(saneado).not.toMatch(/nombre_contribuyente|codigobarras|cod_comuna|EMPRESA|DEMO|X1|13101/);
    expect(saneado).toContain("arr_informe_mensual['nombre_emisor_3'] = \"Emisor Ficticio\";");
  });

  it('si queda alguna de esas claves sin poder quitarla, falla con PORTAL_CAMBIO en vez de guardarla', () => {
    expect(() => sanearBhe('var fila = { codigobarras_1: "X1" };')).toThrow(expect.objectContaining({ codigo: 'PORTAL_CAMBIO' }));
  });
});
