import { ErrorImpuestocl } from './errores.js';
import type { BheEmitidaMes, F22Declaracion, F22Valor } from './tipos.js';

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

/** Superficie del detalle mensual de las boletas de honorarios emitidas: se registra con período AAAA-MM, pero es de la renta. */
export const SUPERFICIE_DETALLE_BHE_EMITIDAS = 'bhe.emitidas.detalle';

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

/** Código del F22 con el total de ingresos brutos de honorarios del año, reajustado por IPC. */
export const CODIGO_F22_HONORARIOS_BRUTO = '547';
/** Código del F22 con el impuesto retenido por los honorarios del año, reajustado por IPC. */
export const CODIGO_F22_RETENCION_HONORARIOS = '492';
/** El F22 reajusta cada mes de honorarios por IPC: el total anual nunca baja ni sube más de este 10 %. */
export const REAJUSTE_MAXIMO_HONORARIOS_PCT = 10;

/**
 * `cuadra`: el F22 es el monto de las boletas reajustado entre 0 % y 10 %. `sin_declarar`: hay boletas y el F22 no trae
 * el código o lo trae en 0. `sin_datos`: ni boletas ni F22. `difiere`: cualquier otro caso (también F22 sin boletas).
 */
export type EstadoCruceHonorarios = 'cuadra' | 'sin_declarar' | 'difiere' | 'sin_datos';

export interface ParCruceHonorarios {
  readonly codigo: string;
  /** Monto nominal de las boletas del año comercial. */
  readonly boletas: number;
  /** Valor del código en el folio vigente; null si no está o vino vacío. */
  readonly f22: number | null;
  readonly estado: EstadoCruceHonorarios;
  /** Cuánto más trae el F22 que las boletas, en % con 2 decimales; null si alguno de los dos no es positivo. */
  readonly reajustePct: number | null;
}

/** Boletas de honorarios emitidas del año comercial contra el F22 del año tributario siguiente: bruto con 547 y retención con 492. */
export interface CruceHonorariosF22 {
  readonly bruto: ParCruceHonorarios;
  readonly retencion: ParCruceHonorarios;
}

function cruzarPar(codigo: string, boletas: number, valores: readonly F22Valor[]): ParCruceHonorarios {
  const f22 = valores.find((v) => v.codigo === codigo)?.valor ?? null;
  const reajustePct = boletas > 0 && f22 !== null && f22 > 0 ? Math.round((f22 / boletas - 1) * 10_000) / 100 : null;
  const declarado = f22 !== null && f22 !== 0;
  let estado: EstadoCruceHonorarios;
  if (boletas > 0 && !declarado) estado = 'sin_declarar';
  else if (boletas <= 0 && !declarado) estado = 'sin_datos';
  // Comparación en enteros: 1 ≤ F22 / boletas ≤ 1,10 sin errores de coma flotante en los bordes.
  else if (boletas > 0 && f22! >= boletas && f22! * 100 <= boletas * (100 + REAJUSTE_MAXIMO_HONORARIOS_PCT)) estado = 'cuadra';
  else estado = 'difiere';
  return { codigo, boletas, f22, estado, reajustePct };
}

/**
 * Cruza el bruto y la retención de terceros nominales de las boletas emitidas de un año comercial con los códigos 547 y
 * 492 del folio vigente del F22 (AT = año comercial + 1). El F22 trae los honorarios reajustados por IPC, así que no se
 * exige igualdad. Es información para la persona, nunca un hallazgo crítico.
 */
export function cruzarHonorariosF22(boletas: { readonly bruto: number; readonly retencion: number }, valores: readonly F22Valor[]): CruceHonorariosF22 {
  return {
    bruto: cruzarPar(CODIGO_F22_HONORARIOS_BRUTO, boletas.bruto, valores),
    retencion: cruzarPar(CODIGO_F22_RETENCION_HONORARIOS, boletas.retencion, valores),
  };
}

/** Totales de un año de boletas de honorarios emitidas. */
export interface TotalesBheEmitidas {
  readonly vigentes: number;
  readonly anuladas: number;
  readonly bruto: number;
  readonly retencionTerceros: number;
  readonly retencionPropia: number;
}

export function totalesBheEmitidas(meses: readonly Omit<BheEmitidaMes, 'mes' | 'folioInicial' | 'folioFinal'>[]): TotalesBheEmitidas {
  const sumar = (dato: (m: (typeof meses)[number]) => number): number => meses.reduce((s, m) => s + dato(m), 0);
  return {
    vigentes: sumar((m) => m.vigentes),
    anuladas: sumar((m) => m.anuladas),
    bruto: sumar((m) => m.bruto),
    retencionTerceros: sumar((m) => m.retencionTerceros),
    retencionPropia: sumar((m) => m.retencionPropia),
  };
}

/** Si el año trae alguna boleta (vigente o anulada) o algún monto: un año todo en 0 es un año sin boletas o una respuesta vacía. */
export const hayBoletasEmitidas = (t: TotalesBheEmitidas): boolean => t.vigentes + t.anuladas > 0 || t.bruto + t.retencionTerceros + t.retencionPropia > 0;
