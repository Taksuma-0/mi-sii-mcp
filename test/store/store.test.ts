import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentoRcv, Hallazgo, Lado, RcvResumen } from '../../src/domain/tipos.js';
import { abrirDb, type Db } from '../../src/store/sqlite/db.js';
import { huellaDocumento, SqliteStore } from '../../src/store/sqlite/store.js';
import { declaracion, documento, fila, perfilEmpresa, resumen, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { medirLecturas } from '../helpers/lecturas-sqlite.js';

const T = '2026-10-21T10:00:00.000Z';
let store: SqliteStore;
let db: Db;

beforeEach(() => {
  db = abrirDb(':memory:');
  store = new SqliteStore(db);
  store.guardarContribuyente(perfilEmpresa());
});

afterEach(() => {
  db.close();
});

function syncRcv(lado: Lado, resumenes: RcvResumen[], documentos: DocumentoRcv[], inicio = T): number {
  const id = store.iniciarSincronizacion(RUT_EMPRESA, `rcv.${lado}`, '2026-09', inicio);
  store.reemplazarRcv(id, RUT_EMPRESA, '2026-09', lado, resumenes, documentos, inicio);
  store.terminarSincronizacion(id, inicio, 'ok');
  return id;
}

describe('SqliteStore: RCV', () => {
  it.each([
    [NaN, NaN, 50], [Infinity, Infinity, 50], [-Infinity, -Infinity, 50],
    [-1, 0, 1], [1, 300, 200], [Number.MAX_VALUE, 200, 0],
  ])('pagina directamente con entradas %s/%s sin parámetros inválidos para SQLite', (pagina, tamano, cantidad) => {
    syncRcv('COMPRA', [], Array.from({ length: 250 }, (_, i) => documento({ folio: i + 1 })));
    const resultado = store.documentosRcvPaginados(RUT_EMPRESA, '2026-09', {}, pagina, tamano);
    expect(resultado.total).toBe(250);
    expect(resultado.documentos).toHaveLength(cantidad);
  });

  it('pagina 250 documentos filtrados recuperando sólo la página y el total', () => {
    const documentos = Array.from({ length: 250 }, (_, i) => documento({ folio: 250 - i, estado: 'PENDIENTE' }));
    syncRcv('COMPRA', [], [...documentos, documento({ folio: 251 }), documento({ folio: 252, tipoDoc: 61, estado: 'PENDIENTE' }), documento({ folio: 253, rutContraparte: '44444444-4', estado: 'PENDIENTE' })]);
    syncRcv('VENTA', [], [documento({ lado: 'VENTA', estado: 'PENDIENTE' })]);
    const filtro = { lado: 'COMPRA', estado: 'PENDIENTE', tipoDoc: 33, rutContraparte: '33333333-3' } as const;
    const medicion = medirLecturas(db);
    const consultado = new SqliteStore(medicion.db);
    const pagina = consultado.documentosRcvPaginados(RUT_EMPRESA, '2026-09', filtro, 3, 50);
    expect(pagina).toEqual({ total: 250, documentos: [...documentos].reverse().slice(100, 150) });
    expect(medicion.lecturas).toHaveLength(2);
    expect(medicion.lecturas.reduce((n, lectura) => n + lectura.filas, 0)).toBe(51);
    expect(store.documentosRcv(RUT_EMPRESA, '2026-09', filtro)).toEqual([...documentos].reverse());
    expect(consultado.documentosRcvPaginados(RUT_EMPRESA, '2026-09', filtro, 6, 50)).toEqual({ total: 250, documentos: [] });
    expect(consultado.documentosRcvPaginados(RUT_EMPRESA, '2026-08', filtro, 1, 50)).toEqual({ total: 0, documentos: [] });
  });

  it('pagina con orden estable entre estados y contrapartes de un mismo folio', () => {
    const docs = [
      documento({ folio: 1, estado: 'PENDIENTE' }),
      documento({ folio: 1, estado: 'REGISTRO', rutContraparte: '44444444-4' }),
      documento({ folio: 2, tipoDoc: 61 }),
    ];
    syncRcv('COMPRA', [], [...docs].reverse());
    syncRcv('VENTA', [], [documento({ lado: 'VENTA', folio: 1 })]);
    const esperados = [...docs, documento({ lado: 'VENTA', folio: 1 })];
    const paginas = Array.from({ length: 4 }, (_, i) => store.documentosRcvPaginados(RUT_EMPRESA, '2026-09', {}, i + 1, 1).documentos).flat();
    expect(paginas).toEqual(esperados);
    expect(store.documentosRcv(RUT_EMPRESA, '2026-09')).toEqual(esperados);
    expect(store.documentosRcvPaginados(RUT_EMPRESA, '2026-09', { rutContraparte: "' OR 1=1 --" }, 1, 50)).toEqual({ total: 0, documentos: [] });
  });

  it('recupera 30 fotos de 250 documentos con dos SELECT como máximo, conservando historia y fotos vacías', () => {
    const docs = Array.from({ length: 250 }, (_, i) => documento({ folio: 250 - i }));
    const esperados = Array.from({ length: 30 }, (_, i) => {
      const lado: Lado = i % 2 === 0 ? 'COMPRA' : 'VENTA';
      // En Santiago este instante aún pertenece al día anterior.
      const inicio = i < 2 ? '2026-10-16T01:00:00.000Z' : T;
      const filas = docs.map((d) => ({ ...d, lado, montoIva: d.montoIva + i }));
      const id = syncRcv(lado, [], filas, inicio);
      return { sincronizacionId: id, lado, obtenidoEn: inicio, filas: filas.map((d) => ({ clave: `${lado}:33:33333333-3:${d.folio}`, estado: d.estado, sha: huellaDocumento(d) })).sort((a, b) => a.clave.localeCompare(b.clave)) };
    });
    const vacia = syncRcv('COMPRA', [], [], T);
    const fallida = store.iniciarSincronizacion(RUT_EMPRESA, 'rcv.COMPRA', '2026-09', T);
    store.reemplazarRcv(fallida, RUT_EMPRESA, '2026-09', 'COMPRA', [], docs, T);
    store.terminarSincronizacion(fallida, T, 'error');
    const medicion = medirLecturas(db);
    const fotos = new SqliteStore(medicion.db).snapshotsRcv(RUT_EMPRESA, '2026-09');
    expect(fotos).toEqual([...esperados, { sincronizacionId: vacia, lado: 'COMPRA', obtenidoEn: T, filas: [] }]);
    expect(medicion.lecturas.length).toBeLessThanOrEqual(2);
    expect(medicion.lecturas.reduce((n, lectura) => n + lectura.filas, 0)).toBeLessThanOrEqual(7_531);
  });

  it('reemplaza el RCV de un lado sin duplicar', () => {
    syncRcv('COMPRA', [resumen({ lado: 'COMPRA', filas: [fila(33, 100_000, 19_000, 1)] })], [documento({ folio: 1 })]);
    syncRcv('COMPRA', [resumen({ lado: 'COMPRA', filas: [fila(33, 200_000, 38_000, 2)] })], [documento({ folio: 1 }), documento({ folio: 2 })]);
    expect(store.documentosRcv(RUT_EMPRESA, '2026-09').map((d) => d.folio)).toEqual([1, 2]);
    expect(store.resumenesRcv(RUT_EMPRESA, '2026-09')).toEqual([
      { rut: RUT_EMPRESA, periodo: '2026-09', lado: 'COMPRA', estado: 'REGISTRO', filas: [fila(33, 200_000, 38_000, 2)] },
    ]);
  });

  it('no borra el otro lado al reemplazar', () => {
    syncRcv('VENTA', [resumen()], [documento({ lado: 'VENTA', folio: 9 })]);
    syncRcv('COMPRA', [], [documento({ folio: 1 })]);
    expect(store.documentosRcv(RUT_EMPRESA, '2026-09').map((d) => `${d.lado}:${d.folio}`)).toEqual(['COMPRA:1', 'VENTA:9']);
  });

  it('devuelve los documentos tal como se guardaron y filtra', () => {
    const pendiente = documento({ folio: 3, estado: 'PENDIENTE' });
    syncRcv('COMPRA', [], [pendiente, documento({ folio: 4 })]);
    expect(store.documentosRcv(RUT_EMPRESA, '2026-09', { estado: 'PENDIENTE' })).toEqual([pendiente]);
    expect(store.documentosRcv(RUT_EMPRESA, '2026-09', { tipoDoc: 61 })).toEqual([]);
    expect(store.documentosRcv(RUT_EMPRESA, '2026-09', { lado: 'COMPRA', rutContraparte: '33333333-3' })).toHaveLength(2);
  });

  it('arma un snapshot por sincronización, incluso vacío', () => {
    const a = syncRcv('COMPRA', [], [documento({ folio: 1 })], '2026-10-16T10:00:00.000Z');
    const b = syncRcv('COMPRA', [], [], '2026-10-20T10:00:00.000Z');
    const snaps = store.snapshotsRcv(RUT_EMPRESA, '2026-09');
    expect(snaps.map((s) => [s.sincronizacionId, s.lado, s.filas.length])).toEqual([
      [a, 'COMPRA', 1],
      [b, 'COMPRA', 0],
    ]);
    expect(snaps[0]!.obtenidoEn).toBe('2026-10-16T10:00:00.000Z');
    expect(snaps[0]!.filas[0]).toEqual({ clave: 'COMPRA:33:33333333-3:1', estado: 'REGISTRO', sha: huellaDocumento(documento({ folio: 1 })) });
  });

  it('la huella es estable y cambia si cambia un monto o el estado', () => {
    expect(huellaDocumento(documento())).toBe(huellaDocumento(documento()));
    expect(huellaDocumento(documento())).not.toBe(huellaDocumento(documento({ montoIva: 1 })));
    expect(huellaDocumento(documento())).not.toBe(huellaDocumento(documento({ estado: 'RECLAMADO' })));
  });

  it('la huella depende de los campos tributarios y no del orden ni de metadatos', () => {
    const original = documento();
    const reordenado = Object.fromEntries(Object.entries(original).reverse()) as unknown as DocumentoRcv;
    expect(huellaDocumento(reordenado)).toBe(huellaDocumento(original));
    expect(huellaDocumento(documento({ razonSocial: 'OTRO NOMBRE DEMO', fechaRecepcion: null, fechaAcuse: T }))).toBe(huellaDocumento(original));
    const cambios: Partial<DocumentoRcv>[] = [
      { tipoDoc: 61 }, { rutContraparte: '44444444-4' }, { folio: 101 }, { fechaEmision: null },
      { montoExento: 1 }, { montoNeto: 1 }, { montoIvaNoRecuperable: 1 }, { montoIvaUsoComun: 1 }, { montoTotal: 1 },
    ];
    for (const cambio of cambios) expect(huellaDocumento(documento(cambio))).not.toBe(huellaDocumento(original));
  });

  it('ordena snapshots por inicio e id e ignora sincronizaciones no correctas o ajenas', () => {
    const posterior = syncRcv('VENTA', [], [], '2026-10-20T10:00:00.000Z');
    const anterior = syncRcv('COMPRA', [], [documento()], '2026-10-16T10:00:00.000Z');
    const empate = syncRcv('VENTA', [], [], '2026-10-16T10:00:00.000Z');
    store.iniciarSincronizacion(RUT_EMPRESA, 'rcv.COMPRA', '2026-09', T);
    const fallido = store.iniciarSincronizacion(RUT_EMPRESA, 'rcv.COMPRA', '2026-09', T);
    store.reemplazarRcv(fallido, RUT_EMPRESA, '2026-09', 'COMPRA', [], [documento({ folio: 2 })], T);
    store.terminarSincronizacion(fallido, T, 'error');
    for (const [rut, periodo, superficie] of [
      ['11111111-1', '2026-09', 'rcv.VENTA'], [RUT_EMPRESA, '2026-08', 'rcv.VENTA'], [RUT_EMPRESA, '2026-09', 'f29'],
    ] as const) {
      const id = store.iniciarSincronizacion(rut, superficie, periodo, T);
      store.terminarSincronizacion(id, T, 'ok');
    }
    expect(store.snapshotsRcv(RUT_EMPRESA, '2026-09').map((s) => s.sincronizacionId)).toEqual([anterior, empate, posterior]);
    expect(store.snapshotsRcv(RUT_EMPRESA, '2026-09')[0]?.filas).toHaveLength(1);
  });

  it('revierte el reemplazo de RCV completo si falla una inserción', () => {
    const inicial = resumen({ lado: 'COMPRA' });
    syncRcv('COMPRA', [inicial], [documento()]);
    expect(() => store.reemplazarRcv(999, RUT_EMPRESA, '2026-09', 'COMPRA', [], [documento({ folio: 2 })], T)).toThrow(/FOREIGN KEY/);
    expect(store.documentosRcv(RUT_EMPRESA, '2026-09')).toEqual([documento()]);
    expect(store.resumenesRcv(RUT_EMPRESA, '2026-09')).toEqual([inicial]);
    expect(store.snapshotsRcv(RUT_EMPRESA, '2026-09')).toHaveLength(1);
  });

  it('agrupa resúmenes por lado y estado y ordena sus tipos de documento', () => {
    syncRcv('VENTA', [resumen({ filas: [fila(61, 100, 19), fila(33, 200, 38)] }), resumen({ estado: 'PENDIENTE', filas: [fila(33, 100, 19)] })], []);
    expect(store.resumenesRcv(RUT_EMPRESA, '2026-09')).toEqual([
      resumen({ estado: 'PENDIENTE', filas: [fila(33, 100, 19)] }),
      resumen({ filas: [fila(33, 200, 38), fila(61, 100, 19)] }),
    ]);
  });
});

describe('SqliteStore: F29, frescura y hallazgos', () => {
  it('guarda declaraciones F29 y sus valores (incluye decimales)', () => {
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f29', '2026-09', T);
    store.guardarF29(id, RUT_EMPRESA, '2026-09', [declaracion()], [valores({ '538': 190_000, '115': 0.125 })], T);
    store.terminarSincronizacion(id, T, 'ok');
    expect(store.declaracionesF29(RUT_EMPRESA, '2026-09')).toEqual([declaracion()]);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)?.valores).toEqual({ '115': 0.125, '538': 190_000 });
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 1)).toBeNull();
  });

  it('conserva el id de estado de la declaración, también cuando es null', () => {
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f29', '2026-09', T);
    const lista = [declaracion({ estadoId: 70, folio: 555_002 }), declaracion({ estadoId: null })];
    store.guardarF29(id, RUT_EMPRESA, '2026-09', lista, [], T);
    expect(store.declaracionesF29(RUT_EMPRESA, '2026-09')).toEqual([declaracion({ estadoId: null }), declaracion({ estadoId: 70, folio: 555_002 })]);
  });

  it('informa frescura y períodos con datos', () => {
    syncRcv('VENTA', [], []);
    expect(store.frescura(RUT_EMPRESA, '2026-09')).toEqual({ rcv: T, f29: null });
    expect(store.periodosConDatos(RUT_EMPRESA)).toEqual(['2026-09']);
  });

  it('reemplaza el F29 completo sin retener folios ni códigos anteriores', () => {
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f29', '2026-09', T);
    store.guardarF29(id, RUT_EMPRESA, '2026-09', [declaracion()], [valores({ '538': 190_000, '115': 0.125 })], T);
    store.guardarF29(id, RUT_EMPRESA, '2026-09', [declaracion({ folio: 555_002 })], [valores({ '538': 1 }, { folio: 555_002 })], T);
    expect(store.declaracionesF29(RUT_EMPRESA, '2026-09')).toEqual([declaracion({ folio: 555_002 })]);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)).toBeNull();
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_002)).toEqual(valores({ '538': 1 }, { folio: 555_002 }));
    store.guardarF29(id, RUT_EMPRESA, '2026-09', [], [], T);
    expect(store.declaracionesF29(RUT_EMPRESA, '2026-09')).toEqual([]);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_002)).toBeNull();
  });

  it('revierte declaraciones y valores F29 si falla el reemplazo', () => {
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f29', '2026-09', T);
    store.guardarF29(id, RUT_EMPRESA, '2026-09', [declaracion()], [valores({ '115': 0.125 })], T);
    expect(() => store.guardarF29(999, RUT_EMPRESA, '2026-09', [declaracion({ folio: 555_002 })], [], T)).toThrow(/FOREIGN KEY/);
    expect(store.declaracionesF29(RUT_EMPRESA, '2026-09')).toEqual([declaracion()]);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)).toEqual(valores({ '115': 0.125 }));
  });

  it('calcula frescura por término correcto y lista períodos únicos en orden', () => {
    expect(store.frescura(RUT_EMPRESA, '2026-09')).toEqual({ rcv: null, f29: null });
    expect(store.periodosConDatos(RUT_EMPRESA)).toEqual([]);
    for (const [superficie, inicio, fin, estado] of [
      ['rcv.COMPRA', '2026-10-16T10:00:00.000Z', '2026-10-20T10:00:00.000Z', 'ok'],
      ['rcv.VENTA', '2026-10-17T10:00:00.000Z', '2026-10-19T10:00:00.000Z', 'ok'],
      ['rcv.COMPRA', T, T, 'error'], ['f29', T, T, 'ok'],
    ] as const) {
      const id = store.iniciarSincronizacion(RUT_EMPRESA, superficie, '2026-09', inicio);
      store.terminarSincronizacion(id, fin, estado);
    }
    store.iniciarSincronizacion(RUT_EMPRESA, 'rcv.VENTA', '2026-10', T);
    const otroMes = store.iniciarSincronizacion(RUT_EMPRESA, 'f29', '2026-08', T);
    store.terminarSincronizacion(otroMes, T, 'ok');
    expect(store.frescura(RUT_EMPRESA, '2026-09')).toEqual({ rcv: '2026-10-20T10:00:00.000Z', f29: T });
    expect(store.periodosConDatos(RUT_EMPRESA)).toEqual(['2026-08', '2026-09']);
  });

  it('reemplaza y filtra hallazgos, ordenados por período y severidad', () => {
    const h = (o: Partial<Hallazgo>): Hallazgo => ({
      regla: 'IVA-01',
      severidad: 'critico',
      naturaleza: 'DERIVADO',
      rut: RUT_EMPRESA,
      periodo: '2026-09',
      titulo: 't',
      detalle: 'd',
      montos: { esperado: 1, declarado: 2, diferencia: -1 },
      evidencia: ['F29:1'],
      ...o,
    });
    store.reemplazarHallazgos(RUT_EMPRESA, '2026-09', [h({ regla: 'IVA-07', severidad: 'info', montos: null }), h({})], 'iva-test', T);
    store.reemplazarHallazgos(RUT_EMPRESA, '2026-08', [h({ periodo: '2026-08', severidad: 'advertencia' })], 'iva-test', T);
    expect(store.hallazgos(RUT_EMPRESA).map((x) => `${x.periodo}:${x.regla}:${x.severidad}`)).toEqual([
      '2026-09:IVA-01:critico',
      '2026-09:IVA-07:info',
      '2026-08:IVA-01:advertencia',
    ]);
    expect(store.hallazgos(RUT_EMPRESA, { severidad: 'info' })[0]?.montos).toBeNull();
    expect(store.hallazgos(RUT_EMPRESA, { desde: '2026-09' })).toHaveLength(2);
    expect(store.hallazgos(RUT_EMPRESA, { hasta: '2026-08' }).map((x) => x.periodo)).toEqual(['2026-08']);
    expect(store.hallazgos(RUT_EMPRESA, { desde: '2026-09', hasta: '2026-09', severidad: 'critico' })).toEqual([
      { ...h({}), versionReglas: 'iva-test', calculadoEn: T },
    ]);
    expect(store.hallazgos('11111111-1')).toEqual([]);
    expect(store.hallazgos(RUT_EMPRESA)[0]?.versionReglas).toBe('iva-test');
    store.reemplazarHallazgos(RUT_EMPRESA, '2026-09', [], 'iva-test', T);
    expect(store.hallazgos(RUT_EMPRESA)).toHaveLength(1);
  });
});
