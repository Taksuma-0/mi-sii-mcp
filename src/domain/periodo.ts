import { ErrorImpuestocl } from './errores.js';

export interface Periodo {
  readonly anio: number;
  readonly mes: number;
  /** `AAAA-MM` */
  readonly texto: string;
}

export function crearPeriodo(anio: number, mes: number): Periodo {
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new ErrorImpuestocl('PERIODO_INVALIDO', `Período inválido: ${anio}-${mes}`);
  }
  return { anio, mes, texto: `${anio}-${String(mes).padStart(2, '0')}` };
}

export function parsePeriodo(entrada: string): Periodo {
  const m = /^(\d{4})-?(\d{2})$/.exec(entrada.trim());
  if (!m) throw new ErrorImpuestocl('PERIODO_INVALIDO', `Período inválido: "${entrada}"`);
  return crearPeriodo(Number(m[1]), Number(m[2]));
}

/** Forma que espera el SII: `AAAAMM`. */
export const periodoSii = (p: Periodo): string => p.texto.replace('-', '');

export const periodoSiguiente = (p: Periodo): Periodo => (p.mes === 12 ? crearPeriodo(p.anio + 1, 1) : crearPeriodo(p.anio, p.mes + 1));

export const periodoAnterior = (p: Periodo): Periodo => (p.mes === 1 ? crearPeriodo(p.anio - 1, 12) : crearPeriodo(p.anio, p.mes - 1));

export function restarPeriodos(p: Periodo, n: number): Periodo {
  let r = p;
  for (let i = 0; i < n; i++) r = periodoAnterior(r);
  return r;
}

export const compararPeriodos = (a: Periodo, b: Periodo): number => a.anio - b.anio || a.mes - b.mes;

export function rangoPeriodos(desde: Periodo, hasta: Periodo, maximo = 120): Periodo[] {
  if (compararPeriodos(desde, hasta) > 0) {
    throw new ErrorImpuestocl('PERIODO_INVALIDO', `El inicio ${desde.texto} es posterior al fin ${hasta.texto}`);
  }
  const out: Periodo[] = [];
  for (let p = desde; compararPeriodos(p, hasta) <= 0; p = periodoSiguiente(p)) {
    out.push(p);
    if (out.length > maximo) throw new ErrorImpuestocl('PERIODO_INVALIDO', `El rango supera ${maximo} meses`);
  }
  return out;
}

export const periodoDeFecha = (fechaIso: string): Periodo => crearPeriodo(Number(fechaIso.slice(0, 4)), Number(fechaIso.slice(5, 7)));
