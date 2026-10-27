import { parsePeriodo } from '../domain/periodo.js';
import type { F29Valores, LecturaF29 } from '../domain/tipos.js';
import { lecturaConfiable, motivoNoConfiable } from '../reconciliation/coherencia-f29.js';
import { perfilExistente } from './consultas.js';
import type { DepsApp } from './deps.js';

/**
 * Qué pasó con cada PDF guardado: sus valores ya eran los guardados, se actualizaron, el lector no pudo leerlo, la
 * lectura nueva no era confiable y se conservó la guardada, o el folio ya no está declarado (no se escribe).
 */
export type ResultadoRelectura = 'sin_cambios' | 'actualizado' | 'ilegible' | 'incoherente_conservado' | 'sin_declaracion';

export interface FolioReleido {
  readonly periodo: string;
  readonly folio: number;
  readonly resultado: ResultadoRelectura;
  /** Códigos que aparecen, desaparecen o cambian de valor; vacío salvo en `actualizado`. */
  readonly codigosCambiados: readonly string[];
  /** Por qué no se leyó o no se reemplazó; en `actualizado`, el aviso si la lectura nueva no es confiable. */
  readonly mensaje: string | null;
}

export interface ResultadoReleerF29 {
  readonly rut: string;
  readonly versionLector: string;
  readonly folios: readonly FolioReleido[];
}

/**
 * Anti-regresión de la lectura de un folio, la misma en la sincronización y en la relectura: si la lectura nueva no es
 * confiable y la guardada sí, devuelve por qué la nueva no lo es (y se conserva la guardada); si no, null.
 */
export function motivoParaConservar(nueva: F29Valores, guardada: F29Valores | null): string | null {
  const motivo = motivoNoConfiable(nueva);
  return motivo !== null && lecturaConfiable(guardada) ? motivo : null;
}

function codigosCambiados(antes: Readonly<Record<string, number>>, despues: Readonly<Record<string, number>>): string[] {
  const codigos = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  return [...codigos].filter((c) => antes[c] !== despues[c]).sort();
}

/**
 * Relee con el lector actual los PDF del F29 ya guardados como evidencia (el más nuevo de cada período y folio) y
 * actualiza los valores de cada folio declarado, con la misma anti-regresión que la sincronización. Nunca abre el SII.
 */
export async function releerF29(deps: DepsApp, rutTexto: string, desde?: string, hasta?: string): Promise<ResultadoReleerF29> {
  const desdeTexto = desde === undefined ? undefined : parsePeriodo(desde).texto;
  const hastaTexto = hasta === undefined ? undefined : parsePeriodo(hasta).texto;
  const { rut } = perfilExistente(deps, rutTexto);
  const lector = deps.lectorPdfF29;
  const folios: FolioReleido[] = [];
  for (const pdf of deps.store.pdfsF29Guardados(rut, desdeTexto, hastaTexto)) {
    const { periodo, folio } = pdf;
    const resultado = (r: ResultadoRelectura, mensaje: string | null = null, cambiados: readonly string[] = []): void => {
      folios.push({ periodo, folio, resultado: r, codigosCambiados: cambiados, mensaje });
    };
    if (!deps.store.declaracionesF29(rut, periodo).some((d) => d.folio === folio)) {
      resultado('sin_declaracion');
      continue;
    }
    let leidos: Record<string, number>;
    try {
      leidos = await lector.extraer(pdf.bytes);
    } catch {
      resultado('ilegible', `No se pudo leer el PDF del F29 de ${periodo} (folio ${folio}).`);
      continue;
    }
    if (Object.keys(leidos).length === 0) {
      resultado('ilegible', `El PDF del F29 de ${periodo} (folio ${folio}) no trajo códigos legibles.`);
      continue;
    }
    const nueva: F29Valores = { rut, periodo, folio, valores: leidos, versionLector: lector.version };
    const guardada = deps.store.valoresF29(rut, periodo, folio);
    const conservar = motivoParaConservar(nueva, guardada);
    if (conservar !== null) {
      resultado('incoherente_conservado', `La lectura del folio ${folio} ${conservar}; se conserva la lectura guardada.`);
      continue;
    }
    const lectura: LecturaF29 = { versionLector: lector.version, origen: 'relectura', leidoEn: deps.reloj.ahora().toISOString(), coherente: lecturaConfiable(nueva) };
    const cambiados = codigosCambiados(guardada?.valores ?? {}, leidos);
    if (cambiados.length === 0) {
      // Mismos valores: solo se anota la lectura si cambia lo que dice de ella, así repetir no escribe nada.
      const anterior = deps.store.lecturaF29(rut, periodo, folio);
      if (anterior === null || anterior.versionLector !== lectura.versionLector || anterior.coherente !== lectura.coherente) {
        deps.store.reemplazarValoresFolioF29(rut, periodo, folio, leidos, lectura);
      }
      resultado('sin_cambios');
      continue;
    }
    deps.store.reemplazarValoresFolioF29(rut, periodo, folio, leidos, lectura);
    const motivo = motivoNoConfiable(nueva);
    resultado('actualizado', motivo === null ? null : `La lectura ${motivo}.`, cambiados);
  }
  return { rut, versionLector: lector.version, folios };
}
