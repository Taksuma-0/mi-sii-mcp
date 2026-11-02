import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { conAprendidos, MAPA_BASE } from '../../src/connectors/sii/mapa-campos.js';
import { rcvDetalle } from '../../src/connectors/sii/rcv.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import type { AliasAprendido } from '../../src/domain/portal.js';
import { parseRut } from '../../src/domain/rut.js';
import { crearFetchFalso, JSON_CT, sinEsperas } from '../helpers/http-falso.js';

const RUTA_DETALLE_COMPRA = 'POST https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getDetalleCompra';
const EMPRESA = parseRut('22222222-2');
const SEPT = parsePeriodo('2026-09');

/** Dos facturas cuyo neto el SII pasó a mandar como `detMntNetoNuevo` (ficticias). */
const documento = (folio: number, neto: number, o: Record<string, unknown> = {}) => ({
  detRutDoc: 33333333,
  detDvDoc: '3',
  detNroDoc: folio,
  detRznSoc: 'PROVEEDOR DEMO LTDA',
  detFchDoc: '05/09/2026',
  detMntExe: 0,
  detMntNetoNuevo: neto,
  detMntIVA: Math.round(neto * 0.19),
  detMntTotal: neto + Math.round(neto * 0.19),
  detCodigo: 900 + folio,
  ...o,
});
const resumen = { cantidad: 2, exento: 0, neto: 300_000, iva: 57_000, total: 357_000 };

async function leer(filas: unknown[], opciones: Parameters<typeof rcvDetalle>[7] = {}) {
  const { fetchFalso } = crearFetchFalso({ [RUTA_DETALLE_COMPRA]: { headers: JSON_CT, body: JSON.stringify({ data: filas, respEstado: { codRespuesta: '0' } }) } });
  const jar = new CookieJar();
  await jar.setCookie('TOKEN=tok123; Domain=.sii.cl; Path=/', 'https://www4.sii.cl/');
  const http = new ClienteHttp(jar, { fetch: fetchFalso, temporizador: sinEsperas });
  return rcvDetalle(http, () => {}, EMPRESA, SEPT, 'COMPRA', 33, 'REGISTRO', opciones);
}

describe('auto-reparación del detalle del RCV con los totales del resumen', () => {
  it('si un monto cambió de nombre y un solo campo nuevo suma al peso lo del resumen, lo adopta y lo informa', async () => {
    const aprendidos: AliasAprendido[] = [];

    const docs = await leer([documento(1, 100_000), documento(2, 200_000)], { esperado: resumen, alAprender: (a) => aprendidos.push(a) });

    expect(docs.map((d) => d.montoNeto)).toEqual([100_000, 200_000]);
    expect(aprendidos).toEqual([
      { superficie: 'rcv.detalle', campo: 'montoNeto', alias: 'detMntNetoNuevo', aprendidoEn: expect.any(String), evidencia: 'suma de detMntNetoNuevo = neto del resumen (tipo 33, 2026-09, 2 documentos)' },
    ]);
    expect(JSON.stringify(aprendidos)).not.toMatch(/33333333|PROVEEDOR/);
  });

  it('con dos campos nuevos que suman lo mismo no adivina: es PORTAL_CAMBIO', async () => {
    const filas = [documento(1, 100_000, { detOtroNeto: 100_000 }), documento(2, 200_000, { detOtroNeto: 200_000 })];

    const error = await leer(filas, { esperado: resumen }).catch((e: unknown) => e);

    expect(error).toMatchObject({ codigo: 'PORTAL_CAMBIO', detalle: { faltan: ['montoNeto'], candidatos: ['detMntNetoNuevo', 'detOtroNeto'] } });
  });

  it('si ningún campo nuevo cuadra con el resumen, no repara: es PORTAL_CAMBIO', async () => {
    const error = await leer([documento(1, 100_000), documento(2, 150_000)], { esperado: resumen }).catch((e: unknown) => e);

    expect(error).toMatchObject({ codigo: 'PORTAL_CAMBIO', detalle: { faltan: ['montoNeto'], candidatos: [] } });
  });

  it('no repara si la cantidad de documentos no coincide o el resumen trae 0', async () => {
    expect(await leer([documento(1, 300_000)], { esperado: resumen }).catch((e: unknown) => (e as { codigo: string }).codigo)).toBe('PORTAL_CAMBIO');
    expect(await leer([documento(1, 0), documento(2, 0)], { esperado: { ...resumen, neto: 0 } }).catch((e: unknown) => (e as { codigo: string }).codigo)).toBe('PORTAL_CAMBIO');
  });

  it('un alias ya aprendido se usa directo, sin volver a aprenderlo', async () => {
    const aprendidos: AliasAprendido[] = [];
    const mapa = conAprendidos(MAPA_BASE, [{ superficie: 'rcv.detalle', campo: 'montoNeto', alias: 'detMntNetoNuevo', aprendidoEn: '2026-11-01T00:00:00.000Z', evidencia: 'x' }]);

    const docs = await leer([documento(1, 100_000), documento(2, 200_000)], { esperado: resumen, mapa, alAprender: (a) => aprendidos.push(a) });

    expect(docs.map((d) => d.montoNeto)).toEqual([100_000, 200_000]);
    expect(aprendidos).toEqual([]);
  });

  it('un detalle con sus campos de siempre no aprende nada', async () => {
    const aprendidos: AliasAprendido[] = [];
    const normales = [documento(1, 100_000, { detMntNeto: 100_000, detMntNetoNuevo: undefined }), documento(2, 200_000, { detMntNeto: 200_000, detMntNetoNuevo: undefined })];

    const docs = await leer(normales, { esperado: resumen, alAprender: (a) => aprendidos.push(a) });

    expect(docs.map((d) => d.montoNeto)).toEqual([100_000, 200_000]);
    expect(aprendidos).toEqual([]);
  });
});
