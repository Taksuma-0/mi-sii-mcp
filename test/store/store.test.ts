import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoletaHonorarios, DocumentoRcv, Hallazgo, Lado, PropuestaF29, RcvResumen } from '../../src/domain/tipos.js';
import { abrirDb, type Db } from '../../src/store/sqlite/db.js';
import { huellaDocumento, SqliteStore } from '../../src/store/sqlite/store.js';
import { boleta, declaracion, documento, empresaAutorizada, fila, propuesta, perfilEmpresa, perfilTributario, perfilPersona, resumen, RUT_EMPRESA, RUT_PERSONA, valores } from '../helpers/fabricas.js';
import { guardarPdfF29, pdfFalso } from '../helpers/lector-falso.js';
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
    expect(store.frescura(RUT_EMPRESA, '2026-09')).toEqual({ rcv: T, f29: null, propuesta: null, bhe: null });
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
    expect(store.frescura(RUT_EMPRESA, '2026-09')).toEqual({ rcv: null, f29: null, propuesta: null, bhe: null });
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
    expect(store.frescura(RUT_EMPRESA, '2026-09')).toEqual({ rcv: '2026-10-20T10:00:00.000Z', f29: T, propuesta: null, bhe: null });
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

describe('SqliteStore: lecturas del F29 y PDF guardados', () => {
  const LECTURA = { versionLector: 'v1', origen: 'sincronizacion', leidoEn: T, coherente: true } as const;

  function guardarMes(folios: readonly number[], lecturas: readonly number[] = folios): void {
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f29', '2026-09', T);
    store.guardarF29(
      id,
      RUT_EMPRESA,
      '2026-09',
      folios.map((folio) => declaracion({ folio })),
      folios.map((folio) => valores({ '538': folio, '537': 0, '89': folio }, { folio })),
      T,
      lecturas.map((folio) => ({ folio, ...LECTURA })),
    );
    store.terminarSincronizacion(id, T, 'ok');
  }

  it('guardarF29 registra la lectura de cada folio con la cantidad de códigos', () => {
    guardarMes([555_001]);
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_001)).toEqual({ ...LECTURA, codigos: 3 });
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_002)).toBeNull();
    expect(store.lecturaF29(RUT_PERSONA, '2026-09', 555_001)).toBeNull();
  });

  it('guardarF29 conserva la lectura de los folios que siguen con valores y poda la de los que desaparecen', () => {
    guardarMes([555_001, 555_002]);
    // Sin lecturas nuevas: las de los folios que quedan con valores no se tocan.
    guardarMes([555_001], []);
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_001)).toEqual({ ...LECTURA, codigos: 3 });
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_002)).toBeNull();
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f29', '2026-09', T);
    store.guardarF29(id, RUT_EMPRESA, '2026-09', [declaracion()], [], T);
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_001)).toBeNull();
  });

  it('reemplazarValoresFolioF29 toca solo ese folio y registra su lectura', () => {
    guardarMes([555_001, 555_002]);
    const otro = store.valoresF29(RUT_EMPRESA, '2026-09', 555_002);
    const relectura = { versionLector: 'v2', origen: 'relectura', leidoEn: '2026-10-27T10:00:00.000Z', coherente: false } as const;

    store.reemplazarValoresFolioF29(RUT_EMPRESA, '2026-09', 555_001, { '538': 7, '91': 7 }, relectura);

    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)?.valores).toEqual({ '538': 7, '91': 7 });
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_001)).toEqual({ ...relectura, codigos: 2 });
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_002)).toEqual(otro);
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_002)).toEqual({ ...LECTURA, codigos: 3 });
    expect(store.declaracionesF29(RUT_EMPRESA, '2026-09').map((d) => d.folio)).toEqual([555_001, 555_002]);
  });

  it('reemplazarValoresFolioF29 exige que el folio esté declarado y no escribe nada si no', () => {
    guardarMes([555_001]);
    expect(() => store.reemplazarValoresFolioF29(RUT_EMPRESA, '2026-09', 999, { '538': 1 }, LECTURA)).toThrow(/999/);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 999)).toBeNull();
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 999)).toBeNull();
  });

  it('pdfsF29Guardados entrega el PDF válido más nuevo por período y folio, de cualquier sincronización', () => {
    store.guardarContribuyente(perfilPersona());
    guardarPdfF29(store, { periodo: '2026-09', folio: 1, cuerpo: pdfFalso({ '538': 1 }), obtenidoEn: '2026-10-01T00:00:00.000Z' });
    guardarPdfF29(store, { periodo: '2026-09', folio: 1, cuerpo: pdfFalso({ '538': 2 }), obtenidoEn: '2026-10-02T00:00:00.000Z', estado: 'error' });
    // Más nuevos pero no son PDF (una página de sesión vencida, un cuerpo vacío): se ignoran.
    guardarPdfF29(store, { periodo: '2026-09', folio: 1, cuerpo: new TextEncoder().encode('<html>sesión</html>'), obtenidoEn: '2026-10-03T00:00:00.000Z' });
    guardarPdfF29(store, { periodo: '2026-09', folio: 1, cuerpo: '', obtenidoEn: '2026-10-04T00:00:00.000Z' });
    guardarPdfF29(store, { periodo: '2026-09', folio: 2, cuerpo: pdfFalso({ '538': 3 }), obtenidoEn: '2026-10-01T00:00:00.000Z' });
    guardarPdfF29(store, { periodo: '2026-08', folio: 3, cuerpo: pdfFalso({ '538': 4 }), obtenidoEn: '2026-10-01T00:00:00.000Z' });
    // Otro RUT y otra superficie no cuentan.
    guardarPdfF29(store, { periodo: '2026-09', folio: 1, cuerpo: pdfFalso({ '538': 9 }), obtenidoEn: '2026-10-09T00:00:00.000Z', rut: RUT_PERSONA });
    guardarPdfF29(store, { periodo: '2026-09', folio: 1, cuerpo: pdfFalso({ '538': 8 }), obtenidoEn: '2026-10-09T00:00:00.000Z', superficie: 'f29.estados' });

    const pdfs = store.pdfsF29Guardados(RUT_EMPRESA);

    expect(pdfs.map((p) => [p.periodo, p.folio, new TextDecoder().decode(p.bytes), p.obtenidoEn])).toEqual([
      ['2026-08', 3, '%PDF-{"538":4}', '2026-10-01T00:00:00.000Z'],
      ['2026-09', 1, '%PDF-{"538":2}', '2026-10-02T00:00:00.000Z'],
      ['2026-09', 2, '%PDF-{"538":3}', '2026-10-01T00:00:00.000Z'],
    ]);
    expect(store.pdfsF29Guardados(RUT_PERSONA).map((p) => new TextDecoder().decode(p.bytes))).toEqual(['%PDF-{"538":9}']);
    expect(store.pdfsF29Guardados(RUT_EMPRESA, '2026-09').map((p) => p.folio)).toEqual([1, 2]);
    expect(store.pdfsF29Guardados(RUT_EMPRESA, undefined, '2026-08').map((p) => p.folio)).toEqual([3]);
    expect(store.pdfsF29Guardados(RUT_EMPRESA, '2026-10', '2026-12')).toEqual([]);
  });
});

describe('SqliteStore: superficies anuales y no periódicas', () => {
  function sincOk(superficie: string, periodo: string, fin = T): void {
    const id = store.iniciarSincronizacion(RUT_EMPRESA, superficie, periodo, fin);
    store.terminarSincronizacion(id, fin, 'ok');
  }

  it('periodosConDatos ignora los períodos anuales y no periódicos', () => {
    sincOk('f29', '2026-09');
    sincOk('f22', 'AT2026');
    sincOk('cuenta.perfil', '');
    expect(store.periodosConDatos(RUT_EMPRESA)).toEqual(['2026-09']);
  });

  it('lee propuesta F29 y boletas recibidas por nombre exacto en disponibilidad y frescura', () => {
    expect(store.disponibilidadFuentes(RUT_EMPRESA, '2026-09')).toEqual({ ventasRcv: false, comprasRcv: false, f29: false, propuestaF29: false, bheRecibidas: false });
    sincOk('f29.propuesta', '2026-09', '2026-10-22T10:00:00.000Z');
    sincOk('bhe.recibidas', '2026-09', '2026-10-23T10:00:00.000Z');
    sincOk('f29.propuesta.otra', '2026-09', '2026-10-24T10:00:00.000Z');
    expect(store.disponibilidadFuentes(RUT_EMPRESA, '2026-09')).toEqual({ ventasRcv: false, comprasRcv: false, f29: false, propuestaF29: true, bheRecibidas: true });
    expect(store.frescura(RUT_EMPRESA, '2026-09')).toEqual({ rcv: null, f29: null, propuesta: '2026-10-22T10:00:00.000Z', bhe: '2026-10-23T10:00:00.000Z' });
  });

  it('la propuesta no cuenta como F29 ni lo contrario', () => {
    sincOk('f29', '2026-09');
    expect(store.disponibilidadFuentes(RUT_EMPRESA, '2026-09')).toMatchObject({ f29: true, propuestaF29: false });
    expect(store.frescura(RUT_EMPRESA, '2026-09')).toMatchObject({ f29: T, propuesta: null });
  });
});

describe('SqliteStore: propuesta F29', () => {
  function guardar(p: PropuestaF29, periodo = '2026-09', obtenidoEn = T): number {
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f29.propuesta', periodo, obtenidoEn);
    store.reemplazarPropuestaF29(id, RUT_EMPRESA, periodo, p, obtenidoEn);
    store.terminarSincronizacion(id, obtenidoEn, 'ok');
    return id;
  }

  it('sin datos guardados devuelve null', () => {
    expect(store.propuestaF29(RUT_EMPRESA, '2026-09')).toBeNull();
  });

  it('guarda y devuelve la propuesta con sus listas, incluidos decimales', () => {
    const p = propuesta({ propuestos: { '520': 950_000.5, '504': 120_000 }, administrativos: { '9114': 1 } });
    guardar(p);
    expect(store.propuestaF29(RUT_EMPRESA, '2026-09')).toEqual(p);
  });

  it('conserva tipo, descripción y estado nulos y la marca sinPropuesta', () => {
    const p = propuesta({ tipoPropuesta: null, descripcionTipo: null, estadoCalculo: null, propuestos: {}, administrativos: {}, sinPropuesta: true });
    guardar(p);
    expect(store.propuestaF29(RUT_EMPRESA, '2026-09')).toEqual(p);
  });

  it('reemplaza la propuesta anterior sin retener códigos viejos ni tocar otros meses', () => {
    guardar(propuesta({ propuestos: { '520': 1, '504': 2 }, administrativos: { '9114': 3 } }));
    guardar(propuesta({ periodo: '2026-08', propuestos: { '151': 9 } }), '2026-08');
    guardar(propuesta({ tipoPropuesta: 48, propuestos: {}, administrativos: {}, sinPropuesta: true }), '2026-09', '2026-10-22T10:00:00.000Z');
    expect(store.propuestaF29(RUT_EMPRESA, '2026-09')).toMatchObject({ tipoPropuesta: 48, propuestos: {}, administrativos: {}, sinPropuesta: true });
    expect(store.propuestaF29(RUT_EMPRESA, '2026-08')).toMatchObject({ propuestos: { '151': 9 } });
    expect(db.prepare("SELECT COUNT(*) AS n FROM f29_propuesta_valor WHERE periodo = '2026-09'").get()).toEqual({ n: 0 });
  });

  it('revierte el reemplazo si falla una inserción', () => {
    const p = propuesta({ propuestos: { '520': 1 } });
    guardar(p);
    const mala = propuesta({ propuestos: { '520': NaN, '504': 2 }, administrativos: { '9114': 3 } });
    // NaN llega a SQLite como NULL y viola NOT NULL: nada del reemplazo debe quedar escrito.
    expect(() => guardar(mala, '2026-09', '2026-10-22T10:00:00.000Z')).toThrow();
    expect(store.propuestaF29(RUT_EMPRESA, '2026-09')).toEqual(p);
  });

  it('la propuesta guardada no cambia la disponibilidad hasta que una sincronización ok la registra', () => {
    guardar(propuesta());
    expect(store.disponibilidadFuentes(RUT_EMPRESA, '2026-09')).toMatchObject({ propuestaF29: true, f29: false });
  });
});

describe('SqliteStore: boletas de honorarios recibidas', () => {
  function guardar(boletas: readonly BoletaHonorarios[], periodo = '2026-09', obtenidoEn = T): number {
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'bhe.recibidas', periodo, obtenidoEn);
    store.reemplazarBhe(id, RUT_EMPRESA, periodo, boletas, obtenidoEn);
    store.terminarSincronizacion(id, obtenidoEn, 'ok');
    return id;
  }

  it('sin datos guardados no hay boletas y los totales son cero', () => {
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-09')).toEqual([]);
    expect(store.totalesBhe(RUT_EMPRESA, '2026-09')).toEqual({ cantidad: 0, anuladas: 0, bruto: 0, retencion: 0, liquido: 0 });
  });

  it('guarda y devuelve las boletas del mes ordenadas por fecha, emisor y folio, con nulos y booleanos', () => {
    const b1 = boleta({ folio: 102, fecha: '2026-09-20' });
    const b2 = boleta({ folio: 7, rutEmisor: '44444444-4', nombreEmisor: null, fecha: null, sociedadProfesional: true, anulada: true, fechaAnulacion: '2026-09-15' });
    const b3 = boleta({ folio: 101, fecha: '2026-09-05' });
    guardar([b1, b2, b3]);

    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-09')).toEqual([b2, b3, b1]);
  });

  it('los totales del mes cuentan todas las boletas y suman solo las no anuladas', () => {
    guardar([
      boleta({ folio: 1, bruto: 1_000_000, retencion: 152_500, liquido: 847_500 }),
      boleta({ folio: 2, bruto: 200_000, retencion: 30_500, liquido: 169_500, anulada: true, fechaAnulacion: '2026-09-15' }),
      boleta({ folio: 3, bruto: 500_000, retencion: 76_250, liquido: 423_750 }),
    ]);

    expect(store.totalesBhe(RUT_EMPRESA, '2026-09')).toEqual({ cantidad: 3, anuladas: 1, bruto: 1_500_000, retencion: 228_750, liquido: 1_271_250 });
  });

  it('reemplaza las boletas del mes sin tocar otros meses; una vacía las borra', () => {
    guardar([boleta({ folio: 1 }), boleta({ folio: 2 })]);
    guardar([boleta({ periodo: '2026-08', folio: 50 })], '2026-08');
    guardar([boleta({ folio: 3 })], '2026-09', '2026-10-22T10:00:00.000Z');
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-09').map((b) => b.folio)).toEqual([3]);
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-08').map((b) => b.folio)).toEqual([50]);

    guardar([], '2026-09', '2026-10-23T10:00:00.000Z');
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-09')).toEqual([]);
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-08')).toHaveLength(1);
  });

  it('una boleta que ya estaba en otro mes pasa al mes que la trae ahora', () => {
    guardar([boleta({ periodo: '2026-08', folio: 1 })], '2026-08');
    guardar([boleta({ folio: 1 })]);
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-08')).toEqual([]);
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-09').map((b) => b.folio)).toEqual([1]);
  });

  it('revierte el reemplazo si falla una inserción', () => {
    guardar([boleta({ folio: 1 })]);
    expect(() => guardar([boleta({ folio: 2 }), boleta({ folio: 3, bruto: NaN })], '2026-09', '2026-10-22T10:00:00.000Z')).toThrow();
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-09').map((b) => b.folio)).toEqual([1]);
  });

  it('una sincronización ok de bhe.recibidas marca la fuente disponible y su frescura', () => {
    guardar([]);
    expect(store.disponibilidadFuentes(RUT_EMPRESA, '2026-09')).toMatchObject({ bheRecibidas: true, f29: false });
    expect(store.frescura(RUT_EMPRESA, '2026-09').bhe).toBe(T);
  });
});

describe('SqliteStore: perfil tributario', () => {
  it('sin datos guardados devuelve null', () => {
    expect(store.perfilTributario(RUT_EMPRESA)).toBeNull();
  });

  it('guarda y devuelve el perfil con sus atributos y el instante de la lectura', () => {
    const p = perfilTributario();
    store.guardarPerfilTributario(RUT_EMPRESA, p, T);
    expect(store.perfilTributario(RUT_EMPRESA)).toEqual({ ...p, obtenidoEn: T });
  });

  it('distingue no autorizado (false) de desconocido (null)', () => {
    store.guardarPerfilTributario(RUT_EMPRESA, perfilTributario({ autorizadoDia20: false }), T);
    expect(store.perfilTributario(RUT_EMPRESA)?.autorizadoDia20).toBe(false);
    store.guardarPerfilTributario(RUT_EMPRESA, perfilTributario({ autorizadoDia20: null }), T);
    expect(store.perfilTributario(RUT_EMPRESA)?.autorizadoDia20).toBeNull();
  });

  it('una lectura nueva reemplaza a la anterior y no toca a otro contribuyente', () => {
    store.guardarPerfilTributario(RUT_PERSONA, perfilTributario({ glosaActividad: 'OTRA' }), T);
    store.guardarPerfilTributario(RUT_EMPRESA, perfilTributario(), T);
    store.guardarPerfilTributario(RUT_EMPRESA, perfilTributario({ glosaActividad: null, atributos: [] }), '2026-10-22T10:00:00.000Z');
    expect(store.perfilTributario(RUT_EMPRESA)).toEqual({ ...perfilTributario({ glosaActividad: null, atributos: [] }), obtenidoEn: '2026-10-22T10:00:00.000Z' });
    expect(store.perfilTributario(RUT_PERSONA)?.glosaActividad).toBe('OTRA');
  });
});

describe('SqliteStore: empresas autorizadas', () => {
  function guardar(empresas: ReturnType<typeof empresaAutorizada>[], obtenidoEn = T): number {
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'cuenta.empresas', '', obtenidoEn);
    store.reemplazarEmpresasAutorizadas(id, RUT_EMPRESA, empresas, obtenidoEn);
    store.terminarSincronizacion(id, obtenidoEn, 'ok');
    return id;
  }

  it('sin datos devuelve una lista vacía', () => {
    expect(store.empresasAutorizadas(RUT_EMPRESA)).toEqual([]);
  });

  it('guarda y devuelve las empresas ordenadas por RUT, con nulos', () => {
    const a = empresaAutorizada({ rutEmpresa: '44444444-4', razonSocial: null, privilegios: null, fechaDesautorizacion: '2025-06-30' });
    const b = empresaAutorizada({ rutEmpresa: '33333333-3' });
    guardar([a, b]);
    expect(store.empresasAutorizadas(RUT_EMPRESA)).toEqual([b, a]);
  });

  it('reemplaza la lista anterior completa sin tocar a otro contribuyente', () => {
    const otro = store.iniciarSincronizacion(RUT_PERSONA, 'cuenta.empresas', '', T);
    store.reemplazarEmpresasAutorizadas(otro, RUT_PERSONA, [empresaAutorizada({ rutEmpresa: RUT_EMPRESA })], T);
    guardar([empresaAutorizada(), empresaAutorizada({ rutEmpresa: '44444444-4' })]);
    guardar([empresaAutorizada({ rutEmpresa: '44444444-4' })], '2026-10-22T10:00:00.000Z');
    expect(store.empresasAutorizadas(RUT_EMPRESA).map((e) => e.rutEmpresa)).toEqual(['44444444-4']);
    expect(store.empresasAutorizadas(RUT_PERSONA).map((e) => e.rutEmpresa)).toEqual([RUT_EMPRESA]);
    guardar([], '2026-10-23T10:00:00.000Z');
    expect(store.empresasAutorizadas(RUT_EMPRESA)).toEqual([]);
  });

  it('revierte el reemplazo si falla una inserción (RUT repetido)', () => {
    guardar([empresaAutorizada()]);
    expect(() => guardar([empresaAutorizada({ rutEmpresa: '44444444-4' }), empresaAutorizada({ rutEmpresa: '44444444-4' })], '2026-10-22T10:00:00.000Z')).toThrow();
    expect(store.empresasAutorizadas(RUT_EMPRESA).map((e) => e.rutEmpresa)).toEqual(['33333333-3']);
  });

  it('la cuenta no es un período: periodosConDatos la ignora, aunque la sincronización sea ok', () => {
    guardar([empresaAutorizada()]);
    expect(store.periodosConDatos(RUT_EMPRESA)).toEqual([]);
  });
});
