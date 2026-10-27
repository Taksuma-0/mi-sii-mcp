import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { entero, esObjeto, numero, primero, texto } from '../../src/connectors/sii/campos.js';
import { rcvDetalle, rcvResumen } from '../../src/connectors/sii/rcv.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { parseRut } from '../../src/domain/rut.js';
import type { RespuestaCruda } from '../../src/domain/tipos.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, HTML, JSON_CT, sinEsperas, type RutaFalsa } from '../helpers/http-falso.js';
import { PAGINA_STUB } from '../helpers/sii-login.js';

const fixture = (nombre: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', nombre), 'utf8');
const RUTA_RESUMEN = 'POST https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getResumen';
const RUTA_DETALLE_COMPRA = 'POST https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getDetalleCompra';
const EMPRESA = parseRut('22222222-2');
const SEPT = parsePeriodo('2026-09');

async function preparar(rutas: Record<string, RutaFalsa>) {
  const { fetchFalso, llamadas } = crearFetchFalso(rutas);
  const jar = new CookieJar();
  await jar.setCookie('TOKEN=tok123; Domain=.sii.cl; Path=/', 'https://www4.sii.cl/');
  const http = new ClienteHttp(jar, { fetch: fetchFalso, temporizador: sinEsperas });
  const crudas: RespuestaCruda[] = [];
  return { http, llamadas, crudas, sumidero: (r: RespuestaCruda) => void crudas.push(r) };
}

describe('rcvResumen', () => {
  it('pide el resumen con estado y período del SII y normaliza las filas', async () => {
    const { http, llamadas, crudas, sumidero } = await preparar({ [RUTA_RESUMEN]: { headers: JSON_CT, body: fixture('rcv-resumen-compra-registro.json') } });
    const r = await rcvResumen(http, sumidero, EMPRESA, SEPT, 'COMPRA', 'REGISTRO');
    expect(r).toEqual({
      rut: '22222222-2',
      periodo: '2026-09',
      lado: 'COMPRA',
      estado: 'REGISTRO',
      filas: [
        { tipoDoc: 33, descripcion: 'Factura Electrónica', cantidad: 2, exento: 0, neto: 200_000, iva: 38_000, total: 238_000 },
        { tipoDoc: 61, descripcion: 'Nota de Crédito Electrónica', cantidad: 1, exento: 0, neto: 10_000, iva: 1_900, total: 11_900 },
      ],
    });
    const cuerpo = JSON.parse(llamadas[0]!.body!) as { metaData: Record<string, unknown>; data: Record<string, unknown> };
    expect(cuerpo.data).toMatchObject({ rutEmisor: '22222222', dvEmisor: '2', ptributario: '202609', estadoContab: 'REGISTRO', operacion: 'COMPRA' });
    expect(cuerpo.metaData['conversationId']).toBe('tok123');
    expect(cuerpo.metaData['namespace']).toBe('cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getResumen');
    expect(crudas[0]?.superficie).toBe('rcv.resumen.COMPRA.REGISTRO');
  });

  it('un mes sin movimiento (código 3, data null) es un resumen vacío', async () => {
    const { http, sumidero } = await preparar({ [RUTA_RESUMEN]: { headers: JSON_CT, body: fixture('rcv-resumen-sin-movimiento.json') } });
    expect((await rcvResumen(http, sumidero, EMPRESA, SEPT, 'VENTA', 'REGISTRO')).filas).toEqual([]);
  });

  it('marca "sin movimientos" solo cuando el SII responde código 3 sin filas', async () => {
    const { http, sumidero } = await preparar({ [RUTA_RESUMEN]: { headers: JSON_CT, body: fixture('rcv-resumen-sin-movimiento.json') } });
    expect((await rcvResumen(http, sumidero, EMPRESA, SEPT, 'VENTA', 'REGISTRO')).sinMovimientos).toBe(true);
  });

  it.each([
    ['código 0 sin filas', { data: [], respEstado: { codRespuesta: 0 } }],
    ['sin código y sin filas', { data: null }],
    ['código "3" con filas', { data: [{ rsmnTipoDocInteger: 33, rsmnTotDoc: 1 }], respEstado: { codRespuesta: '3' } }],
  ])('no marca "sin movimientos" con %s', async (_caso, respuesta) => {
    const { http, sumidero } = await preparar({ [RUTA_RESUMEN]: { headers: JSON_CT, body: JSON.stringify(respuesta) } });
    expect(await rcvResumen(http, sumidero, EMPRESA, SEPT, 'VENTA', 'REGISTRO')).not.toHaveProperty('sinMovimientos');
  });

  it('un rechazo por autorización es SIN_PERMISO', async () => {
    const { http, sumidero } = await preparar({ [RUTA_RESUMEN]: { headers: JSON_CT, body: fixture('rcv-rechazo.json') } });
    expect(await codigoDe(rcvResumen(http, sumidero, EMPRESA, SEPT, 'COMPRA', 'REGISTRO'))).toBe('SIN_PERMISO');
  });

  it('una respuesta que no es JSON es PORTAL_CAMBIO', async () => {
    const { http, sumidero } = await preparar({ [RUTA_RESUMEN]: { headers: HTML, body: '<html>Error interno</html>' } });
    expect(await codigoDe(rcvResumen(http, sumidero, EMPRESA, SEPT, 'COMPRA', 'REGISTRO'))).toBe('PORTAL_CAMBIO');
  });

  it('el muro de login es SESION_REQUERIDA', async () => {
    const { http, sumidero } = await preparar({ [RUTA_RESUMEN]: { headers: HTML, body: PAGINA_STUB } });
    expect(await codigoDe(rcvResumen(http, sumidero, EMPRESA, SEPT, 'COMPRA', 'REGISTRO'))).toBe('SESION_REQUERIDA');
  });

  it.each([{}, { respuestaNueva: [], versionPortal: 2 }])('un objeto JSON sin campos del sobre es PORTAL_CAMBIO: %j', async (respuesta) => {
    const { http, crudas, sumidero } = await preparar({ [RUTA_RESUMEN]: { headers: JSON_CT, body: JSON.stringify(respuesta) } });
    expect(await codigoDe(rcvResumen(http, sumidero, EMPRESA, SEPT, 'COMPRA', 'REGISTRO'))).toBe('PORTAL_CAMBIO');
    expect(crudas[0]?.cuerpo).toBe(JSON.stringify(respuesta));
  });

  it('acepta datos como alias y campos adicionales en sobre, estado y filas', async () => {
    const respuesta = {
      datos: [{ codTipoDoc: '33', descTipoDoc: 'Factura demo', totDoctos: '1', mntExento: '0', mntNeto: '100', mntIVA: '19', mntTotal: '119', campoNuevo: true }],
      respEstado: { codRespuesta: '0', campoNuevo: true },
      campoNuevo: true,
    };
    const { http, sumidero } = await preparar({ [RUTA_RESUMEN]: { headers: JSON_CT, body: JSON.stringify(respuesta) } });
    expect((await rcvResumen(http, sumidero, EMPRESA, SEPT, 'COMPRA', 'REGISTRO')).filas).toEqual([
      { tipoDoc: 33, descripcion: 'Factura demo', cantidad: 1, exento: 0, neto: 100, iva: 19, total: 119 },
    ]);
  });

  it('un rechazo sin mensaje de autorización es SII_RECHAZO', async () => {
    const { http, sumidero } = await preparar({ [RUTA_RESUMEN]: { headers: JSON_CT, body: JSON.stringify({ data: null, respEstado: { codRespuesta: '9', msgeRespuesta: 'Consulta rechazada' } }) } });
    expect(await codigoDe(rcvResumen(http, sumidero, EMPRESA, SEPT, 'COMPRA', 'REGISTRO'))).toBe('SII_RECHAZO');
  });

  it.each([null, [], { data: {} }, { data: [null] }, { data: [], respEstado: { codRespuesta: {} } }])('un sobre malformado es PORTAL_CAMBIO: %j', async (respuesta) => {
    const { http, sumidero } = await preparar({ [RUTA_RESUMEN]: { headers: JSON_CT, body: JSON.stringify(respuesta) } });
    expect(await codigoDe(rcvResumen(http, sumidero, EMPRESA, SEPT, 'COMPRA', 'REGISTRO'))).toBe('PORTAL_CAMBIO');
  });
});

describe('rcvDetalle', () => {
  it('normaliza documentos pendientes con fechas ISO, RUT canónico y campos de IVA especial', async () => {
    const { http, llamadas, sumidero } = await preparar({ [RUTA_DETALLE_COMPRA]: { headers: JSON_CT, body: fixture('rcv-detalle-compra-pendiente.json') } });
    const docs = await rcvDetalle(http, sumidero, EMPRESA, SEPT, 'COMPRA', 33, 'PENDIENTE');
    expect(docs[0]).toEqual({
      rut: '22222222-2',
      periodo: '2026-09',
      lado: 'COMPRA',
      estado: 'PENDIENTE',
      tipoDoc: 33,
      rutContraparte: '33333333-3',
      folio: 1501,
      razonSocial: 'PROVEEDOR DEMO LTDA',
      fechaEmision: '2026-09-28',
      fechaRecepcion: '2026-09-29 11:05:00',
      fechaAcuse: null,
      montoExento: 0,
      montoNeto: 50_000,
      montoIva: 9_500,
      montoIvaNoRecuperable: 0,
      montoIvaUsoComun: 0,
      montoTotal: 59_500,
      tipoCompra: '1',
      eventoReceptor: null,
    });
    expect(docs[1]).toMatchObject({ rutContraparte: '44444444-4', montoIvaNoRecuperable: 1_900, montoIvaUsoComun: 500, tipoCompra: '4' });
    const cuerpo = JSON.parse(llamadas[0]!.body!) as { data: Record<string, unknown> };
    expect(cuerpo.data).toMatchObject({ codTipoDoc: '33', estadoContab: 'PENDIENTE', accionRecaptcha: 'RCV_DETC', operacion: 'COMPRA' });
  });

  it('pide detalle de venta con su acción, estado y superficie', async () => {
    const rutaVenta = 'POST https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getDetalleVenta';
    const { http, llamadas, crudas, sumidero } = await preparar({ [rutaVenta]: { headers: JSON_CT, body: fixture('rcv-resumen-sin-movimiento.json') } });
    expect(await rcvDetalle(http, sumidero, EMPRESA, SEPT, 'VENTA', 61, 'RECLAMADO')).toEqual([]);
    const cuerpo = JSON.parse(llamadas[0]!.body!) as { metaData: Record<string, unknown>; data: Record<string, unknown> };
    expect(cuerpo.data).toMatchObject({ rutEmisor: '22222222', dvEmisor: '2', ptributario: '202609', codTipoDoc: '61', estadoContab: 'RECLAMADO', operacion: 'VENTA', accionRecaptcha: 'RCV_DETV', tokenRecaptcha: 't-o-k-e-n-web' });
    expect(cuerpo.metaData).toMatchObject({ page: null, namespace: 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getDetalleVenta' });
    expect(crudas[0]?.superficie).toBe('rcv.detalle.VENTA.RECLAMADO.61');
  });

  it('rechaza un detalle con sobre desconocido', async () => {
    const { http, sumidero } = await preparar({ [RUTA_DETALLE_COMPRA]: { headers: JSON_CT, body: '{"respuestaNueva":[]}' } });
    expect(await codigoDe(rcvDetalle(http, sumidero, EMPRESA, SEPT, 'COMPRA', 33, 'NO_INCLUIR'))).toBe('PORTAL_CAMBIO');
  });
});

describe('lectura tolerante de campos', () => {
  it('elige el primer campo no vacío y conserva cero', () => {
    expect(primero({ a: null, b: '', c: 0, d: 4 }, ['ausente', 'a', 'b', 'c', 'd'])).toBe(0);
    expect(primero({}, ['ausente'])).toBeUndefined();
  });

  it('normaliza textos y montos ausentes o inválidos', () => {
    expect([texto(null), texto(undefined), texto('  '), texto(' demo '), texto(0)]).toEqual([null, null, null, 'demo', '0']);
    expect([entero(null), entero(''), entero('no número'), entero(Infinity), entero('12.9')]).toEqual([0, 0, 0, 0, 12]);
    expect([numero(undefined), numero(''), numero('no número'), numero(Infinity), numero(' 12.9 ')]).toEqual([null, null, null, null, 12.9]);
  });

  it('distingue objetos de null y arreglos', () => {
    expect([esObjeto({}), esObjeto(null), esObjeto([]), esObjeto('texto')]).toEqual([true, false, false, false]);
  });
});
