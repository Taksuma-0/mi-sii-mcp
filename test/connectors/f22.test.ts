import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { f22Declaraciones, f22Detalle, sanearCompactoF22, sanearDeclaracionesF22, sanearEventosF22, sanearObservacionesF22 } from '../../src/connectors/sii/f22.js';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { parseRut } from '../../src/domain/rut.js';
import type { RespuestaCruda } from '../../src/domain/tipos.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, JSON_CT, sinEsperas, type RutaFalsa } from '../helpers/http-falso.js';

const fixture = (nombre: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', nombre), 'utf8');
const BASE = 'https://www4.sii.cl/consultaestadof22ui/services/data/facadeService';
const NAMESPACE = 'cl.sii.sdi.lob.renta.consultaestadof22.data.api.interfaces.FacadeService';
const RUTA = (op: string) => `POST ${BASE}/${op}`;
const EMPRESA = parseRut('22222222-2');
const FOLIO = 123_456_789;

/** Textos personales o bancarios de los fixtures: nunca deben llegar a la evidencia ni al resultado. */
const PERSONALES = ['PERSONA FICTICIA', 'APELLIDOFICTICIO', 'OTROAPELLIDO', 'CALLE FICTICIA', 'COMUNA FICTICIA', '000111222333', 'BANCO FICTICIO', 'CTA-FICTICIA', 'GIRO FICTICIO', 'REGION FICTICIA', 'persona@example.invalid', '912345678', 'ALIAS FICTICIO', '33333333', '33.333.333', 'sitio-ajeno', 'ID-CARTA-FICTICIO', 'UNIDAD FICTICIA', 'Referencia ficticia', 'CUENTA CORRIENTE', 'OTRO DATO FICTICIO'];

async function preparar(rutas: Record<string, RutaFalsa>) {
  const { fetchFalso, llamadas } = crearFetchFalso(rutas);
  const jar = new CookieJar();
  await jar.setCookie('TOKEN=tok123; Domain=.sii.cl; Path=/', 'https://www4.sii.cl/');
  const http = new ClienteHttp(jar, { fetch: fetchFalso, temporizador: sinEsperas });
  const crudas: RespuestaCruda[] = [];
  return { http, llamadas, crudas, sumidero: (r: RespuestaCruda) => void crudas.push(r) };
}

const conBody = (body: string): RutaFalsa => ({ headers: JSON_CT, body });
/** Un sobre sin errores con `data` propio. */
const sobre = (data: unknown): string => JSON.stringify({ data, respCod: 0, errorMsg: null, metaData: { errors: null } });

const DETALLE_OK = {
  [RUTA('f22Compacto')]: conBody(fixture('f22-compacto.json')),
  [RUTA('situacionObservacion')]: conBody(fixture('f22-observaciones.json')),
  [RUTA('buscaEventos')]: conBody(fixture('f22-eventos.json')),
};

describe('f22Declaraciones', () => {
  it('pide buscaDeclVgte del año tributario sin page y devuelve solo los campos permitidos', async () => {
    const { http, llamadas, sumidero } = await preparar({ [RUTA('buscaDeclVgte')]: conBody(fixture('f22-declaraciones.json')) });

    const r = await f22Declaraciones(http, sumidero, EMPRESA, 2026);

    expect(r).toEqual([
      {
        rut: '22222222-2',
        anioTributario: 2026,
        folio: 123_456_789,
        vigente: true,
        codigoConclusion: '07',
        conclusion: 'Conclusión ficticia: declaración sin observaciones',
        fechaIngreso: '2026-04-15',
        tipoImpugnado: null,
        remanenteSolicitado: 0,
        remanenteDevuelto: 0,
        impuestoPagado: 1_234_567,
        montoGiro: 0,
        fechaVencimiento: '2026-04-30',
      },
      {
        rut: '22222222-2',
        anioTributario: 2026,
        folio: 98_765_432,
        vigente: false,
        codigoConclusion: '11',
        conclusion: 'Conclusión ficticia: declaración rectificada',
        fechaIngreso: '2026-04-02',
        tipoImpugnado: 'R',
        remanenteSolicitado: 50_000,
        remanenteDevuelto: null,
        impuestoPagado: -1000,
        montoGiro: null,
        fechaVencimiento: null,
      },
    ]);
    const llamada = llamadas[0]!;
    expect(llamada.url).toBe(`${BASE}/buscaDeclVgte`);
    expect(llamada.headers['Referer']).toBe('https://www4.sii.cl/consultaestadof22ui/');
    const cuerpo = JSON.parse(llamada.body!) as { metaData: Record<string, unknown>; data: Record<string, unknown> };
    expect(cuerpo.data).toEqual({ periodo: '2026', rut: '22222222', dv: '2' });
    expect(cuerpo.metaData['namespace']).toBe(`${NAMESPACE}/buscaDeclVgte`);
    expect('page' in cuerpo.metaData).toBe(false);
  });

  it('lee vgte como S/N, 1/0 y booleano; otro valor es null', async () => {
    const decl = (vgte: unknown, folio: number) => ({ folio, vgte });
    const { http, sumidero } = await preparar({
      [RUTA('buscaDeclVgte')]: conBody(sobre({ decls: [decl('S', 1), decl('N', 2), decl('1', 3), decl('0', 4), decl(1, 5), decl(0, 6), decl(true, 7), decl('X', 8), decl(null, 9), decl(' s ', 10)], glosas: [] })),
    });

    const r = await f22Declaraciones(http, sumidero, EMPRESA, 2026);

    expect(r.map((d) => d.vigente)).toEqual([true, false, true, false, true, false, true, null, null, true]);
  });

  it('nunca entrega ni guarda como evidencia nombres, domicilio, cuenta, banco, giro ni RUT de terceros', async () => {
    const { http, sumidero, crudas } = await preparar({ [RUTA('buscaDeclVgte')]: conBody(fixture('f22-declaraciones.json')) });

    const r = await f22Declaraciones(http, sumidero, EMPRESA, 2026);

    expect(crudas).toHaveLength(1);
    expect(crudas[0]!.superficie).toBe('f22');
    const evidencia = crudas[0]!.cuerpo;
    for (const texto of [...PERSONALES, 'nombres', 'apellido', 'calle', 'comuna', 'cuenta', 'banco', 'ctabco', '"cta"', 'giro', 'rutTercero']) {
      expect(evidencia, texto).not.toContain(texto);
      expect(JSON.stringify(r), texto).not.toContain(texto);
    }
    const saneado = JSON.parse(evidencia) as { data: { decls: Record<string, unknown>[]; glosas: unknown[] } };
    expect(Object.keys(saneado.data.decls[0]!).sort()).toEqual(
      ['codConc', 'dcrtCodigoAnulado', 'dcrtCodigoRectificado', 'fecIng', 'fechaVencimiento', 'folio', 'impuestoPagado', 'montoGiro', 'rectificacble', 'remanenteDevuelto', 'remanenteSolicitado', 'tipoImpugnado', 'tipoIng', 'vgte'].sort(),
    );
    expect(saneado.data.glosas).toHaveLength(2);
  });

  it('un año sin declaraciones (decls nulo o vacío, data nula) devuelve una lista vacía', async () => {
    for (const data of [{ decls: [], glosas: [] }, { decls: null, glosas: null }, null]) {
      const { http, sumidero } = await preparar({ [RUTA('buscaDeclVgte')]: conBody(sobre(data)) });
      expect(await f22Declaraciones(http, sumidero, EMPRESA, 2026), JSON.stringify(data)).toEqual([]);
    }
  });

  it('errorMsg de autorización es SIN_PERMISO; metaData.errors es SII_RECHAZO, aunque falte data', async () => {
    const a = await preparar({ [RUTA('buscaDeclVgte')]: conBody(fixture('f22-error.json')) });
    expect(await codigoDe(f22Declaraciones(a.http, a.sumidero, EMPRESA, 2026))).toBe('SIN_PERMISO');
    const b = await preparar({ [RUTA('buscaDeclVgte')]: conBody(JSON.stringify({ metaData: { errors: [{ descripcion: 'Error ficticio del servicio' }] } })) });
    expect(await codigoDe(f22Declaraciones(b.http, b.sumidero, EMPRESA, 2026))).toBe('SII_RECHAZO');
  });

  it('una respuesta con otra forma es PORTAL_CAMBIO', async () => {
    for (const body of [sobre({ decls: 'x' }), sobre({ decls: [{ vgte: 'S' }] }), sobre({ decls: [{ folio: 'abc' }] }), sobre({ decls: [null] }), sobre('texto'), JSON.stringify([1, 2])]) {
      const { http, sumidero } = await preparar({ [RUTA('buscaDeclVgte')]: conBody(body) });
      expect(await codigoDe(f22Declaraciones(http, sumidero, EMPRESA, 2026)), body).toBe('PORTAL_CAMBIO');
    }
  });

  it('un folio repetido queda una sola vez', async () => {
    const { http, sumidero } = await preparar({ [RUTA('buscaDeclVgte')]: conBody(sobre({ decls: [{ folio: '5', vgte: 'S' }, { folio: 5, vgte: 'N' }] })) });
    expect((await f22Declaraciones(http, sumidero, EMPRESA, 2026)).map((d) => [d.folio, d.vigente])).toEqual([[5, true]]);
  });
});

describe('f22Detalle', () => {
  it('pide el compacto, las observaciones y los eventos del folio con los tipos que espera cada operación', async () => {
    const { http, llamadas, sumidero } = await preparar(DETALLE_OK);

    await f22Detalle(http, sumidero, EMPRESA, 2026, FOLIO);

    expect(llamadas.map((l) => l.url)).toEqual([`${BASE}/f22Compacto`, `${BASE}/situacionObservacion`, `${BASE}/buscaEventos`]);
    const datos = llamadas.map((l) => JSON.parse(l.body!) as { metaData: Record<string, unknown>; data: unknown });
    expect(datos[0]!.data).toEqual({ rut: '22222222', dv: '2', periodo: '2026', folio: '123456789' });
    expect(datos[1]!.data).toEqual({ rut: '22222222', dv: '2', periodo: 2026, folio: 123_456_789 });
    expect(datos[2]!.data).toEqual({ rut: '22222222', dv: '2', periodo: '2026', folio: '123456789' });
    expect(datos.map((d) => d.metaData['namespace'])).toEqual([`${NAMESPACE}/f22Compacto`, `${NAMESPACE}/situacionObservacion`, `${NAMESPACE}/buscaEventos`]);
    expect(datos.every((d) => !('page' in d.metaData))).toBe(true);
  });

  it('excluye los códigos de identificación y las glosas personales, convierte los números chilenos y deja null fechas y vacíos', async () => {
    const { http, sumidero } = await preparar(DETALLE_OK);

    const r = await f22Detalle(http, sumidero, EMPRESA, 2026, FOLIO);

    expect(r.valores).toEqual([
      { codigo: '15', valor: null, glosa: 'Fecha de presentación ficticia' },
      { codigo: '315', valor: null, glosa: 'Fecha de vencimiento ficticia' },
      { codigo: '170', valor: 12_345_678, glosa: 'Base imponible ficticia' },
      { codigo: '305', valor: -250_000, glosa: 'Resultado liquidación anual ficticio' },
      { codigo: '85', valor: 250_000, glosa: 'Saldo a favor ficticio' },
      { codigo: '87', valor: 250_000, glosa: 'Monto devolución solicitada ficticia' },
      { codigo: '39', valor: 1234.5, glosa: 'Monto con decimales ficticio' },
      { codigo: '90', valor: null, glosa: 'Saldo a pagar ficticio' },
      { codigo: '92', valor: null, glosa: 'Reajuste ficticio' },
      { codigo: '93', valor: null, glosa: 'Intereses ficticios' },
      { codigo: '94', valor: null, glosa: 'Total a pagar ficticio' },
      { codigo: '36', valor: 12, glosa: 'Monto numérico ficticio' },
    ]);
  });

  it('guarda de las observaciones el código y la descripción, y el enlace solo si es de sii.cl', async () => {
    const { http, sumidero } = await preparar(DETALLE_OK);

    const r = await f22Detalle(http, sumidero, EMPRESA, 2026, FOLIO);

    expect(r.observaciones).toEqual([
      { codigo: 'A01', descripcion: 'Observación ficticia de renta', url: 'https://www.sii.cl/ayudas/observacion-ficticia.html' },
      { codigo: 'B02', descripcion: 'Otra observación ficticia', url: null },
      { codigo: 'C03', descripcion: 'Observación ficticia sin enlace', url: null },
    ]);
  });

  it('lee los eventos en orden con su fecha ISO, sin referencia, carta interna ni unidad del SII', async () => {
    const { http, sumidero } = await preparar(DETALLE_OK);

    const r = await f22Detalle(http, sumidero, EMPRESA, 2026, FOLIO);

    expect(r.eventos).toEqual([
      { orden: 1, codigoEvento: 'E01', nombre: 'Declaración recibida', fecha: '2026-04-15', tipo: 'INFO', codigoCarta: null },
      { orden: 2, codigoEvento: 'E02', nombre: 'Devolución autorizada', fecha: '2026-05-10', tipo: 'PAGO', codigoCarta: 'C9' },
    ]);
  });

  it('la evidencia de las tres operaciones queda saneada con las mismas listas permitidas', async () => {
    const { http, sumidero, crudas } = await preparar(DETALLE_OK);

    const r = await f22Detalle(http, sumidero, EMPRESA, 2026, FOLIO);

    expect(crudas.map((c) => c.superficie)).toEqual(['f22.compacto', 'f22.observaciones', 'f22.eventos']);
    for (const c of crudas) {
      for (const texto of [...PERSONALES, 'referencia', 'idCarta', 'unidadSii', 'fechaCitacion']) {
        expect(c.cuerpo, `${c.superficie}: ${texto}`).not.toContain(texto);
      }
    }
    for (const texto of PERSONALES) expect(JSON.stringify(r), texto).not.toContain(texto);
    const compacto = JSON.parse(crudas[0]!.cuerpo) as { data: { codigo: string; valor: unknown }[] };
    expect(compacto.data.map((f) => f.codigo)).toEqual(['15', '315', '170', '305', '85', '87', '39', '90', '92', '93', '94', '36']);
    expect(compacto.data.every((f) => f.valor === null || typeof f.valor === 'number')).toBe(true);
    expect(crudas[0]!.cuerpo).not.toContain('/2026');
  });

  it('normaliza los códigos sin ceros a la izquierda, descarta los no numéricos y deja el primero de un código repetido', async () => {
    const compacto = sobre([
      { codigo: '0305', valor: '1.000', glosa: 'Uno' },
      { codigo: '305', valor: '2.000', glosa: 'Repetido' },
      { codigo: 'XX', valor: '5', glosa: 'Sin código numérico' },
      { codigo: '013', valor: 'GIRO FICTICIO', glosa: 'Con cero a la izquierda' },
      null,
    ]);
    const { http, sumidero } = await preparar({ ...DETALLE_OK, [RUTA('f22Compacto')]: conBody(compacto) });

    const r = await f22Detalle(http, sumidero, EMPRESA, 2026, FOLIO);

    expect(r.valores).toEqual([{ codigo: '305', valor: 1000, glosa: 'Uno' }]);
  });

  it('una observación con código repetido queda una sola vez (la primera), también en la evidencia', async () => {
    const observaciones = sobre([
      { codigo: 'A01', descripcion: 'Primera ficticia', url: null },
      { codigo: 'A01', descripcion: 'Repetida ficticia', url: null },
      { codigo: ' A01 ', descripcion: 'Repetida con espacios', url: null },
      { codigo: 'B02', descripcion: 'Otra ficticia', url: null },
    ]);
    const { http, sumidero, crudas } = await preparar({ ...DETALLE_OK, [RUTA('situacionObservacion')]: conBody(observaciones) });

    const r = await f22Detalle(http, sumidero, EMPRESA, 2026, FOLIO);

    expect(r.observaciones).toEqual([
      { codigo: 'A01', descripcion: 'Primera ficticia', url: null },
      { codigo: 'B02', descripcion: 'Otra ficticia', url: null },
    ]);
    const evidencia = JSON.parse(crudas.find((c) => c.superficie === 'f22.observaciones')!.cuerpo) as { data: { codigo: string }[] };
    expect(evidencia.data.map((o) => o.codigo)).toEqual(['A01', 'B02']);
  });

  it('con los códigos de un F22 real (valores ficticios) excluye solo los de identificación y conserva las filas tributarias', async () => {
    // Glosas ficticias; las de identificación imitan las reales (306 llega con un número de cuenta numérico).
    const filas: [string, string, string][] = [
      ['1', 'APELLIDOFICTICIO PERSONA FICTICIA', 'Apellido paterno, materno y nombres'],
      ['3', '22222222', 'Rol Único Tributario'],
      ['6', 'COMUNA FICTICIA', 'Comuna'],
      ['7', '123456789', 'Folio'],
      ['8', 'CALLE FICTICIA 123', 'Domicilio'],
      ['13', 'GIRO FICTICIO', 'Actividad económica'],
      ['14', '1', 'Dato ficticio 14'],
      ['15', '15/04/2026', 'Fecha de presentación'],
      ['53', '100', 'Monto ficticio 53'],
      ['55', 'persona@example.invalid', 'Correo electrónico'],
      ['91', '0', 'Total a pagar dentro del plazo'],
      ['301', 'BANCO FICTICIO', 'Banco'],
      ['305', '-250.000', 'Resultado liquidación anual'],
      ['306', '000111222333', 'Numero de Cuenta'],
      ['315', '30/04/2026', 'Fecha de vencimiento'],
      ['645', '1.000', 'Monto ficticio 645'],
      ['646', '2.000', 'Monto ficticio 646'],
      ['780', 'CORRIENTE', 'Tipo de cuenta'],
      ['903', '1', 'Moneda'],
      ['1582', '3.000', 'Monto ficticio 1582'],
      ['1583', '4.000', 'Monto ficticio 1583'],
      ['1585', '5.000', 'Monto ficticio 1585'],
      ['1600', '6.000', 'Monto ficticio 1600'],
      ['1610', '7.000', 'Monto ficticio 1610'],
      ['1614', '8.000', 'Monto ficticio 1614'],
      ['1616', '9.000', 'Honorarios ficticios pagados'],
      ['1617', '10.000', 'Gastos ficticios rechazados'],
      ['1625', '11.000', 'Honorarios y gastos ficticios'],
      ['1629', '12.000', 'Monto ficticio 1629'],
      ['1630', '13.000', 'Pagos provisionales a cuenta del impuesto ficticio'],
      ['1713', '14.000', 'Monto ficticio 1713'],
      ['8811', '33333333', 'RUT del representante'],
      ['39', '15.000', 'Monto ficticio 39'],
      ['85', '250.000', 'Saldo a favor'],
      ['86', '', 'Monto ficticio 86'],
      ['87', '250.000', 'Monto devolución solicitada'],
      ['90', '', 'Saldo a pagar'],
      ['92', '', 'Reajuste'],
      ['93', '', 'Intereses y multas'],
      ['94', '', 'Total a pagar con recargo'],
    ];
    const compacto = sobre(filas.map(([codigo, valor, glosa]) => ({ codigo, valor, glosa })));
    const { http, sumidero, crudas } = await preparar({ ...DETALLE_OK, [RUTA('f22Compacto')]: conBody(compacto) });

    const r = await f22Detalle(http, sumidero, EMPRESA, 2026, FOLIO);

    const excluidos = ['1', '3', '6', '8', '13', '55', '301', '306', '780', '903', '8811'];
    const esperados = filas.map(([codigo]) => codigo).filter((c) => !excluidos.includes(c));
    expect(r.valores.map((v) => v.codigo)).toEqual(esperados);
    expect(r.valores.find((v) => v.codigo === '1630')).toEqual({ codigo: '1630', valor: 13_000, glosa: 'Pagos provisionales a cuenta del impuesto ficticio' });
    expect(r.valores.find((v) => v.codigo === '7')?.valor).toBe(123_456_789);
    for (const texto of ['000111222333', 'Numero de Cuenta', 'Rol Único', 'RUT del representante', '33333333', 'BANCO FICTICIO', 'COMUNA FICTICIA']) {
      expect(JSON.stringify(r), texto).not.toContain(texto);
      expect(crudas[0]!.cuerpo, texto).not.toContain(texto);
    }
  });

  it('excluye el 306 por su código aunque la glosa no lo delate, y glosas personales ampliadas', async () => {
    const compacto = sobre([
      { codigo: '306', valor: '000111222333', glosa: 'Dato ficticio' },
      { codigo: '701', valor: '1', glosa: 'Cta. ficticia' },
      { codigo: '702', valor: '1', glosa: 'E-mail de contacto' },
      { codigo: '703', valor: '1', glosa: 'Email ficticio' },
      { codigo: '704', valor: '1', glosa: 'Dirección ficticia' },
      { codigo: '705', valor: '1', glosa: 'Celular ficticio' },
      { codigo: '706', valor: '1', glosa: 'Fono ficticio' },
      { codigo: '707', valor: '1', glosa: 'Rut representante legal' },
      { codigo: '708', valor: '1', glosa: 'Rol único tributario del cónyuge' },
      { codigo: '709', valor: '1', glosa: 'Número de cuenta para depósito' },
      { codigo: '710', valor: '5', glosa: 'Crédito ficticio imputable a cuenta del impuesto' },
    ]);
    const { http, sumidero } = await preparar({ ...DETALLE_OK, [RUTA('f22Compacto')]: conBody(compacto) });

    const r = await f22Detalle(http, sumidero, EMPRESA, 2026, FOLIO);

    expect(r.valores.map((v) => v.codigo)).toEqual(['710']);
  });

  it('reconoce otras formas de «número de cuenta» sin perder las filas «a cuenta del impuesto»', async () => {
    const compacto = sobre([
      { codigo: '711', valor: '1', glosa: 'N° de cuenta ficticia' },
      { codigo: '712', valor: '1', glosa: 'Nº cuenta ficticia' },
      { codigo: '713', valor: '1', glosa: 'Nro. de cuenta ficticia' },
      { codigo: '714', valor: '1', glosa: 'Nro cuenta ficticia' },
      { codigo: '715', valor: '1', glosa: 'Número cuenta ficticia' },
      { codigo: '716', valor: '1', glosa: 'Cuenta N° ficticia' },
      { codigo: '717', valor: '1', glosa: 'Cuenta Nº ficticia' },
      { codigo: '718', valor: '5', glosa: 'Pagos provisionales a cuenta del impuesto' },
      { codigo: '719', valor: '6', glosa: 'Crédito a cuenta de impuestos ficticio' },
    ]);
    const { http, sumidero, crudas } = await preparar({ ...DETALLE_OK, [RUTA('f22Compacto')]: conBody(compacto) });

    const r = await f22Detalle(http, sumidero, EMPRESA, 2026, FOLIO);

    expect(r.valores.map((v) => v.codigo)).toEqual(['718', '719']);
    expect(crudas[0]!.cuerpo).not.toContain('ficticia');
  });

  it('listas nulas son vacías; un error en cualquier operación falla el detalle', async () => {
    const vacio = await preparar({ [RUTA('f22Compacto')]: conBody(sobre(null)), [RUTA('situacionObservacion')]: conBody(sobre([])), [RUTA('buscaEventos')]: conBody(sobre(null)) });
    expect(await f22Detalle(vacio.http, vacio.sumidero, EMPRESA, 2026, FOLIO)).toEqual({ valores: [], observaciones: [], eventos: [] });

    const conError = await preparar({ ...DETALLE_OK, [RUTA('buscaEventos')]: conBody(JSON.stringify({ data: null, respCod: 1, errorMsg: 'Servicio ficticio no disponible', metaData: { errors: null } })) });
    expect(await codigoDe(f22Detalle(conError.http, conError.sumidero, EMPRESA, 2026, FOLIO))).toBe('SII_RECHAZO');

    const otraForma = await preparar({ ...DETALLE_OK, [RUTA('situacionObservacion')]: conBody(sobre({ lista: [] })) });
    expect(await codigoDe(f22Detalle(otraForma.http, otraForma.sumidero, EMPRESA, 2026, FOLIO))).toBe('PORTAL_CAMBIO');
  });
});

describe('saneo de la evidencia del F22', () => {
  it('nunca lanza, aunque el cuerpo tenga otra forma', () => {
    for (const cuerpo of [null, 'texto', 5, [], { data: 'x' }, { data: [null, 'x', 3] }, { data: { decls: 'x', glosas: 5 } }, { metaData: 'x', errorMsg: { a: 1 } }]) {
      expect(() => sanearDeclaracionesF22(cuerpo)).not.toThrow();
      expect(() => sanearCompactoF22(cuerpo)).not.toThrow();
      expect(() => sanearObservacionesF22(cuerpo)).not.toThrow();
      expect(() => sanearEventosF22(cuerpo)).not.toThrow();
    }
  });

  it('guarda los errores del SII como texto', () => {
    const saneado = sanearCompactoF22({ data: null, respCod: 1, errorMsg: 'Error ficticio', metaData: { errors: [{ descripcion: 'Detalle ficticio', otro: 'PERSONA FICTICIA' }] } });
    expect(saneado).toEqual({ data: null, respCod: 1, errorMsg: 'Error ficticio', metaData: { errors: 'Detalle ficticio' } });
  });
});
