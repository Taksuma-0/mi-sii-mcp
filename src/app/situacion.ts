import type { Aviso } from '../domain/avisos.js';
import { avisosDeSituacion, type SituacionSii } from '../domain/situacion-sii.js';
import { perfilExistente } from './consultas.js';
import type { DepsApp } from './deps.js';

export interface ResultadoSituacion extends SituacionSii {
  readonly rut: string;
  readonly consultadoEn: string;
  /** Avisos que esta consulta sumó a novedades; los ya conocidos no se repiten. */
  readonly nuevos: readonly Aviso[];
}

/**
 * Consulta en Mi SII, con la sesión guardada, las anotaciones vigentes, el estado de cumplimiento y los mensajes, y
 * registra como aviso cada anotación y cada requisito incumplido. Solo lee el SII; no se guarda el texto crudo.
 */
export async function consultarSituacionSii(deps: DepsApp, rutTexto: string, signal?: AbortSignal): Promise<ResultadoSituacion> {
  const rut = perfilExistente(deps, rutTexto).rut;
  try {
    const sii = await deps.abrirSii(rut, () => {}, signal);
    const situacion = await sii.situacionSii(rut);
    const ahora = deps.reloj.ahora().toISOString();
    return { ...situacion, rut, consultadoEn: ahora, nuevos: deps.store.registrarAvisos(avisosDeSituacion(rut, situacion), ahora) };
  } finally {
    deps.alTerminarSync?.(rut);
  }
}
