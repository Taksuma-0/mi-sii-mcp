import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { bheEmitidasMes } from '../../src/connectors/sii/bhe-emitidas.js';
import { sanearBhe } from '../../src/connectors/sii/bhe.js';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { parseRut } from '../../src/domain/rut.js';
import type { RespuestaCruda } from '../../src/domain/tipos.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, HTML, sinEsperas, type DefRespuesta } from '../helpers/http-falso.js';

const RUTA = 'GET https://loa.sii.cl/cgi_IMT/TMBCOC_InformeMensualBhe.cgi';
const PERSONA = parseRut('11111111-1');
const MARZO = parsePeriodo('2025-03');
const FIXTURE = new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', 'bhe-emitidas-mensual.html')));
/** Como lo entrega el SII: `text/html` sin charset en el encabezado (el charset viene en el `<meta>`). */
const HTML_SIN_CHARSET: readonly (readonly [string, string])[] = [['content-type', 'text/html']];

interface FilaSintetica {
  readonly folio: number;
  readonly anulada?: boolean;
  readonly bruto?: number;
  /** Campos que reemplazan a los por defecto (el valor va tal cual en el JS); null omite la asignación. */
  readonly campos?: Readonly<Record<string, string | null>>;
}

/** Página sintética del informe de emitidas: `total` es `total_boletas` (null lo omite); `xml` agrega o reemplaza metadatos. */
function pagina(total: number | null, filas: readonly FilaSintetica[], xml: Readonly<Record<string, string>> = {}): string {
  const meta: Record<string, string> = {
    nombre_contribuyente: '"CONTRIBUYENTE FICTICIO DEMO"',
    rut_arrastre: '"11111111"',
    dv_arrastre: '"1"',
    anio_consulta: '"2025"',
    mes_consulta: '"03"',
    ...(total === null ? {} : { total_boletas: `"${total}"` }),
    suma_honorarios: '0',
    ...xml,
  };
  const arr = filas.flatMap((f, i) => {
    const n = i + 1;
    const bruto = f.bruto ?? 100_000;
    const campos: Record<string, string | null> = {
      nroboleta: `"${f.folio}"`,
      usuemisor: '"CONTRIBUYENTE FICTICIO DEMO"',
      fechaemision: '"02/03/2025"',
      rutreceptor: '"33333333"',
      dvreceptor: '"3"',
      nombrereceptor: '"Cliente Ficticio"',
      fecha_boleta: '"01/03/2025"',
      totalhonorarios: `formatMiles("${bruto}",'.')`,
      es_soc_profesional: '"NO"',
      email_envio: '"cliente@ficticio.example"',
      retencion_emisor: `formatMiles("0",'.')`,
      retencion_receptor: `formatMiles("${Math.round(bruto * 0.1375)}",'.')`,
      honorariosliquidos: `formatMiles("${bruto - Math.round(bruto * 0.1375)}",'.')`,
      estado: f.anulada ? '"S"' : '"N"',
      fechaanulacion: f.anulada ? '"15/03/2025"' : '""',
      codigobarras: `"BHEE${f.folio}FICTICIO"`,
      ...f.campos,
    };
    return Object.entries(campos).flatMap(([campo, valor]) => (valor === null ? [] : [`arr_informe_mensual['${campo}_${n}'] = ${valor};`]));
  });
  const lineas = [...Object.entries(meta).map(([k, v]) => `xml_values['${k}'] = ${v};`), ...arr];
  return `<html><head><meta charset="iso-8859-1"><script>\n${lineas.join('\n')}\n</script></head><body></body></html>`;
}

function preparar(ruta: DefRespuesta | ((n: number) => DefRespuesta)) {
  const { fetchFalso, llamadas } = crearFetchFalso({ [RUTA]: typeof ruta === 'function' ? (_l, n) => ruta(n) : ruta });
  const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
  const crudas: RespuestaCruda[] = [];
  return { http, llamadas, crudas, sumidero: (r: RespuestaCruda) => void crudas.push(r) };
}

const paginaDe = (url: string): string | null => new URL(url).searchParams.get('pagina_solicitada');

describe('bheEmitidasMes', () => {
  it('pide el informe mensual de emitidas y devuelve las boletas normalizadas, con la anulada marcada', async () => {
    const { http, llamadas, sumidero } = preparar({ headers: HTML_SIN_CHARSET, body: FIXTURE });

    const r = await bheEmitidasMes(http, sumidero, PERSONA, MARZO);

    const url = new URL(llamadas[0]!.url);
    expect(url.origin + url.pathname).toBe('https://loa.sii.cl/cgi_IMT/TMBCOC_InformeMensualBhe.cgi');
    expect(Object.fromEntries(url.searchParams)).toEqual({ rut_arrastre: '11111111', dv_arrastre: '1', cbanoinformemensual: '2025', cbmesinformemensual: '03', pagina_solicitada: '0' });
    expect(llamadas).toHaveLength(1);
    expect(r).toEqual({
      total: 3,
      boletas: [
        {
          rut: '11111111-1',
          periodo: '2025-03',
          folio: 1,
          rutReceptor: '33333333-3',
          nombreReceptor: 'Compañía Ficticia Ñandú SpA',
          fecha: '2025-03-05',
          fechaEmision: '2025-03-05',
          bruto: 500_000,
          retencionEmisor: 0,
          retencionReceptor: 68_750,
          liquido: 431_250,
          sociedadProfesional: false,
          anulada: false,
          fechaAnulacion: null,
        },
        {
          rut: '11111111-1',
          periodo: '2025-03',
          folio: 2,
          rutReceptor: '44444444-4',
          nombreReceptor: null,
          fecha: '2025-03-11',
          fechaEmision: '2025-03-12',
          bruto: 700_000,
          retencionEmisor: 0,
          retencionReceptor: 96_250,
          liquido: 603_750,
          sociedadProfesional: true,
          anulada: false,
          fechaAnulacion: null,
        },
        {
          rut: '11111111-1',
          periodo: '2025-03',
          folio: 3,
          rutReceptor: '55555555-5',
          nombreReceptor: 'Persona Ficticia',
          fecha: '2025-03-18',
          fechaEmision: '2025-03-18',
          bruto: 200_000,
          retencionEmisor: 27_500,
          retencionReceptor: 0,
          liquido: 172_500,
          sociedadProfesional: false,
          anulada: true,
          fechaAnulacion: '2025-03-20',
        },
      ],
    });
  });

  it('guarda la evidencia sin el emisor, el correo del receptor, el código de barras ni el nombre del contribuyente', async () => {
    const { http, sumidero, crudas } = preparar({ headers: HTML_SIN_CHARSET, body: FIXTURE });

    await bheEmitidasMes(http, sumidero, PERSONA, MARZO);

    expect(crudas.map((c) => [c.superficie, c.parametros['pagina_solicitada']])).toEqual([['bhe.emitidas.mensual', 0]]);
    const cuerpo = crudas[0]!.cuerpo;
    expect(cuerpo).not.toMatch(/CONTRIBUYENTE FICTICIO DEMO|ficticia\.example|otra\.example|BHEE000\dFICTICIO/);
    expect(cuerpo).not.toMatch(/\[\s*'(?:usuemisor_\d+|email_envio_\d+|codigobarras_\d+|nombre_contribuyente)'\s*\]\s*=(?!=)/);
    // Las lecturas de esas claves en el script se quedan; los datos de las boletas también.
    expect(cuerpo).toContain("arr_informe_mensual['usuemisor_' + i]");
    expect(cuerpo).toContain("arr_informe_mensual['email_envio_' + i]");
    expect(cuerpo).toContain("arr_informe_mensual['rutreceptor_1'] = \"33333333\";");
  });

  it('pagina como las recibidas: sigue hasta total_boletas y deduplica por folio', async () => {
    const { http, llamadas, sumidero } = preparar((n) => ({ headers: HTML, body: n === 1 ? pagina(3, [{ folio: 1 }, { folio: 2 }]) : pagina(3, [{ folio: 2 }, { folio: 3 }]) }));

    const r = await bheEmitidasMes(http, sumidero, PERSONA, MARZO);

    expect(llamadas.map((l) => paginaDe(l.url))).toEqual(['0', '1']);
    expect(r?.boletas.map((b) => b.folio)).toEqual([1, 2, 3]);
  });

  it('si el SII repite la página y faltan boletas es DATOS_INCOMPLETOS', async () => {
    const { http, llamadas, sumidero } = preparar({ headers: HTML, body: pagina(3, [{ folio: 1 }]) });
    expect(await codigoDe(bheEmitidasMes(http, sumidero, PERSONA, MARZO))).toBe('DATOS_INCOMPLETOS');
    expect(llamadas).toHaveLength(2);
  });

  it('total_boletas 0 es un mes sin boletas; sin total ni boletas es un vacío ambiguo (null)', async () => {
    const cero = preparar({ headers: HTML, body: pagina(0, []) });
    expect(await bheEmitidasMes(cero.http, cero.sumidero, PERSONA, MARZO)).toEqual({ total: 0, boletas: [] });
    const ambiguo = preparar({ headers: HTML, body: pagina(null, []) });
    expect(await bheEmitidasMes(ambiguo.http, ambiguo.sumidero, PERSONA, MARZO)).toBeNull();
  });

  describe('sumas del SII', () => {
    it('0 o ausentes no se controlan', async () => {
      const { http, sumidero } = preparar({ headers: HTML, body: pagina(1, [{ folio: 1 }], { suma_retencion_receptor: '0', suma_liquido: '""' }) });
      expect((await bheEmitidasMes(http, sumidero, PERSONA, MARZO))?.boletas).toHaveLength(1);
    });

    it('una suma positiva que cuadra se acepta (con o sin anuladas)', async () => {
      const filas = [{ folio: 1, bruto: 100_000 }, { folio: 2, bruto: 50_000, anulada: true }];
      for (const suma of ['100000', '150000']) {
        const { http, sumidero } = preparar({ headers: HTML, body: pagina(2, filas, { suma_honorarios: suma }) });
        expect((await bheEmitidasMes(http, sumidero, PERSONA, MARZO))?.boletas, suma).toHaveLength(2);
      }
    });

    it.each([
      ['suma_honorarios', '999'],
      ['suma_retencion_receptor', '1'],
      ['suma_retencion_emisor', '5'],
      ['suma_liquido', '7'],
    ])('%s positiva que no cuadra es PORTAL_CAMBIO', async (clave, valor) => {
      const { http, sumidero } = preparar({ headers: HTML, body: pagina(1, [{ folio: 1 }], { [clave]: valor }) });
      expect(await codigoDe(bheEmitidasMes(http, sumidero, PERSONA, MARZO))).toBe('PORTAL_CAMBIO');
    });
  });

  it.each([
    ['otro año', { anio_consulta: '"2024"' }],
    ['otro mes', { mes_consulta: '"4"' }],
    ['otro RUT', { rut_arrastre: '"22222222"' }],
  ])('un informe de %s es PORTAL_CAMBIO', async (_caso, xml) => {
    const { http, sumidero } = preparar({ headers: HTML, body: pagina(1, [{ folio: 1 }], xml) });
    expect(await codigoDe(bheEmitidasMes(http, sumidero, PERSONA, MARZO))).toBe('PORTAL_CAMBIO');
  });

  it('el mes del informe sin cero a la izquierda es el mismo mes', async () => {
    const { http, sumidero } = preparar({ headers: HTML, body: pagina(1, [{ folio: 1 }], { mes_consulta: '"3"' }) });
    expect((await bheEmitidasMes(http, sumidero, PERSONA, MARZO))?.boletas).toHaveLength(1);
  });

  it.each(['nroboleta', 'rutreceptor', 'dvreceptor', 'totalhonorarios', 'retencion_emisor', 'retencion_receptor', 'honorariosliquidos', 'estado'])(
    'una boleta sin %s es PORTAL_CAMBIO: nunca vale 0 ni vigente por omisión',
    async (campo) => {
      const { http, sumidero } = preparar({ headers: HTML, body: pagina(1, [{ folio: 1, campos: { [campo]: null } }]) });
      expect(await codigoDe(bheEmitidasMes(http, sumidero, PERSONA, MARZO))).toBe('PORTAL_CAMBIO');
    },
  );

  it.each([
    ['un RUT de receptor inválido', { dvreceptor: '"9"' }],
    ['un estado desconocido', { estado: '"X"' }],
    ['un monto ilegible', { totalhonorarios: '"cien"' }],
  ])('una boleta con %s es PORTAL_CAMBIO', async (_caso, campos) => {
    const { http, sumidero } = preparar({ headers: HTML, body: pagina(1, [{ folio: 1, campos }]) });
    expect(await codigoDe(bheEmitidasMes(http, sumidero, PERSONA, MARZO))).toBe('PORTAL_CAMBIO');
  });

  it('401 es SESION_REQUERIDA y 429 SII_LIMITE, sin evidencia; 403 es SII_RECHAZO con evidencia', async () => {
    const sesion = preparar({ status: 401, headers: HTML, body: 'No autorizado' });
    expect(await codigoDe(bheEmitidasMes(sesion.http, sesion.sumidero, PERSONA, MARZO))).toBe('SESION_REQUERIDA');
    expect(sesion.crudas).toEqual([]);
    const limite = preparar({ status: 429, headers: HTML, body: 'Too many requests' });
    expect(await codigoDe(bheEmitidasMes(limite.http, limite.sumidero, PERSONA, MARZO))).toBe('SII_LIMITE');
    expect(limite.crudas).toEqual([]);
    const rechazo = preparar({ status: 403, headers: HTML, body: '<html>Acceso denegado</html>' });
    expect(await codigoDe(bheEmitidasMes(rechazo.http, rechazo.sumidero, PERSONA, MARZO))).toBe('SII_RECHAZO');
    expect(rechazo.crudas.map((c) => c.superficie)).toEqual(['bhe.emitidas.mensual']);
  });
});

describe('sanearBhe con las claves privadas de las emitidas', () => {
  it('quita usuemisor_N y email_envio_N con cualquier espaciado', () => {
    const html = `arr_informe_mensual[ "usuemisor_12" ]="Alguien";\narr_informe_mensual['email_envio_3'] =  formatMiles("x",'.');\narr_informe_mensual['nroboleta_3'] = "3";`;
    expect(sanearBhe(html)).toBe(`\n\narr_informe_mensual['nroboleta_3'] = "3";`);
  });

  it('si queda una asignación de esas claves en otra sintaxis, falla con PORTAL_CAMBIO', () => {
    expect(() => sanearBhe('var datos = { email_envio_1: "a@b.example" };')).toThrow(expect.objectContaining({ codigo: 'PORTAL_CAMBIO' }));
    expect(() => sanearBhe('usuemisor_2 = "Alguien";')).toThrow(expect.objectContaining({ codigo: 'PORTAL_CAMBIO' }));
  });
});
