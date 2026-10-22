import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DepsApp } from '../app/deps.js';
import { LlaveroSistema } from '../connectors/secretos/llavero.js';
import type { OpcionesHttp } from '../connectors/sii/http.js';
import { LectorPortalSii } from '../connectors/sii/lector.js';
import { GestorSesiones } from '../connectors/sii/sesiones.js';
import type { SecretStore } from '../ports/index.js';
import { abrirDb } from '../store/sqlite/db.js';
import { SqliteStore } from '../store/sqlite/store.js';
import { cargarConfig, type Config } from './config.js';

export interface Contenedor {
  readonly config: Config;
  readonly deps: DepsApp;
  readonly sesiones: GestorSesiones;
  cerrar(): void;
}

export function crearContenedor(o: { config?: Config; secretos?: SecretStore; opcionesHttp?: OpcionesHttp } = {}): Contenedor {
  const config = o.config ?? cargarConfig();
  mkdirSync(config.home, { recursive: true });
  const db = abrirDb(config.rutaDb);
  const sesiones = new GestorSesiones(config.dirSesiones, o.secretos ?? new LlaveroSistema(), { intervaloMinMs: config.intervaloMinMs, ...o.opcionesHttp });
  const deps: DepsApp = {
    store: new SqliteStore(db),
    sesiones,
    reloj: { ahora: () => new Date() },
    toleranciaPesos: config.toleranciaPesos,
    abrirSii: async (rut, sumidero) => new LectorPortalSii(await sesiones.sesionActiva(rut), sumidero),
    diagnostico: (nombre, contenido) => {
      mkdirSync(config.dirDiagnostico, { recursive: true });
      writeFileSync(join(config.dirDiagnostico, nombre), contenido, { mode: 0o600 });
    },
    alTerminarSync: (rut) => sesiones.persistir(rut),
  };
  return { config, deps, sesiones, cerrar: () => db.close() };
}
