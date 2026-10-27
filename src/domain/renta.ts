import { ErrorImpuestocl } from './errores.js';
import type { F22Declaracion } from './tipos.js';

/** Máximo de años tributarios por sincronización de renta. */
export const MAX_ANIOS_RENTA = 10;

/** Año tributario `AAAA` (el año comercial + 1), entre 2000 y 2100. */
export function parseAnioTributario(entrada: string): number {
  const m = /^(\d{4})$/.exec(entrada.trim());
  const anio = m ? Number(m[1]) : Number.NaN;
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    throw new ErrorImpuestocl('PERIODO_INVALIDO', `Año tributario inválido: "${entrada}"`, { accion: 'Usa el año tributario AAAA, por ejemplo 2026 (renta del año comercial 2025).' });
  }
  return anio;
}

/** Años tributarios de `desde` a `hasta`, ambos incluidos; como máximo `maximo`. */
export function rangoAnios(desde: number, hasta: number, maximo = MAX_ANIOS_RENTA): number[] {
  if (desde > hasta) throw new ErrorImpuestocl('PERIODO_INVALIDO', `El año tributario inicial ${desde} es posterior al final ${hasta}`);
  if (hasta - desde + 1 > maximo) throw new ErrorImpuestocl('PERIODO_INVALIDO', `El rango supera ${maximo} años tributarios`);
  return Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
}

/** Período de la bitácora de sincronización de un año tributario: `AT<AAAA>`, que nunca calza con un mes `AAAA-MM`. */
export const periodoRenta = (anioTributario: number): string => `AT${anioTributario}`;

/**
 * La declaración vigente del año: la que el SII marca vigente; si ninguna trae marca, la de ingreso más reciente (sin
 * fecha es la más antigua) y, si empatan, el folio más alto. Una marcada como no vigente nunca lo es; null si no hay.
 */
export function f22Vigente<T extends F22Declaracion>(declaraciones: readonly T[]): T | null {
  const marcadas = declaraciones.filter((d) => d.vigente === true);
  const candidatas = marcadas.length > 0 ? marcadas : declaraciones.filter((d) => d.vigente === null);
  let elegida: T | null = null;
  for (const d of candidatas) {
    if (elegida === null) {
      elegida = d;
      continue;
    }
    const porFecha = (d.fechaIngreso ?? '').localeCompare(elegida.fechaIngreso ?? '');
    if (porFecha > 0 || (porFecha === 0 && d.folio > elegida.folio)) elegida = d;
  }
  return elegida;
}

/**
 * Códigos del resultado de la declaración que el resumen de renta muestra si están en el folio: 305 y la sección 85 a 94
 * (saldo a favor, devolución, saldo a pagar y recargos). Qué es cada uno lo dice la glosa guardada del SII.
 */
export const CODIGOS_CLAVE_F22: readonly string[] = ['305', '85', '86', '87', '88', '89', '90', '91', '92', '93', '94'];
