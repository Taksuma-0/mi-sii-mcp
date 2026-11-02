import type { ResultadoRespaldo } from '../ports/index.js';
import type { DepsApp } from './deps.js';

export interface ResumenMantenimiento {
  /** Respuestas crudas viejas que se borraron. */
  readonly podadas: number;
  /** «ok» o el problema que encontró PRAGMA quick_check. */
  readonly integridad: string;
  /** El respaldo del día, o null si no hay dónde respaldar o falló. */
  readonly respaldo: ResultadoRespaldo | null;
}

/**
 * Mantenimiento diario de la base local: poda de respuestas crudas viejas, revisión de integridad y respaldo rotativo.
 * Cada paso falla por separado sin detener a los demás ni a la revisión diaria.
 */
export async function mantenimientoDiario(deps: DepsApp, ahora: Date): Promise<ResumenMantenimiento> {
  const podadas = podarSinRomper(deps);
  let integridad: string;
  try {
    integridad = deps.store.integridad();
  } catch (e) {
    integridad = `no se pudo revisar: ${e instanceof Error ? e.message : String(e)}`;
  }
  let respaldo: ResultadoRespaldo | null = null;
  try {
    respaldo = deps.respaldos ? await deps.respaldos.crear(ahora) : null;
  } catch {
    respaldo = null;
  }
  return { podadas, integridad, respaldo };
}

/** Poda las respuestas crudas viejas; un error aquí nunca debe costar una sincronización. */
export function podarSinRomper(deps: DepsApp): number {
  try {
    return deps.store.podarRespuestasCrudas();
  } catch {
    return 0;
  }
}
