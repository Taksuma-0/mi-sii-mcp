import { ERRORES_FATALES, esErrorImpuestocl, type CodigoError } from '../domain/errores.js';
import type { RespuestaCruda } from '../domain/tipos.js';
import type { DepsApp } from './deps.js';

export interface ErrorSuperficie {
  readonly superficie: string;
  readonly codigo: string;
  readonly mensaje: string;
}

export interface ResultadoPeriodo {
  periodo: string;
  errores: ErrorSuperficie[];
  avisos: string[];
  documentos: number;
  f29Folio: number | null;
}

/** Motivo de término cuando quien pidió la sincronización la cancela (p. ej. Esc en el cliente MCP). */
export const SINCRONIZACION_CANCELADA: ErrorSuperficie = {
  superficie: 'cancelacion',
  codigo: 'CANCELADO',
  mensaje: 'Sincronización cancelada; se conservan los meses ya traídos.',
};

const DETALLE_SUPERFICIE_CANCELADA = 'La cancelación cortó la consulta al SII; esta superficie no escribió datos.';
const CODIGO_DATOS_INCOMPLETOS: CodigoError = 'DATOS_INCOMPLETOS';
/** El trabajo de una superficie lo devuelve cuando lo traído quedó incompleto y no debe reemplazar lo guardado. */
export const DATOS_INCOMPLETOS_RCV = Symbol('DATOS_INCOMPLETOS');

/**
 * Se lanza entre superficies o cuando la cancelación corta una consulta en curso; en ese caso la superficie no escribe
 * nada: lo ya guardado queda completo.
 */
export class Cancelada extends Error {}

export const revisarCancelacion = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw new Cancelada();
};

/**
 * Ejecuta una superficie dentro de su registro de sincronización. Devuelve null si falló de forma no fatal. Si la
 * superficie falla con `signal` cancelada, su registro queda como `CANCELADO` y se lanza `Cancelada`.
 */
export async function registrar<T>(
  deps: DepsApp,
  rut: string,
  superficie: string,
  periodo: string,
  buffer: RespuestaCruda[],
  res: ResultadoPeriodo,
  signal: AbortSignal | undefined,
  trabajo: (sincronizacionId: number, ahora: string) => Promise<T | typeof DATOS_INCOMPLETOS_RCV>,
): Promise<T | null> {
  const ahora = deps.reloj.ahora().toISOString();
  const id = deps.store.iniciarSincronizacion(rut, superficie, periodo, ahora);
  buffer.length = 0;
  try {
    const valor = await trabajo(id, ahora);
    volcar(deps, id, buffer);
    if (valor === DATOS_INCOMPLETOS_RCV) {
      const mensaje = 'El detalle RCV está incompleto; se conserva el último conjunto completo de este lado, si existe.';
      deps.store.terminarSincronizacion(id, deps.reloj.ahora().toISOString(), 'error', { codigo: CODIGO_DATOS_INCOMPLETOS, detalle: mensaje });
      res.errores.push({ superficie, codigo: CODIGO_DATOS_INCOMPLETOS, mensaje });
      return null;
    }
    deps.store.terminarSincronizacion(id, deps.reloj.ahora().toISOString(), 'ok');
    return valor;
  } catch (e) {
    volcar(deps, id, buffer);
    if (signal?.aborted) {
      deps.store.terminarSincronizacion(id, deps.reloj.ahora().toISOString(), 'error', { codigo: SINCRONIZACION_CANCELADA.codigo, detalle: DETALLE_SUPERFICIE_CANCELADA });
      throw new Cancelada();
    }
    if (!esErrorImpuestocl(e)) {
      deps.store.terminarSincronizacion(id, deps.reloj.ahora().toISOString(), 'error', { codigo: 'ERROR_INTERNO', detalle: String(e) });
      throw e;
    }
    deps.store.terminarSincronizacion(id, deps.reloj.ahora().toISOString(), 'error', { codigo: e.codigo, detalle: e.message });
    if (e.codigo === 'PORTAL_CAMBIO' || e.codigo === 'LECTURA_INCOHERENTE') {
      deps.diagnostico?.(`${rut}-${periodo}-${superficie}.json`, JSON.stringify({ error: e.toJSON(), detalle: e.detalle ?? null, respuestas: buffer }, null, 2));
    }
    if (ERRORES_FATALES.has(e.codigo)) throw e;
    res.errores.push({ superficie, codigo: e.codigo, mensaje: e.message });
    return null;
  }
}

export function volcar(deps: DepsApp, sincronizacionId: number, buffer: readonly RespuestaCruda[]): void {
  for (const r of buffer) deps.store.guardarRespuestaCruda(sincronizacionId, r);
}
