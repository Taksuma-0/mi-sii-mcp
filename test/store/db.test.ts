import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { abrirDb, aplicarMigraciones, versionEsquema } from '../../src/store/sqlite/db.js';
import type { Db } from '../../src/store/sqlite/db.js';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
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
        'f29_lectura',
        'hallazgo',
      ]),
    );
  });

  it('la migración 4 crea la propuesta F29 y su lista solo admite propuesto o administrativo', () => {
    const db = nuevaDb();
    expect(MIGRACIONES.find((m) => m.version === 4)?.sql).toContain('f29_propuesta_valor');
    db.prepare("INSERT INTO sincronizacion (rut, superficie, periodo, iniciado_en) VALUES ('1', 'f29.propuesta', '2026-09', 't')").run();
    db.prepare("INSERT INTO f29_propuesta (rut, periodo, sin_propuesta, sincronizacion_id, obtenido_en) VALUES ('1', '2026-09', 0, 1, 't')").run();
    db.prepare("INSERT INTO f29_propuesta_valor (rut, periodo, lista, codigo, valor) VALUES ('1', '2026-09', 'propuesto', '520', 5)").run();
    expect(() => db.prepare("INSERT INTO f29_propuesta_valor (rut, periodo, lista, codigo, valor) VALUES ('1', '2026-09', 'otra', '520', 5)").run()).toThrow();
    expect(() => db.prepare("INSERT INTO f29_propuesta_valor (rut, periodo, lista, codigo, valor) VALUES ('1', '2026-09', 'propuesto', '520', 6)").run()).toThrow();
  });

  it('la migración 5 crea bhe_recibida con clave por receptor, emisor y folio, e índice por rut y periodo', () => {
    const db = nuevaDb();
    expect(MIGRACIONES.find((m) => m.version === 5)?.sql).toContain('bhe_recibida');
    db.prepare("INSERT INTO sincronizacion (rut, superficie, periodo, iniciado_en) VALUES ('1', 'bhe.recibidas', '2026-09', 't')").run();
    const insertar = (folio: number, anulada = 0) =>
      db
        .prepare(
          `INSERT INTO bhe_recibida (rut, periodo, rut_emisor, folio, nombre_emisor, fecha, bruto, retencion, liquido, sociedad_profesional, anulada, fecha_anulacion, sincronizacion_id, obtenido_en)
           VALUES ('1', '2026-09', '55555555-5', ?, NULL, NULL, 100, 15, 85, 0, ?, NULL, 1, 't')`,
        )
        .run(folio, anulada);
    insertar(1);
    expect(() => insertar(1)).toThrow();
    expect(() => insertar(2, 2)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'bhe_recibida' AND sql LIKE '%rut, periodo%'").all()).toHaveLength(1);
  });

  it('migra una base v1 con datos a la v2 agregando estado_id', () => {
    const db = new Database(':memory:');
    aplicarMigraciones(db, [MIGRACIONES[0]!]);
    db.prepare("INSERT INTO sincronizacion (rut, superficie, periodo, iniciado_en) VALUES ('1', 'f29', '2026-09', 't')").run();
    db.prepare("INSERT INTO f29_declaracion (rut, periodo, folio, estado, sincronizacion_id, obtenido_en) VALUES ('1', '2026-09', 5, 'Vigente', 1, 't')").run();
    aplicarMigraciones(db);
    expect(versionEsquema(db)).toBe(MIGRACIONES[MIGRACIONES.length - 1]!.version);
    expect(MIGRACIONES.length).toBeGreaterThanOrEqual(2);
    expect(db.prepare('SELECT folio, estado_id FROM f29_declaracion').get()).toEqual({ folio: 5, estado_id: null });
    db.close();
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

  it('migra de verdad una base v1 en archivo con MIGRACIONES y deja el respaldo -antes-v<última> con datos v1', () => {
    const ruta = join(carpeta(), 'real.db');
    conV1(ruta);
    const db = abrirDb(ruta);
    expect(versionEsquema(db)).toBe(MIGRACIONES[MIGRACIONES.length - 1]!.version);
    const columnas = (d: Db): string[] => (d.prepare('PRAGMA table_info(f29_declaracion)').all() as { name: string }[]).map((c) => c.name);
    expect(columnas(db)).toContain('estado_id');
    db.close();
    const respaldo = join(dirs[0]!, `real-antes-v${MIGRACIONES[MIGRACIONES.length - 1]!.version}.db`);
    const copia = new Database(respaldo, { readonly: true });
    expect(versionEsquema(copia)).toBe(1);
    expect(copia.prepare('SELECT COUNT(*) AS n FROM contribuyente').get()).toEqual({ n: 1 });
    expect(columnas(copia)).not.toContain('estado_id');
    copia.close();
  });

  it('si el respaldo falla no migra, no deja respaldo ni temporal parcial, y lanza RESPALDO_FALLIDO', () => {
    const ruta = join(carpeta(), 'datos.db');
    conV1(ruta);
    const copiarFallida = (_db: Db, destino: string): void => {
      writeFileSync(destino, 'parcial');
      throw new Error('disco lleno');
    };
    let error: unknown;
    try {
      abrirDb(ruta, [...MIGRACIONES.slice(0, 1), V2], copiarFallida);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorImpuestocl);
    expect((error as ErrorImpuestocl).codigo).toBe('RESPALDO_FALLIDO');
    expect((error as ErrorImpuestocl).accion).toContain('no se pudo respaldar');
    expect(readdirSync(dirs[0]!).filter((f) => f.includes('antes-v99'))).toEqual([]);
    // La conexión se cerró (se puede borrar el archivo) y la base quedó sin migrar.
    const intacta = new Database(ruta, { readonly: true });
    expect(versionEsquema(intacta)).toBe(1);
    intacta.close();
    rmSync(ruta, { force: true });
    expect(existsSync(ruta)).toBe(false);
  });

  it('el respaldo se escribe a un temporal y solo al terminar toma el nombre final', () => {
    const ruta = join(carpeta(), 'datos.db');
    conV1(ruta);
    const vistos: boolean[] = [];
    const copiar = (db: Db, destino: string): void => {
      vistos.push(destino.endsWith('.tmp'), existsSync(join(dirs[0]!, 'datos-antes-v99.db')));
      db.prepare('VACUUM INTO ?').run(destino);
    };
    abrirDb(ruta, [...MIGRACIONES.slice(0, 1), V2], copiar).close();
    expect(vistos).toEqual([true, false]);
    expect(existsSync(join(dirs[0]!, 'datos-antes-v99.db'))).toBe(true);
    expect(existsSync(join(dirs[0]!, 'datos-antes-v99.db.tmp'))).toBe(false);
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
