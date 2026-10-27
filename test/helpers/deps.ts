import type { DepsApp } from '../../src/app/deps.js';
import { ConsultaLibreSqlite } from '../../src/store/sqlite/consulta-libre.js';
import { abrirDb, type Db } from '../../src/store/sqlite/db.js';
import { SqliteStore } from '../../src/store/sqlite/store.js';
import { LectorPdfFalso } from './lector-falso.js';
import { SiiFalso } from './sii-falso.js';

export interface DepsDePrueba {
  readonly deps: DepsApp;
  readonly store: SqliteStore;
  readonly db: Db;
  readonly sii: SiiFalso;
  readonly lector: LectorPdfFalso;
  readonly diagnosticos: { nombre: string; contenido: string }[];
  readonly persistidos: string[];
}

export function depsDePrueba(o: { ahora?: string; tolerancia?: number; fallaAlAbrir?: Error } = {}): DepsDePrueba {
  const db = abrirDb(':memory:');
  const store = new SqliteStore(db);
  const sii = new SiiFalso();
  const lector = new LectorPdfFalso();
  const diagnosticos: { nombre: string; contenido: string }[] = [];
  const persistidos: string[] = [];
  const deps: DepsApp = {
    store,
    consultaLibre: new ConsultaLibreSqlite(db),
    lectorPdfF29: lector,
    toleranciaPesos: o.tolerancia ?? 0,
    reloj: { ahora: () => new Date(o.ahora ?? '2026-10-21T15:00:00.000Z') },
    sesiones: { estado: () => ({ tieneSesion: true, guardadaEn: '2026-10-21T10:00:00.000Z', bloqueado: false }) },
    abrirSii: async (_rut, sumidero) => {
      if (o.fallaAlAbrir) throw o.fallaAlAbrir;
      sii.sumidero = sumidero;
      return sii;
    },
    diagnostico: (nombre, contenido) => {
      diagnosticos.push({ nombre, contenido });
    },
    alTerminarSync: (rut) => {
      persistidos.push(rut);
    },
  };
  return { deps, store, db, sii, lector, diagnosticos, persistidos };
}

/** Las mismas dependencias con otra versión del lector de PDF del F29, como tras actualizar mi-sii-mcp. */
export function conLector(deps: DepsApp, version: string): DepsApp {
  return { ...deps, lectorPdfF29: new LectorPdfFalso(version) };
}
