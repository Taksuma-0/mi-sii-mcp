import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DepsApp } from '../app/deps.js';
import { capturarCookiesSii, type CookieNavegador, type OpcionesNavegador } from '../connectors/navegador/sesion-navegador.js';
import { LlaveroSistema } from '../connectors/secretos/llavero.js';
import { lectorPdfF29 } from '../connectors/sii/f29-pdf.js';
import { conSenal, type OpcionesHttp } from '../connectors/sii/http.js';
import { LectorPortalSii } from '../connectors/sii/lector.js';
import { GestorSesiones } from '../connectors/sii/sesiones.js';
import type { SecretStore } from '../ports/index.js';
import { ConsultaLibreSqlite } from '../store/sqlite/consulta-libre.js';
import { abrirDb } from '../store/sqlite/db.js';
import { SqliteStore } from '../store/sqlite/store.js';
import { cargarConfig, type Config } from './config.js';

export interface Contenedor {
  readonly config: Config;
  readonly deps: DepsApp;
  readonly sesiones: GestorSesiones;
  cerrar(): void;
}

export interface OpcionesContenedor {
  readonly config?: Config;
  readonly secretos?: SecretStore;
  readonly opcionesHttp?: OpcionesHttp;
  /** Reemplaza la apertura del navegador de `login-navegador` (las pruebas nunca lanzan uno real). */
  readonly capturarNavegador?: (opciones: OpcionesNavegador) => Promise<readonly CookieNavegador[]>;
}

export function crearContenedor(o: OpcionesContenedor = {}): Contenedor {
  const config = o.config ?? cargarConfig();
  mkdirSync(config.home, { recursive: true });
  const db = abrirDb(config.rutaDb);
  try {
    const capturar = o.capturarNavegador ?? capturarCookiesSii;
    const sesiones = new GestorSesiones(
      config.dirSesiones,
      o.secretos ?? new LlaveroSistema(),
      { intervaloMinMs: config.intervaloMinMs, plazoMs: config.plazoHttpMs, ...o.opcionesHttp },
      (opciones) => capturar({ plazoMs: config.plazoNavegadorMs, ...opciones }),
    );
    const deps: DepsApp = {
      store: new SqliteStore(db),
      consultaLibre: new ConsultaLibreSqlite(db),
      lectorPdfF29,
      sesiones,
      reloj: { ahora: () => new Date() },
      toleranciaPesos: config.toleranciaPesos,
      abrirSii: async (rut, sumidero, signal) => new LectorPortalSii(conSenal(await sesiones.sesionActiva(rut), signal), sumidero, lectorPdfF29),
      diagnostico: (nombre, contenido) => {
        mkdirSync(config.dirDiagnostico, { recursive: true });
        writeFileSync(join(config.dirDiagnostico, nombre), contenido, { mode: 0o600 });
      },
      alTerminarSync: (rut) => sesiones.persistir(rut),
    };
    return { config, deps, sesiones, cerrar: () => db.close() };
  } catch (error) {
    db.close();
    throw error;
  }
}
