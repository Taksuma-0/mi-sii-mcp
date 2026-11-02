import type { ResultadoAsientos } from '../../app/contabilidad.js';
import type { Libro } from '../../app/libros.js';
import type { PanoramaSii } from '../../app/panorama.js';
import type { ResumenRenta } from '../../app/renta.js';

/**
 * Versiones livianas de las respuestas más pesadas (decisión 0010): lo que el asistente necesita para responder, sin
 * repetir lo que el texto ya resume. El detalle completo sale con `detalle: true` (o, en libros y asientos, exportando).
 */
export const TOPE_FILAS_LIBRO = 50;
export const TOPE_ASIENTOS = 30;

/** Panorama sin los códigos del F29 ni la frescura de cada mes; queda la frescura más vieja de todo el panorama. */
export function panoramaLiviano(p: PanoramaSii): unknown {
  const fechas = p.periodos.flatMap((periodo) => Object.values(periodo.frescura).filter((f): f is string => typeof f === 'string'));
  return {
    ...p,
    frescuraMasVieja: fechas.length === 0 ? null : fechas.sort()[0],
    periodos: p.periodos.map(({ frescura: _frescura, f29: { valores: _valores, ...f29 }, ...resto }) => ({ ...resto, f29 })),
  };
}

/** Renta con el resumen de lo que prepara el SII (PPM y comparativo ya cruzados), sin las filas crudas de sus tablas. */
export function rentaLiviana(r: ResumenRenta): unknown {
  return {
    ...r,
    anios: r.anios.map((anio) =>
      anio.asistente === null ? anio : { ...anio, asistente: { ...anio.asistente, tablas: anio.asistente.tablas.map((t) => ({ codigo: t.codigo, titulo: t.titulo, filas: t.filas.length })) } },
    ),
  };
}

export function libroLiviano(l: Libro): { datos: unknown; omitidas: number } {
  const omitidas = Math.max(l.filas.length - TOPE_FILAS_LIBRO, 0);
  return { datos: omitidas === 0 ? l : { ...l, filas: l.filas.slice(0, TOPE_FILAS_LIBRO), filasOmitidas: omitidas }, omitidas };
}

export function asientosLivianos(a: ResultadoAsientos): { datos: unknown; omitidos: number } {
  const omitidos = Math.max(a.asientos.length - TOPE_ASIENTOS, 0);
  return { datos: omitidos === 0 ? a : { ...a, asientos: a.asientos.slice(0, TOPE_ASIENTOS), asientosOmitidos: omitidos }, omitidos };
}
