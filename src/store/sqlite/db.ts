import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { MIGRACIONES, type Migracion } from './migraciones.js';

export type Db = Database.Database;

export function abrirDb(ruta: string, migraciones: readonly Migracion[] = MIGRACIONES): Db {
  const db = new Database(ruta);
  if (ruta !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  if (ruta !== ':memory:') respaldarAntesDeMigrar(db, ruta, migraciones);
  aplicarMigraciones(db, migraciones);
  return db;
}

function versionGuardada(db: Db): number {
  const hayTabla = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migracion'").get() !== undefined;
  return hayTabla ? versionEsquema(db) : 0;
}

/**
 * Antes de cambiar el esquema de una base que ya tenía datos, deja una copia íntegra junto a ella
 * (`<ruta sin .db>-antes-v<N>.db`, con N la versión destino). Si esa copia ya existe no la pisa.
 */
function respaldarAntesDeMigrar(db: Db, ruta: string, migraciones: readonly Migracion[]): void {
  const actual = versionGuardada(db);
  const destino = migraciones.reduce((mayor, m) => Math.max(mayor, m.version), 0);
  if (actual < 1 || destino <= actual) return;
  const respaldo = `${ruta.replace(/\.db$/i, '')}-antes-v${destino}.db`;
  if (existsSync(respaldo)) return;
  db.prepare('VACUUM INTO ?').run(respaldo);
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
