import type { Severidad } from '../domain/tipos.js';

/**
 * Piezas de la plantilla común de las respuestas: una conclusión con ícono, una tabla corta de montos, los hallazgos y
 * los siguientes pasos. En Markdown, que los asistentes muestran con formato y que en la terminal se sigue leyendo.
 */

export type Icono = '✅' | '⚠️' | '⛔' | 'ℹ️';

const ICONOS: Readonly<Record<Severidad | 'ok', Icono>> = { critico: '⛔', advertencia: '⚠️', info: 'ℹ️', ok: '✅' };

export const estado = (severidad: Severidad | 'ok'): Icono => ICONOS[severidad];

export const conclusion = (icono: string, texto: string): string => `${icono} ${texto}`;

const celda = (texto: string): string => texto.replace(/\|/g, '\\|');

/** Tabla Markdown; sin filas devuelve `''` para que la respuesta no muestre una tabla vacía. */
export function tabla(encabezados: readonly string[], filas: readonly (readonly string[])[]): string {
  if (filas.length === 0) return '';
  const linea = (celdas: readonly string[]): string => `| ${celdas.map(celda).join(' | ')} |`;
  return [linea(encabezados), `| ${encabezados.map(() => '---').join(' | ')} |`, ...filas.map(linea)].join('\n');
}

export const siguientesPasos = (pasos: readonly string[]): string => (pasos.length === 0 ? '' : `Siguientes pasos: ${pasos.join(' · ')}`);
