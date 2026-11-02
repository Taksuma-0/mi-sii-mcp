import type { AvisoCandidato } from './avisos.js';

/**
 * Anotación vigente de Mi SII: una restricción que el SII impone en algún trámite (p. ej. timbrar facturas o emitir
 * documentos) hasta que se regularice. Solo trae textos del SII: código, cantidad, fecha y su descripción.
 */
export interface AnotacionSii {
  readonly codigo: string;
  readonly cantidad: number;
  /** Fecha de activación AAAA-MM-DD; null si el SII no la informó. */
  readonly fechaActivacion: string | null;
  readonly descripcion: string;
  readonly accion: string;
}

/** Un requisito del «Estado de cumplimiento de las obligaciones tributarias» de Mi SII. */
export interface RequisitoCumplimiento {
  readonly codigo: string;
  readonly condicion: string | null;
  readonly titulo: string;
  /** null si el SII no dijo SI ni NO. */
  readonly cumple: boolean | null;
}

export interface CumplimientoSii {
  readonly estado: string | null;
  readonly periodo: string | null;
  readonly requisitos: readonly RequisitoCumplimiento[];
}

/** Mensaje informativo de la portada de Mi SII. */
export interface MensajeSii {
  readonly titulo: string;
  readonly descripcion: string;
  readonly solucion: string | null;
}

/** Lo que Mi SII muestra al contribuyente sobre su situación: anotaciones, cumplimiento y mensajes. */
export interface SituacionSii {
  readonly anotaciones: readonly AnotacionSii[];
  readonly cumplimiento: CumplimientoSii | null;
  readonly mensajes: readonly MensajeSii[];
}

/** Largo máximo del detalle de un aviso: la descripción completa se ve con sii_avisos. */
const MAX_DETALLE = 600;
const recortar = (texto: string): string => (texto.length <= MAX_DETALLE ? texto : `${texto.slice(0, MAX_DETALLE - 1)}…`);

/**
 * Avisos de la situación en Mi SII: uno por anotación vigente (por su código y fecha de activación, para avisar de nuevo
 * si se reactiva) y uno por requisito de cumplimiento que no se cumple.
 */
export function avisosDeSituacion(rut: string, s: SituacionSii): AvisoCandidato[] {
  const anotaciones = s.anotaciones.map(
    (a): AvisoCandidato => ({
      rut,
      clave: `A:${a.codigo}:${a.fechaActivacion ?? ''}`,
      tipo: 'anotacion',
      severidad: 'advertencia',
      titulo: `Anotación del SII ${a.codigo}${a.fechaActivacion ? ` (desde ${a.fechaActivacion})` : ''}`,
      detalle: recortar(`${a.descripcion} Qué hacer: ${a.accion}`),
    }),
  );
  const requisitos = (s.cumplimiento?.requisitos ?? [])
    .filter((r) => r.cumple === false)
    .map(
      (r): AvisoCandidato => ({
        rut,
        clave: `C:${r.codigo}:${s.cumplimiento?.periodo ?? ''}`,
        tipo: 'anotacion',
        severidad: 'advertencia',
        titulo: `No cumple un requisito del SII: ${r.titulo}`,
        detalle: 'Mi SII lo muestra en «Estado de cumplimiento de las obligaciones tributarias»: revísalo ahí o con tu contador.',
      }),
    );
  return [...anotaciones, ...requisitos];
}
