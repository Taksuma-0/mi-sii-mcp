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
  readonly anulada?: boolean;
  /** Campos que reemplazan a los por defecto (el valor va tal cual en el JS); null omite la asignación. */
  readonly campos?: Readonly<Record<string, string | null>>;
}

interface ExtraPagina {
  /** `pagina_sig_codigo`, entre comillas. */
  readonly sig?: string;
  /** `suma_retencion_receptor`, tal cual (sin comillas). */
  readonly sumaRetencion?: string;
}

/** Página sintética del informe: `total` es `total_boletas` (un texto va tal cual, sin comillas); null lo omite. */
function pagina(total: number | string | null, filas: readonly FilaSintetica[], extra: ExtraPagina = {}): string {
  const xml = [
    ...(total === null ? [] : [`xml_values['total_boletas'] = ${total};`]),
    `xml_values['cant_boletas'] = ${filas.length};`,
    "xml_values['nombre_contribuyente'] = \"EMPRESA DEMO SPA\";",
    ...(extra.sig === undefined ? [] : [`xml_values['pagina_sig_codigo'] = "${extra.sig}";`]),
    ...(extra.sumaRetencion === undefined ? [] : [`xml_values['suma_retencion_receptor'] = ${extra.sumaRetencion};`]),
  ];
  const arr = filas.flatMap((f, i) => {
    const n = i + 1;
    const campos: Record<string, string | null> = {
      nroboleta: `"${f.folio}"`,
      rutemisor: `"${f.rutemisor ?? '33333333'}"`,
      dvemisor: `"${f.dv ?? '3'}"`,
      nombre_emisor: '"Emisor Ficticio"',
      fecha_boleta: '"01/09/2026"',
      totalhonorarios: `formatMiles("100000",'.')`,
      honorariosliquidos: `formatMiles("84750",'.')`,
      es_soc_profesional: '"NO"',
      cod_comuna: '"13101"',
      retencion_receptor: `formatMiles("${f.retencion ?? 15250}",'.')`,
      estado: f.anulada ? '"S"' : '"N"',
      fechaanulacion: f.anulada ? '"15/09/2026"' : '""',
      codigobarras: `"BHE${f.folio}"`,
      ...f.campos,
    };
    return Object.entries(campos).flatMap(([campo, valor]) => (valor === null ? [] : [`arr_informe_mensual['${campo}_${n}'] = ${valor};`]));
  });
  return `<html><head><meta charset="iso-8859-1"><script>\n${[...xml, ...arr].join('\n')}\n</script></head><body></body></html>`;
}

function preparar(ruta: DefRespuesta | ((n: number, pagina: string | null) => DefRespuesta)) {
  const { fetchFalso, llamadas } = crearFetchFalso({ [RUTA]: typeof ruta === 'function' ? (l, n) => ruta(n, paginaDe(l.url)) : ruta });
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

  it.each(['nroboleta', 'rutemisor', 'dvemisor', 'totalhonorarios', 'retencion_receptor', 'honorariosliquidos', 'estado'])(
    'una boleta sin %s es PORTAL_CAMBIO: nunca vale 0 ni vigente por omisión',
    async (campo) => {
      const { http, sumidero } = preparar({ headers: HTML, body: pagina(2, [{ folio: 1 }, { folio: 2, campos: { [campo]: null } }]) });

      expect(await codigoDe(bheRecibidas(http, sumidero, EMPRESA, SEPT))).toBe('PORTAL_CAMBIO');
    },
  );

  it.each([
    ['retención vacía', { retencion_receptor: '""' }],
    ['bruto vacío en formatMiles', { totalhonorarios: `formatMiles("",'.')` }],
    ['estado desconocido', { estado: '"X"' }],
    ['estado vacío', { estado: '""' }],
  ])('una boleta con %s es PORTAL_CAMBIO', async (_caso, campos) => {
    const { http, sumidero } = preparar({ headers: HTML, body: pagina(1, [{ folio: 1, campos }]) });

    expect(await codigoDe(bheRecibidas(http, sumidero, EMPRESA, SEPT))).toBe('PORTAL_CAMBIO');
  });

  it.each([
    ['entre comillas', '""'],
    ['sin valor', ''],
  ])('total_boletas vacío (%s) sin boletas es ambiguo (null), no un mes sin boletas', async (_caso, total) => {
    const { http, llamadas, sumidero } = preparar({ headers: HTML, body: pagina(total, []) });

    expect(await bheRecibidas(http, sumidero, EMPRESA, SEPT)).toBeNull();
    expect(llamadas).toHaveLength(1);
  });

  it('total_boletas vacío con boletas es PORTAL_CAMBIO', async () => {
    const { http, sumidero } = preparar({ headers: HTML, body: pagina('""', [{ folio: 1 }]) });

    expect(await codigoDe(bheRecibidas(http, sumidero, EMPRESA, SEPT))).toBe('PORTAL_CAMBIO');
  });

  it('si una página se repite y faltan boletas, sigue pagina_sig_codigo antes de rendirse', async () => {
    const primera = pagina(3, [{ folio: 1 }, { folio: 2 }], { sig: '7' });
    const { http, llamadas, sumidero } = preparar((_n, p) => ({ headers: HTML, body: p === '7' ? pagina(3, [{ folio: 3 }], { sig: '' }) : primera }));

    const r = await bheRecibidas(http, sumidero, EMPRESA, SEPT);

    expect(llamadas.map((l) => paginaDe(l.url))).toEqual(['0', '1', '7']);
    expect(r?.boletas.map((b) => b.folio)).toEqual([1, 2, 3]);
  });

  it.each([
    ['un código largo del SII (no un índice de página)', '20260915123456'],
    ['un índice fuera del tope de páginas', '50'],
  ])('una página repetida con pagina_sig_codigo que es %s no salta: DATOS_INCOMPLETOS sin pedidos de más', async (_caso, sig) => {
    const { http, llamadas, sumidero } = preparar({ headers: HTML, body: pagina(3, [{ folio: 1 }, { folio: 2 }], { sig }) });

    expect(await codigoDe(bheRecibidas(http, sumidero, EMPRESA, SEPT))).toBe('DATOS_INCOMPLETOS');
    expect(llamadas.map((l) => paginaDe(l.url))).toEqual(['0', '1']);
  });

  it('una página repetida cuyo pagina_sig_codigo ya se pidió no se vuelve a pedir: DATOS_INCOMPLETOS', async () => {
    const { http, llamadas, sumidero } = preparar({ headers: HTML, body: pagina(3, [{ folio: 1 }, { folio: 2 }], { sig: '1' }) });

    expect(await codigoDe(bheRecibidas(http, sumidero, EMPRESA, SEPT))).toBe('DATOS_INCOMPLETOS');
    expect(llamadas.map((l) => paginaDe(l.url))).toEqual(['0', '1']);
  });

  describe('control de la suma de retención del SII', () => {
    // Vigentes: 15.250 + 30.000 = 45.250; con la anulada (10.000): 55.250.
    const filas: readonly FilaSintetica[] = [{ folio: 1 }, { folio: 2, retencion: 30_000 }, { folio: 3, retencion: 10_000, anulada: true }];

    it.each([
      ['las vigentes', '45250'],
      ['todas, con anuladas', '55250'],
      ['sin dato numérico (se ignora)', '""'],
    ])('acepta una suma que cuadra con %s', async (_caso, suma) => {
      const { http, sumidero } = preparar({ headers: HTML, body: pagina(3, filas, { sumaRetencion: suma }) });

      expect((await bheRecibidas(http, sumidero, EMPRESA, SEPT))?.boletas).toHaveLength(3);
    });

    it('una suma informada en 0 es un valor vacío del SII (la página calcula los totales en el cliente): no se controla y los totales salen de las boletas', async () => {
      const { http, sumidero } = preparar({ headers: HTML, body: pagina(3, filas, { sumaRetencion: '0' }) });

      const r = await bheRecibidas(http, sumidero, EMPRESA, SEPT);

      expect(r?.boletas).toHaveLength(3);
      expect(r?.totales).toEqual({ total: 3, bruto: 200_000, retencion: 45_250, liquido: 169_500 });
    });

    it('una suma positiva que no cuadra sigue siendo PORTAL_CAMBIO aunque otras sumas vengan en 0', async () => {
      const { http, sumidero } = preparar({ headers: HTML, body: pagina(3, filas, { sumaRetencion: '1' }) });

      expect(await codigoDe(bheRecibidas(http, sumidero, EMPRESA, SEPT))).toBe('PORTAL_CAMBIO');
    });

    it('una suma que no cuadra con las vigentes ni con todas es PORTAL_CAMBIO', async () => {
      const { http, sumidero } = preparar({ headers: HTML, body: pagina(3, filas, { sumaRetencion: '99999' }) });

      expect(await codigoDe(bheRecibidas(http, sumidero, EMPRESA, SEPT))).toBe('PORTAL_CAMBIO');
    });

    it('en un informe de varias páginas acepta la suma de solo la primera página', async () => {
      const { http, sumidero } = preparar((n) => ({
        headers: HTML,
        body: n === 1 ? pagina(3, [{ folio: 1 }, { folio: 2, retencion: 30_000 }], { sumaRetencion: '45250' }) : pagina(3, [{ folio: 3, retencion: 5_000 }], { sumaRetencion: '5000' }),
      }));

      expect((await bheRecibidas(http, sumidero, EMPRESA, SEPT))?.boletas).toHaveLength(3);
    });
  });

  it('429 es SII_LIMITE (fatal) y no deja evidencia', async () => {
    const { http, sumidero, crudas } = preparar({ status: 429, headers: HTML, body: 'Too many requests' });
    const error = await bheRecibidas(http, sumidero, EMPRESA, SEPT).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'SII_LIMITE' });
    expect((error as Error).message).toContain('limitó las consultas');
    expect(crudas).toEqual([]);
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
      // Como la página real, la fixture lee esas claves en otras partes del script: las lecturas se quedan, las asignaciones no.
      expect(c.cuerpo).not.toMatch(/\[\s*'(?:codigobarras_\d+|cod_comuna_\d+|nombre_contribuyente)'\s*\]\s*=(?!=)/);
      expect(c.cuerpo).not.toMatch(/BHE0\d+FICTICIO|EMPRESA DEMO SPA|13101|13114/);
      expect(c.cuerpo).toContain("= xml_values['nombre_contribuyente'];");
      expect(c.cuerpo).toContain("arr_informe_mensual['codigobarras_' + i]");
      expect(c.cuerpo).toContain("arr_informe_mensual['cod_comuna_' + i]");
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
      "arr_informe_mensual['cod_comuna_4'] =\n  \"13114\";",
      "arr_informe_mensual['nombre_emisor_3'] = \"Emisor Ficticio\";",
    ].join('\n');

    const saneado = sanearBhe(html);

    expect(saneado).not.toMatch(/nombre_contribuyente|codigobarras|cod_comuna|EMPRESA|DEMO|X1|13101|13114/);
    expect(saneado).toContain("arr_informe_mensual['nombre_emisor_3'] = \"Emisor Ficticio\";");
  });

  it('deja las lecturas de esas claves (la página real las menciona fuera de las asignaciones)', () => {
    const lecturas = [
      "document.getElementById('nombre').innerText = xml_values['nombre_contribuyente'];",
      "if (xml_values['nombre_contribuyente'] == '') { ocultar(); }",
      "var barras = arr_informe_mensual['codigobarras_' + i];",
      "verBoleta(arr_informe_mensual['codigobarras_1'], arr_informe_mensual['cod_comuna_1']);",
      "var titulo = xml_values['nombre_contribuyente'] ? xml_values['nombre_contribuyente'] : '';",
    ].join('\n');

    expect(sanearBhe(lecturas)).toBe(lecturas);
  });

  it.each([
    ['un objeto literal', 'var fila = { codigobarras_1: "X1" };'],
    ['una variable suelta', 'nombre_contribuyente = "EMPRESA DEMO SPA"'],
    ['una asignación con punto', 'arr_informe_mensual.codigobarras_1 = "X1";'],
  ])('si queda una asignación de esas claves (%s), falla con PORTAL_CAMBIO en vez de guardarla', (_caso, html) => {
    expect(() => sanearBhe(html)).toThrow(expect.objectContaining({ codigo: 'PORTAL_CAMBIO' }));
  });
});
