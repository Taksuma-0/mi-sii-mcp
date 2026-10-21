import Database from 'better-sqlite3';
import { MIGRACIONES } from './migraciones.js';

export type Db = Database.Database;

export function abrirDb(ruta: string): Db {
  const db = new Database(ruta);
  if (ruta !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  aplicarMigraciones(db);
  return db;
}

export function versionEsquema(db: Db): number {
  return (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM migracion').get() as { v: number }).v;
}

export function aplicarMigraciones(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS migracion (version INTEGER PRIMARY KEY, aplicada_en TEXT NOT NULL)');
  const actual = versionEsquema(db);
  for (const m of MIGRACIONES) {
    if (m.version <= actual) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO migracion (version, aplicada_en) VALUES (?, ?)').run(m.version, new Date().toISOString());
    })();
  }
}
