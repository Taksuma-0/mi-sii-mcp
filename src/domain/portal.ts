/**
 * Lo que mi-sii-mcp sabe de la forma de las respuestas del SII, para notar cuándo cambian y adaptarse sin guardar datos
 * malos (decisión 0010). Solo nombres de campos y totales de control: nunca valores de un contribuyente.
 */
export type TipoCambioPortal = 'aditivo' | 'reparado' | 'roto';

/** Un cambio detectado en una respuesta del SII: campos nuevos, un nombre reemplazado (reparado) o una lectura que falló. */
export interface CambioPortal {
  readonly id: number;
  readonly superficie: string;
  readonly tipo: TipoCambioPortal;
  readonly detalle: unknown;
  readonly detectadoEn: string;
}

/** Nombre nuevo de un campo que se adoptó porque sus totales cuadraron al peso con los del SII. */
export interface AliasAprendido {
  readonly superficie: string;
  readonly campo: string;
  readonly alias: string;
  readonly aprendidoEn: string;
  /** Cómo se comprobó (p. ej. «suma 100.000 = resumen 33 2026-09»), sin RUT ni nombres. */
  readonly evidencia: string;
}

/** Forma conocida de una superficie: rutas de campos (sin valores) vistas alguna vez. */
export interface HuellaPortal {
  readonly superficie: string;
  readonly rutas: readonly string[];
  readonly primeraVez: string;
  readonly ultimaVez: string;
}
