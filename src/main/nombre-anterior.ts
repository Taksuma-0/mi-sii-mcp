import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { rutasDe, type Config } from './config.js';

/** Base con el nombre anterior de la herramienta (impuestocl), dentro de la carpeta de datos. */
export const DB_ANTERIOR = 'impuestocl.db';

export interface SistemaArchivos {
  existe(ruta: string): boolean;
  renombrar(desde: string, hacia: string): void;
}
const fsReal: SistemaArchivos = { existe: existsSync, renombrar: renameSync };

/**
 * Mudanza única desde el nombre anterior: mueve `~/.impuestocl` a `~/.mi-sii-mcp` y `impuestocl.db` a `mi-sii-mcp.db`.
 * Nunca pierde datos: si algo no se puede mover (otro proceso tiene la carpeta o la base abierta, o la base tiene un
 * `-wal`/`-shm` pendiente), sigue usando lo anterior y la mudanza se reintenta la próxima vez.
 */
export function conNombreAnterior(config: Config, fs: SistemaArchivos = fsReal): Config {
  let c = config;
  if (c.homeAnterior !== undefined && !fs.existe(c.home) && fs.existe(c.homeAnterior)) {
    try {
      fs.renombrar(c.homeAnterior, c.home);
    } catch {
      c = { ...c, ...rutasDe(c.homeAnterior) };
    }
  }
  const anterior = join(c.home, DB_ANTERIOR);
  if (!fs.existe(c.rutaDb) && fs.existe(anterior)) {
    // Con -wal o -shm la base está abierta o quedó a medio cerrar: moverla sin ellos perdería cambios.
    const abierta = fs.existe(`${anterior}-wal`) || fs.existe(`${anterior}-shm`);
    try {
      if (abierta) throw new Error('base abierta');
      fs.renombrar(anterior, c.rutaDb);
    } catch {
      c = { ...c, rutaDb: anterior };
    }
  }
  return c;
}
