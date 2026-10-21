import { afterEach, describe, expect, it } from 'vitest';
import { abrirDb, aplicarMigraciones, versionEsquema } from '../../src/store/sqlite/db.js';
import type { Db } from '../../src/store/sqlite/db.js';
import { sha256, SqliteStore } from '../../src/store/sqlite/store.js';
import { perfilEmpresa, perfilPersona, RUT_EMPRESA, RUT_PERSONA } from '../helpers/fabricas.js';

const bases: Db[] = [];
const nuevaDb = (): Db => {
  const db = abrirDb(':memory:');
  bases.push(db);
  return db;
};

afterEach(() => {
  for (const db of bases.splice(0)) db.close();
});

describe('db', () => {
  it('aplica las migraciones una sola vez y crea todas las tablas', () => {
    const db = nuevaDb();
    expect(versionEsquema(db)).toBe(1);
    aplicarMigraciones(db);
    expect(versionEsquema(db)).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS cantidad FROM migracion').get()).toEqual({ cantidad: 1 });
    const tablas = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tablas).toEqual(
      expect.arrayContaining([
        'contribuyente',
        'sincronizacion',
        'respuesta_cruda',
        'rcv_resumen',
        'rcv_documento',
        'rcv_documento_snapshot',
        'f29_declaracion',
        'f29_valor',
        'hallazgo',
      ]),
    );
  });

  it('activa las claves foráneas y rechaza respuestas sin sincronización', () => {
    const db = nuevaDb();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    const store = new SqliteStore(db);
    expect(() => store.guardarRespuestaCruda(999, {
      superficie: 'rcv.resumen',
      parametros: {},
      cuerpo: '{}',
      obtenidoEn: '2026-10-21T10:00:00.000Z',
    })).toThrow(/FOREIGN KEY/);
  });
});

describe('SqliteStore: contribuyentes y sincronizaciones', () => {
  it('guarda y actualiza perfiles sin perder la razón social conocida', () => {
    const store = new SqliteStore(nuevaDb());
    store.guardarContribuyente(perfilEmpresa());
    store.guardarContribuyente(perfilEmpresa({ alias: 'Pyme', razonSocial: null }));
    expect(store.contribuyente(RUT_EMPRESA)).toEqual(perfilEmpresa({ alias: 'Pyme' }));
    expect(store.contribuyentes()).toHaveLength(1);
    expect(store.contribuyente(RUT_PERSONA)).toBeNull();
    store.guardarContribuyente(perfilEmpresa({ razonSocial: 'EMPRESA DEMO ACTUALIZADA SPA' }));
    expect(store.contribuyente(RUT_EMPRESA)?.razonSocial).toBe('EMPRESA DEMO ACTUALIZADA SPA');
  });

  it('conserva los representantes y lista los perfiles por alias', () => {
    const store = new SqliteStore(nuevaDb());
    expect(store.contribuyentes()).toEqual([]);
    store.guardarContribuyente(perfilPersona({ alias: 'Zeta' }));
    store.guardarContribuyente(perfilEmpresa({ alias: 'Alfa' }));
    expect(store.contribuyentes()).toEqual([
      perfilEmpresa({ alias: 'Alfa' }),
      perfilPersona({ alias: 'Zeta' }),
    ]);
    store.guardarContribuyente(perfilPersona({ representa: [] }));
    expect(store.contribuyente(RUT_PERSONA)).toEqual(perfilPersona({ representa: [] }));
  });

  it('registra sincronizaciones y respuestas crudas con su hash', () => {
    const db = nuevaDb();
    const store = new SqliteStore(db);
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'rcv.COMPRA', '2026-09', '2026-10-21T10:00:00.000Z');
    expect(id).toBeGreaterThan(0);
    expect(db.prepare('SELECT rut, superficie, periodo, iniciado_en, terminado_en, estado FROM sincronizacion WHERE id = ?').get(id)).toEqual({
      rut: RUT_EMPRESA,
      superficie: 'rcv.COMPRA',
      periodo: '2026-09',
      iniciado_en: '2026-10-21T10:00:00.000Z',
      terminado_en: null,
      estado: 'en_curso',
    });
    store.guardarRespuestaCruda(id, { superficie: 'rcv.resumen', parametros: { a: 1 }, cuerpo: '{"x":1}', obtenidoEn: '2026-10-21T10:00:00.500Z' });
    store.terminarSincronizacion(id, '2026-10-21T10:00:01.000Z', 'error', { codigo: 'PORTAL_CAMBIO', detalle: 'algo' });
    expect(db.prepare('SELECT estado, terminado_en, error_codigo, error_detalle FROM sincronizacion WHERE id = ?').get(id)).toEqual({
      estado: 'error', terminado_en: '2026-10-21T10:00:01.000Z', error_codigo: 'PORTAL_CAMBIO', error_detalle: 'algo',
    });
    const cruda = db.prepare('SELECT sincronizacion_id, superficie, parametros_json, cuerpo, sha256, obtenido_en FROM respuesta_cruda').get();
    expect(cruda).toEqual({
      sincronizacion_id: id,
      superficie: 'rcv.resumen',
      parametros_json: '{"a":1}',
      cuerpo: '{"x":1}',
      sha256: sha256('{"x":1}'),
      obtenido_en: '2026-10-21T10:00:00.500Z',
    });
  });

  it('finaliza una sincronización correcta sin datos de error', () => {
    const db = nuevaDb();
    const store = new SqliteStore(db);
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f29', '2026-09', '2026-10-21T10:00:00.000Z');
    store.terminarSincronizacion(id, '2026-10-21T10:00:01.000Z', 'ok');
    expect(db.prepare('SELECT estado, terminado_en, error_codigo, error_detalle FROM sincronizacion WHERE id = ?').get(id)).toEqual({
      estado: 'ok', terminado_en: '2026-10-21T10:00:01.000Z', error_codigo: null, error_detalle: null,
    });
  });
});

describe('sha256', () => {
  it('devuelve el hash hexadecimal SHA-256 conocido', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
