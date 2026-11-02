import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fechaEnSantiago } from '../domain/fechas.js';
import type { Respaldos, ResultadoRespaldo, Store } from '../ports/index.js';

/** Respaldos que se conservan: los de los últimos días con revisión. */
const RESPALDOS_CONSERVADOS = 3;
const NOMBRE_RESPALDO = /^mi-sii-mcp-\d{4}-\d{2}-\d{2}\.db$/;

/**
 * Un respaldo por día de la base (`mi-sii-mcp-AAAA-MM-DD.db`, fecha de Chile) en la carpeta de respaldos, con VACUUM
 * INTO; quedan los 3 más nuevos. Protege de una base dañada o de un error al borrar datos (decisión 0010).
 */
export class RespaldosLocales implements Respaldos {
  constructor(
    private readonly carpeta: string,
    private readonly store: Pick<Store, 'respaldarEn'>,
  ) {}

  async crear(ahora: Date): Promise<ResultadoRespaldo> {
    const ruta = join(this.carpeta, `mi-sii-mcp-${fechaEnSantiago(ahora)}.db`);
    if (existsSync(ruta)) return { ruta, creado: false, borrados: 0 };
    mkdirSync(this.carpeta, { recursive: true });
    this.store.respaldarEn(ruta);
    const sobrantes = this.respaldos().slice(RESPALDOS_CONSERVADOS);
    for (const viejo of sobrantes) rmSync(join(this.carpeta, viejo), { force: true });
    return { ruta, creado: true, borrados: sobrantes.length };
  }

  ultimo(): string | null {
    const [masNuevo] = this.respaldos();
    return masNuevo === undefined ? null : join(this.carpeta, masNuevo);
  }

  /** Nombres de los respaldos, del más nuevo al más viejo. */
  private respaldos(): string[] {
    if (!existsSync(this.carpeta)) return [];
    return readdirSync(this.carpeta)
      .filter((n) => NOMBRE_RESPALDO.test(n))
      .sort()
      .reverse();
  }
}
