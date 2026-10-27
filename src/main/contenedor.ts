import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DepsApp } from '../app/deps.js';
import { capturarCookiesSii, type CookieNavegador, type OpcionesNavegador } from '../connectors/navegador/sesion-navegador.js';
import { LlaveroSistema } from '../connectors/secretos/llavero.js';
import { lectorPdfF29 } from '../connectors/sii/f29-pdf.js';
import { conSenal, type OpcionesHttp } from '../connectors/sii/http.js';
import { LectorPortalSii } from '../connectors/sii/lector.js';
import { LectorPorRepresentacion } from '../connectors/sii/representacion.js';
import { GestorSesiones } from '../connectors/sii/sesiones.js';
import type { SecretStore } from '../ports/index.js';
import { ConsultaLibreSqlite } from '../store/sqlite/consulta-libre.js';
import { abrirDb } from '../store/sqlite/db.js';
import { SqliteStore } from '../store/sqlite/store.js';
import { parseRut } from '../domain/rut.js';
import { cargarConfig, type Config } from './config.js';
import { conNombreAnterior } from './nombre-anterior.js';

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

/** El llavero del sistema (Credential Manager en Windows), para las interfaces que no deben importar conectores. */
export const crearLlavero = (): SecretStore => new LlaveroSistema();

export function crearContenedor(o: OpcionesContenedor = {}): Contenedor {
  const config = conNombreAnterior(o.config ?? cargarConfig());
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
    const store = new SqliteStore(db);
    /** Con qué identidad se entra por `rut`: la de `accedeCon` si el contribuyente no tiene sesión propia guardada. */
    const rutDeAcceso = (rut: string): string | null => {
      const canonico = parseRut(rut).canonico;
      const accedeCon = store.contribuyente(canonico)?.accedeCon;
      return accedeCon && accedeCon !== canonico && !sesiones.estado(canonico).tieneSesion ? accedeCon : null;
    };
    const deps: DepsApp = {
      store,
      consultaLibre: new ConsultaLibreSqlite(db),
      lectorPdfF29,
      sesiones,
      reloj: { ahora: () => new Date() },
      toleranciaPesos: config.toleranciaPesos,
      abrirSii: async (rut, sumidero, signal) => {
        const acceso = rutDeAcceso(rut);
        if (acceso === null) return new LectorPortalSii(conSenal(await sesiones.sesionActiva(rut), signal), sumidero, lectorPdfF29);
        // Las áreas que exigen sesión propia fallan sin abrir la de quien accede: solo el RCV la abre.
        return new LectorPorRepresentacion(async () => new LectorPortalSii(conSenal(await sesiones.sesionActiva(acceso), signal), sumidero, lectorPdfF29), acceso);
      },
      diagnostico: (nombre, contenido) => {
        mkdirSync(config.dirDiagnostico, { recursive: true });
        writeFileSync(join(config.dirDiagnostico, nombre), contenido, { mode: 0o600 });
      },
      alTerminarSync: (rut) => sesiones.persistir(rutDeAcceso(rut) ?? rut),
    };
    return { config, deps, sesiones, cerrar: () => db.close() };
  } catch (error) {
    db.close();
    throw error;
  }
}
