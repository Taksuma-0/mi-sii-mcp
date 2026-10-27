import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { abrirDb, aplicarMigraciones, versionEsquema } from '../../src/store/sqlite/db.js';
import type { Db } from '../../src/store/sqlite/db.js';
import { MIGRACIONES, type Migracion } from '../../src/store/sqlite/migraciones.js';
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
    const ultima = MIGRACIONES[MIGRACIONES.length - 1]!.version;
    expect(versionEsquema(db)).toBe(ultima);
    aplicarMigraciones(db);
    expect(versionEsquema(db)).toBe(ultima);
    expect(db.prepare('SELECT COUNT(*) AS cantidad FROM migracion').get()).toEqual({ cantidad: MIGRACIONES.length });
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

describe('respaldo antes de migrar', () => {
  const dirs: string[] = [];
  const carpeta = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'impuestocl-db-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const V2: Migracion = { version: 99, sql: 'ALTER TABLE contribuyente ADD COLUMN nota TEXT;' };
  const conV1 = (ruta: string): void => {
    const db = new Database(ruta);
    aplicarMigraciones(db, [MIGRACIONES[0]!]);
    db.prepare("INSERT INTO contribuyente (rut, alias, tipo) VALUES ('11111111-1', 'Demo', 'persona')").run();
    db.close();
  };

  it('respalda una vez la base en archivo antes de aplicar una migración pendiente', () => {
    const ruta = join(carpeta(), 'datos.db');
    conV1(ruta);
    const respaldo = join(dirs[0]!, 'datos-antes-v99.db');

    const db = abrirDb(ruta, [...MIGRACIONES.slice(0, 1), V2]);
    expect(versionEsquema(db)).toBe(99);
    expect(existsSync(respaldo)).toBe(true);
    const copia = new Database(respaldo, { readonly: true });
    expect(versionEsquema(copia)).toBe(1);
    expect(copia.prepare('SELECT COUNT(*) AS n FROM contribuyente').get()).toEqual({ n: 1 });
    copia.close();
    db.close();
  });

  it('no sobrescribe un respaldo que ya existe', () => {
    const ruta = join(carpeta(), 'datos.db');
    conV1(ruta);
    const respaldo = join(dirs[0]!, 'datos-antes-v99.db');
    const previo = new Database(respaldo);
    previo.exec('CREATE TABLE marca (x INTEGER)');
    previo.close();

    abrirDb(ruta, [...MIGRACIONES.slice(0, 1), V2]).close();
    const copia = new Database(respaldo, { readonly: true });
    expect(copia.prepare("SELECT name FROM sqlite_master WHERE name = 'marca'").all()).toHaveLength(1);
    copia.close();
  });

  it('no respalda una base nueva, una al día ni una en memoria', () => {
    const ruta = join(carpeta(), 'nueva.db');
    abrirDb(ruta, [...MIGRACIONES.slice(0, 1), V2]).close();
    expect(existsSync(join(dirs[0]!, 'nueva-antes-v99.db'))).toBe(false);
    abrirDb(ruta, [...MIGRACIONES.slice(0, 1), V2]).close();
    expect(existsSync(join(dirs[0]!, 'nueva-antes-v99.db'))).toBe(false);
    const memoria = abrirDb(':memory:', [...MIGRACIONES.slice(0, 1), V2]);
    expect(versionEsquema(memoria)).toBe(99);
    memoria.close();
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
