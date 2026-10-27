import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { djDetalle, djInformadas, MAX_PAGINAS_DJ } from '../../src/connectors/sii/terceros.js';
import { parseRut } from '../../src/domain/rut.js';
import type { DjTercero, RespuestaCruda } from '../../src/domain/tipos.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, JSON_CT, sinEsperas, type DefRespuesta, type LlamadaFalsa, type RutaFalsa } from '../helpers/http-falso.js';

const fixture = (nombre: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', nombre), 'utf8');
const BASE = 'https://www4.sii.cl/djconsultarentaui/services/data/facadeService';
const NAMESPACE = 'cl.sii.sdi.lob.renta.djconsultarenta.data.api.interfaces.FacadeService';
const RUTA = (op: string) => `POST ${BASE}/${op}`;
const PERSONA = parseRut('11111111-1');

async function preparar(rutas: Record<string, RutaFalsa>) {
  const { fetchFalso, llamadas } = crearFetchFalso(rutas);
  const jar = new CookieJar();
  await jar.setCookie('TOKEN=tok123; Domain=.sii.cl; Path=/', 'https://www4.sii.cl/');
  const http = new ClienteHttp(jar, { fetch: fetchFalso, temporizador: sinEsperas });
  const crudas: RespuestaCruda[] = [];
  return { http, llamadas, crudas, sumidero: (r: RespuestaCruda) => void crudas.push(r) };
}

const conBody = (body: string): DefRespuesta => ({ headers: JSON_CT, body });
const cuerpoDe = (l: LlamadaFalsa) => JSON.parse(l.body!) as { metaData: Record<string, unknown>; data: Record<string, unknown> };
const sobre = (data: unknown, errors: unknown = null): string => JSON.stringify({ data, metaData: { conversationId: 'tok123', errors, page: null } });

/** Una celda del SII; las que cubre un colspan se agregan solas como `esParteDeSpan`. */
interface CeldaDef {
  readonly v: string | null;
  readonly cs?: number;
  readonly rs?: number;
  readonly rut?: boolean;
}
const celda = (c: CeldaDef | null) => ({
  colspan: c?.cs ?? 1,
  rowspan: c?.rs ?? 1,
  value: c?.v ?? null,
  conBordeSuperior: true,
  esParteDeSpan: false,
  ancho: null,
  largoColumna: null,
  style: null,
  contactoRut: c?.rut ?? false,
});
/**
 * Tabla con la forma del SII: cada fila trae una celda por columna (clave "00", "01", …); las posiciones que cubre un
 * colspan van como `esParteDeSpan` y las que cubre un rowspan, como celdas nulas. `cabeceras` usa null en esas posiciones.
 */
function tablaSii(columnas: number, cabeceras: readonly (readonly (CeldaDef | null)[])[], datos: readonly (readonly (string | CeldaDef)[])[], cantRegistros = datos.length) {
  const clave = (i: number) => String(i).padStart(2, '0');
  const filas: Record<string, unknown> = {};
  const agregar = (celdas: readonly (CeldaDef | null)[], tipoCelda: string) => {
    const fila: Record<string, unknown> = {};
    let cubiertas = 0;
    celdas.forEach((c, i) => {
      if (cubiertas > 0) {
        fila[clave(i)] = { ...celda(null), esParteDeSpan: true };
        cubiertas--;
        return;
      }
      fila[clave(i)] = celda(c);
      cubiertas = (c?.cs ?? 1) - 1;
    });
    filas[clave(Object.keys(filas).length)] = { fila, tipoCelda, ultimaCelda: columnas };
  };
  for (const c of cabeceras) agregar(c, 'cabecera');
  for (const d of datos) agregar(d.map((x) => (typeof x === 'string' ? { v: x } : x)), 'dato');
  return { tabla: filas, cantRegistros, cantidadColumnas: columnas, cantidadFilas: cabeceras.length + datos.length };
}
const detalleSii = (tabla: unknown) => sobre({ listDetalle: { DETALLE: { detalle: tabla } } });

const FILA_1: DjTercero = {
  dj: 1879,
  informanteRut: '33333333-3',
  informanteNombre: 'EMPRESA FICTICIA UNO SPA',
  estado: 'Observada',
  observada: true,
  certificado: '101',
  folio: 1_234_567,
  fechaPresentacion: '2026-02-02',
  meses: [7, 8, 9, 10, 11, 12],
  montos: {
    'Monto Retenido Anual Actualizado (Del 01/01 Al 31/12) / Honorarios Y Otros (Art.42 N° 2) / Tasa 14.5%': 45_000,
    'Monto Retenido Anual Actualizado (Del 01/01 Al 31/12) / Remuneracion de Directores (Art. 48) / Tasa 10%': 0,
    'Monto Retenido Anual Actualizado (Del 01/01 Al 31/12) / Remuneracion de Directores (Art. 48) / Tasa 35%': 0,
    'Monto pagado anual Actualizado por Servicios prestados en Isla de Pascua': 0,
    '3% PRÉSTAMO TASA 0% AÑO 2021': 0,
  },
  retencionHonorarios: 45_000,
};
const FILA_2: DjTercero = {
  ...FILA_1,
  informanteRut: '44444444-4',
  informanteNombre: null,
  estado: 'No Observada',
  observada: false,
  certificado: '7',
  folio: 76_543,
  fechaPresentacion: '2026-02-03',
  meses: [7, 9, 11, 12],
  montos: { ...FILA_1.montos, 'Monto Retenido Anual Actualizado (Del 01/01 Al 31/12) / Honorarios Y Otros (Art.42 N° 2) / Tasa 14.5%': 130_000 },
  retencionHonorarios: 130_000,
};

describe('djInformadas', () => {
  it('pide getAgenteRetenedor del AT con page null y devuelve solo las DJ con datos, con su resumen por cabecera', async () => {
    const { http, llamadas, crudas, sumidero } = await preparar({ [RUTA('getAgenteRetenedor')]: conBody(fixture('dj-agentes.json')) });

    const r = await djInformadas(http, sumidero, PERSONA, 2026);

    expect(r).toEqual([
      {
        dj: 1879,
        titulo: 'Sobre Retenciones Efectuadas Conforme A Los Arts. 42° N° 2 Y 48° De La L.I.R.',
        registros: 2,
        resumen: {
          'Cantidad de Informantes': '2',
          'Monto Retenido Anual Actualizado / Honorarios Y Otros (Art.42 N° 2) / Tasa 14.5%': '175.000',
          'Monto Retenido Anual Actualizado / Remuneración De Directores (Art. 48) / Tasa 10%': '0',
          'Monto Retenido Anual Actualizado / Remuneración De Directores (Art. 48) / Tasa 35%': '0',
          'Monto pagado anual Actualizado por Servicios prestados en Isla de Pascua': '0',
          '3% PRÉSTAMO TASA 0% AÑO 2021': '0',
        },
      },
    ]);
    const llamada = llamadas[0]!;
    expect(llamada.url).toBe(`${BASE}/getAgenteRetenedor`);
    expect(llamada.headers['Referer']).toBe('https://www4.sii.cl/djconsultarentaui/internet/');
    const cuerpo = cuerpoDe(llamada);
    expect(cuerpo.data).toEqual({ periodo: '202600' });
    expect(cuerpo.metaData).toMatchObject({ namespace: `${NAMESPACE}/getAgenteRetenedor`, conversationId: 'tok123', page: null });
    expect(crudas.map((c) => c.superficie)).toEqual(['terceros.resumen']);
    expect(crudas[0]!.cuerpo).not.toContain('TOKENFICTICIO');
  });

  it('sin DJ con datos (o data null) devuelve una lista vacía', async () => {
    const ceros = sobre([{ listAgenteRetenedor: { '1945': { resumen: tablaSii(2, [[{ v: 'Total de Casos Informados' }, { v: 'Total Monto' }]], [['0', '0']], 0) } }, title: 'Ficticia', formKey: 0 }]);
    const a = await preparar({ [RUTA('getAgenteRetenedor')]: conBody(ceros) });
    expect(await djInformadas(a.http, a.sumidero, PERSONA, 2026)).toEqual([]);
    const b = await preparar({ [RUTA('getAgenteRetenedor')]: conBody(sobre(null)) });
    expect(await djInformadas(b.http, b.sumidero, PERSONA, 2026)).toEqual([]);
  });

  it('cantRegistros del resumen manda sobre la columna de cantidad', async () => {
    const tabla = tablaSii(1, [[{ v: 'Renta Total Neta Pagada' }]], [['1.000']], 3);
    const { http, sumidero } = await preparar({ [RUTA('getAgenteRetenedor')]: conBody(sobre([{ listAgenteRetenedor: { '1887': { resumen: tabla } }, title: null, formKey: 0 }])) });
    expect(await djInformadas(http, sumidero, PERSONA, 2026)).toEqual([{ dj: 1887, titulo: null, registros: 3, resumen: { 'Renta Total Neta Pagada': '1.000' } }]);
  });

  it('un error de autorización es SIN_PERMISO; otro error, SII_RECHAZO; una forma distinta, PORTAL_CAMBIO', async () => {
    const autoriza = await preparar({ [RUTA('getAgenteRetenedor')]: conBody(sobre(null, [{ descripcion: 'Usuario no autorizado' }])) });
    expect(await codigoDe(djInformadas(autoriza.http, autoriza.sumidero, PERSONA, 2026))).toBe('SIN_PERMISO');
    const otro = await preparar({ [RUTA('getAgenteRetenedor')]: conBody(sobre(null, [{ descripcion: 'Servicio no disponible' }])) });
    expect(await codigoDe(djInformadas(otro.http, otro.sumidero, PERSONA, 2026))).toBe('SII_RECHAZO');
    for (const data of [{ listAgenteRetenedor: {} }, [{ listAgenteRetenedor: { '1879': { resumen: { tabla: 'x' } } } }], [{ listAgenteRetenedor: { abc: { resumen: tablaSii(1, [[{ v: 'A' }]], [['1']]) } } }]]) {
      const p = await preparar({ [RUTA('getAgenteRetenedor')]: conBody(sobre(data)) });
      expect(await codigoDe(djInformadas(p.http, p.sumidero, PERSONA, 2026))).toBe('PORTAL_CAMBIO');
    }
  });
});

describe('djDetalle', () => {
  it('pide getDjDetalle con el RUT partido y lee cada informante mapeando las columnas por sus cabeceras', async () => {
    const { http, llamadas, crudas, sumidero } = await preparar({ [RUTA('getDjDetalle')]: conBody(fixture('dj-detalle-1879.json')) });

    const r = await djDetalle(http, sumidero, PERSONA, 2026, 1879);

    expect(r).toEqual([FILA_1, FILA_2]);
    expect(llamadas).toHaveLength(1);
    const cuerpo = cuerpoDe(llamadas[0]!);
    expect(cuerpo.data).toEqual({ periodo: '202600', rut: '11111111', dv: '1', dj: 1879, page: 1, key: 0, seccion: '', tipoConsulta: 2 });
    expect(cuerpo.metaData).toMatchObject({ namespace: `${NAMESPACE}/getDjDetalle`, page: null });
    expect(llamadas[0]!.headers['Referer']).toBe('https://www4.sii.cl/djconsultarentaui/internet/');
    expect(crudas.map((c) => c.superficie)).toEqual(['terceros.detalle']);
    expect(crudas[0]!.cuerpo).not.toContain('TOKENFICTICIO');
  });

  it('pide más páginas (sección detalle) hasta completar cantRegistros, sin repetir informantes', async () => {
    const pagina1 = JSON.parse(fixture('dj-detalle-1879.json')) as { data: { listDetalle: { DETALLE: { detalle: { cantRegistros: number; tabla: Record<string, { fila: Record<string, { value: string }> }> } } } } };
    pagina1.data.listDetalle.DETALLE.detalle.cantRegistros = 3;
    const pagina2 = structuredClone(pagina1);
    const tabla2 = pagina2.data.listDetalle.DETALLE.detalle.tabla;
    // La página 2 repite el primer informante y trae uno nuevo.
    tabla2['05']!.fila['02']!.value = '55.555.555';
    tabla2['05']!.fila['04']!.value = '5';
    tabla2['05']!.fila['01']!.value = '999';
    const { http, llamadas, sumidero } = await preparar({ [RUTA('getDjDetalle')]: (_l, n) => conBody(JSON.stringify(n === 1 ? pagina1 : pagina2)) });

    const r = await djDetalle(http, sumidero, PERSONA, 2026, 1879);

    expect(r.map((f) => [f.informanteRut, f.folio])).toEqual([
      ['33333333-3', 1_234_567],
      ['44444444-4', 76_543],
      ['55555555-5', 999],
    ]);
    expect(llamadas.map((l) => cuerpoDe(l).data)).toEqual([
      expect.objectContaining({ page: 1, seccion: '' }),
      expect.objectContaining({ page: 2, seccion: 'detalle', dj: 1879, rut: '11111111', dv: '1', key: 0, tipoConsulta: 2 }),
    ]);
  });

  it('una página que no trae informantes nuevos antes de completar cantRegistros es PORTAL_CAMBIO', async () => {
    const cuerpo = JSON.parse(fixture('dj-detalle-1879.json')) as { data: { listDetalle: { DETALLE: { detalle: { cantRegistros: number } } } } };
    cuerpo.data.listDetalle.DETALLE.detalle.cantRegistros = 5;
    const { http, llamadas, sumidero } = await preparar({ [RUTA('getDjDetalle')]: conBody(JSON.stringify(cuerpo)) });
    expect(await codigoDe(djDetalle(http, sumidero, PERSONA, 2026, 1879))).toBe('PORTAL_CAMBIO');
    expect(llamadas).toHaveLength(2);
  });

  it(`no pide más de ${MAX_PAGINAS_DJ} páginas`, async () => {
    const fila = (n: number) => ['1879', String(n), { v: '33.333.333-3', rut: true }, '0'];
    const cabeceras = [[{ v: 'Tipo de Formulario' }, { v: 'Folio' }, { v: 'Rut Declarante' }, { v: 'Monto Retenido Honorarios' }]];
    const { http, llamadas, sumidero } = await preparar({ [RUTA('getDjDetalle')]: (_l, n) => conBody(detalleSii(tablaSii(4, cabeceras, [fila(n)], 1_000))) });
    expect(await codigoDe(djDetalle(http, sumidero, PERSONA, 2026, 1879))).toBe('PORTAL_CAMBIO');
    expect(llamadas).toHaveLength(MAX_PAGINAS_DJ);
  });

  it('una DJ genérica (como la 1887, forma NO verificada) se lee por cabeceras en cualquier orden y extrae sueldo e impuesto único', async () => {
    const meses = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    const cabeceras = [
      [{ v: 'Montos Anuales Actualizados', cs: 3 }, null, null, { v: 'Rut Empleador', rs: 2, cs: 2 }, null, { v: 'Folio', rs: 2 }, { v: 'Estado', rs: 2 }, { v: 'Fecha presentacion', rs: 2 }, { v: 'Período', cs: 12 }, ...meses.slice(1).map(() => null)],
      [{ v: 'Renta Total Neta Pagada (Art. 42 N° 1)' }, { v: 'Impuesto Único Retenido' }, { v: 'Mayor Retención Solicitada (Art. 88)' }, null, null, null, null, null, ...meses.map((m) => ({ v: m }))],
    ];
    const dato = ['12.000.000', '350.000', '', { v: '33.333.333', rut: true }, '3', '42', 'No Observada', '15/03/2027', ...meses.map((_, i) => (i < 2 ? 'X' : ''))];
    const { http, sumidero } = await preparar({ [RUTA('getDjDetalle')]: conBody(detalleSii(tablaSii(20, cabeceras, [dato]))) });

    const [fila] = await djDetalle(http, sumidero, PERSONA, 2027, 1887);

    expect(fila).toEqual({
      dj: 1887,
      informanteRut: '33333333-3',
      informanteNombre: null,
      estado: 'No Observada',
      observada: false,
      certificado: null,
      folio: 42,
      fechaPresentacion: '2027-03-15',
      meses: [1, 2],
      montos: {
        'Montos Anuales Actualizados / Renta Total Neta Pagada (Art. 42 N° 1)': 12_000_000,
        'Montos Anuales Actualizados / Impuesto Único Retenido': 350_000,
        'Montos Anuales Actualizados / Mayor Retención Solicitada (Art. 88)': null,
      },
      rentaSueldo: 12_000_000,
      impuestoUnicoRetenido: 350_000,
    });
  });

  it('una DJ con el detalle en varias secciones (como la 1945) lee todas, toma al declarante y no trata RUT ni códigos como montos', async () => {
    // Forma de la 1945 vista en vivo: secciones «DETALLE B», «DETALLE C»… con claves detalle1, detalle2…; cantRegistros como texto.
    const cabB = [
      [{ v: 'B: EGRESOS FICTICIOS', cs: 15 }, ...Array.from({ length: 14 }, () => null)],
      [
        { v: 'Tipo de Ingreso o Egreso' }, { v: 'Destino del Egreso' }, { v: 'RUT Beneficiario Final', cs: 3 }, null, null, { v: 'Nombre o Razón Social Beneficiario Final' },
        { v: 'Tipo de Relación' }, { v: 'Monto' }, { v: 'Estado' }, { v: 'Tipo de Formulario' }, { v: 'Folio' }, { v: 'Rut Declarante', cs: 3 }, null, null, { v: 'Nombre o Razón Social Declarante' },
      ],
    ];
    const datoB = ['201', '1', '11.111.111', '-', '1', 'PERSONA FICTICIA', '4', '1.000.000', 'No Observada', '1945', '123456', { v: '55.555.555', rut: true }, '-', '5', 'FUNDACION FICTICIA'];
    const seccionB = { ...tablaSii(15, cabB, [datoB]), cantRegistros: '1' };
    const seccionC = { ...tablaSii(3, [[{ v: 'Tipo de Exención' }, { v: 'Estado' }, { v: 'Folio' }]], []), cantRegistros: '0' };
    const cuerpo = sobre({ listDetalle: { 'DETALLE B': { detalle1: seccionB }, 'DETALLE C': { detalle2: seccionC } } });
    const { http, sumidero, llamadas } = await preparar({ [RUTA('getDjDetalle')]: conBody(cuerpo) });

    const filas = await djDetalle(http, sumidero, PERSONA, 2026, 1945);

    expect(llamadas).toHaveLength(1);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ dj: 1945, informanteRut: '55555555-5', informanteNombre: 'FUNDACION FICTICIA', folio: 123456, observada: false });
    expect(filas[0]!.montos).toEqual({ Monto: 1_000_000 });
  });

  it('una columna «Monto Bruto» sigue siendo monto aunque contenga «rut»', async () => {
    const tabla = tablaSii(4, [[{ v: 'Rut Declarante', cs: 2 }, null, { v: 'Folio' }, { v: 'Monto Bruto' }]], [[{ v: '33.333.333', rut: true }, '3', '7', '500.000']]);
    const { http, sumidero } = await preparar({ [RUTA('getDjDetalle')]: conBody(detalleSii(tabla)) });
    const [fila] = await djDetalle(http, sumidero, PERSONA, 2026, 1879);
    expect(fila!.montos).toEqual({ 'Monto Bruto': 500_000 });
  });

  it('sin detalle (data null o sin DETALLE) devuelve una lista vacía', async () => {
    for (const data of [null, { listDetalle: null }, { listDetalle: {} }]) {
      const { http, sumidero } = await preparar({ [RUTA('getDjDetalle')]: conBody(sobre(data)) });
      expect(await djDetalle(http, sumidero, PERSONA, 2026, 1879)).toEqual([]);
    }
  });

  it('una tabla sin RUT del informante, sin folio válido o sin cabeceras es PORTAL_CAMBIO', async () => {
    const sinRut = tablaSii(2, [[{ v: 'Folio' }, { v: 'Monto' }]], [['1', '2']]);
    const sinFolio = tablaSii(2, [[{ v: 'Rut Declarante' }, { v: 'Folio' }]], [[{ v: '33.333.333-3', rut: true }, 'abc']]);
    const rutMalo = tablaSii(2, [[{ v: 'Rut Declarante' }, { v: 'Folio' }]], [[{ v: '33.333.333-9', rut: true }, '1']]);
    const sinCabeceras = tablaSii(2, [], [['1', '2']]);
    for (const tabla of [sinRut, sinFolio, rutMalo, sinCabeceras, { tabla: [] }, { tabla: { '00': { fila: 'x', tipoCelda: 'dato' } } }]) {
      const { http, sumidero } = await preparar({ [RUTA('getDjDetalle')]: conBody(detalleSii(tabla)) });
      expect(await codigoDe(djDetalle(http, sumidero, PERSONA, 2026, 1879))).toBe('PORTAL_CAMBIO');
    }
  });
});
