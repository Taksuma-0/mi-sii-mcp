import Database from 'better-sqlite3';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { ErrorMiSiiMcp } from '../../domain/errores.js';
import { MIGRACIONES, type Migracion } from './migraciones.js';

export type Db = Database.Database;

/** Escribe una copia íntegra de la base en `destino`. Inyectable para probar el fallo del respaldo. */
export type CopiarBase = (db: Db, destino: string) => void;

const copiarConVacuum: CopiarBase = (db, destino) => {
  db.prepare('VACUUM INTO ?').run(destino);
};

export function abrirDb(ruta: string, migraciones: readonly Migracion[] = MIGRACIONES, copiar: CopiarBase = copiarConVacuum): Db {
  const db = new Database(ruta);
  try {
    if (ruta !== ':memory:') db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    if (ruta !== ':memory:') respaldarAntesDeMigrar(db, ruta, migraciones, copiar);
    aplicarMigraciones(db, migraciones);
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}

function versionGuardada(db: Db): number {
  const hayTabla = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migracion'").get() !== undefined;
  return hayTabla ? versionEsquema(db) : 0;
}

/**
 * Antes de cambiar el esquema de una base que ya tenía datos, deja una copia íntegra junto a ella
 * (`<ruta sin .db>-antes-v<N>.db`, con N la versión destino). Si esa copia ya existe no la pisa. Se escribe a un `.tmp`
 * y solo toma el nombre final si terminó bien; si falla no queda copia parcial y no se migra.
 */
function respaldarAntesDeMigrar(db: Db, ruta: string, migraciones: readonly Migracion[], copiar: CopiarBase): void {
  const actual = versionGuardada(db);
  const destino = migraciones.reduce((mayor, m) => Math.max(mayor, m.version), 0);
  if (actual < 1 || destino <= actual) return;
  const respaldo = `${ruta.replace(/\.db$/i, '')}-antes-v${destino}.db`;
  if (existsSync(respaldo)) return;
  const temporal = `${respaldo}.tmp`;
  try {
    rmSync(temporal, { force: true });
    copiar(db, temporal);
    renameSync(temporal, respaldo);
  } catch (e) {
    try {
      rmSync(temporal, { force: true });
    } catch {
      // Sin permiso para borrar el temporal: el error original es el que importa.
    }
    throw new ErrorMiSiiMcp('RESPALDO_FALLIDO', `No se pudo respaldar la base antes de migrar: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

export function versionEsquema(db: Db): number {
  return (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM migracion').get() as { v: number }).v;
}

export function aplicarMigraciones(db: Db, lista: readonly Migracion[] = MIGRACIONES): void {
  db.exec('CREATE TABLE IF NOT EXISTS migracion (version INTEGER PRIMARY KEY, aplicada_en TEXT NOT NULL)');
  const actual = versionEsquema(db);
  for (const m of lista) {
    if (m.version <= actual) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO migracion (version, aplicada_en) VALUES (?, ?)').run(m.version, new Date().toISOString());
    })();
  }
}
