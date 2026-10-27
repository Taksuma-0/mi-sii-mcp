import { ErrorMiSiiMcp } from './errores.js';
import { formatearClp } from './formato.js';
import type { BheEmitidaMes, BoletaHonorariosEmitida, DjTercero, F22Declaracion, F22Valor } from './tipos.js';

/** Máximo de años tributarios por sincronización de renta. */
export const MAX_ANIOS_RENTA = 10;

/** Año tributario `AAAA` (el año comercial + 1), entre 2000 y 2100. */
export function parseAnioTributario(entrada: string): number {
  const m = /^(\d{4})$/.exec(entrada.trim());
  const anio = m ? Number(m[1]) : Number.NaN;
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    throw new ErrorMiSiiMcp('PERIODO_INVALIDO', `Año tributario inválido: "${entrada}"`, { accion: 'Usa el año tributario AAAA, por ejemplo 2026 (renta del año comercial 2025).' });
  }
  return anio;
}

/** Años tributarios de `desde` a `hasta`, ambos incluidos; como máximo `maximo`. */
export function rangoAnios(desde: number, hasta: number, maximo = MAX_ANIOS_RENTA): number[] {
  if (desde > hasta) throw new ErrorMiSiiMcp('PERIODO_INVALIDO', `El año tributario inicial ${desde} es posterior al final ${hasta}`);
  if (hasta - desde + 1 > maximo) throw new ErrorMiSiiMcp('PERIODO_INVALIDO', `El rango supera ${maximo} años tributarios`);
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

/** Cuánto más trae el monto reajustado que el nominal, en % con 2 decimales; null si alguno de los dos no es positivo. */
const reajustePctDe = (nominal: number, reajustado: number | null): number | null =>
  nominal > 0 && reajustado !== null && reajustado > 0 ? Math.round((reajustado / nominal - 1) * 10_000) / 100 : null;

/** El reajustado es el nominal más entre 0 % y 10 %. Comparación en enteros: 1 ≤ reajustado / nominal ≤ 1,10 sin errores de coma flotante en los bordes. */
const dentroDelReajuste = (nominal: number, reajustado: number): boolean =>
  nominal > 0 && reajustado >= nominal && reajustado * 100 <= nominal * (100 + REAJUSTE_MAXIMO_HONORARIOS_PCT);

function cruzarPar(codigo: string, boletas: number, valores: readonly F22Valor[]): ParCruceHonorarios {
  const f22 = valores.find((v) => v.codigo === codigo)?.valor ?? null;
  const declarado = f22 !== null && f22 !== 0;
  let estado: EstadoCruceHonorarios;
  if (boletas > 0 && !declarado) estado = 'sin_declarar';
  else if (boletas <= 0 && !declarado) estado = 'sin_datos';
  else if (dentroDelReajuste(boletas, f22!)) estado = 'cuadra';
  else estado = 'difiere';
  return { codigo, boletas, f22, estado, reajustePct: reajustePctDe(boletas, f22) };
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

const cantidad = (n: number, singular: string, plural: string): string => `${n} ${n === 1 ? singular : plural}`;

/**
 * Compara el detalle de un mes con el mismo mes del informe anual: misma cantidad de vigentes y de anuladas y mismo bruto
 * de las vigentes. Null si calzan; si no, el aviso para la persona con ambas cifras.
 */
export function diferenciaConAnual(periodo: string, mes: BheEmitidaMes, boletas: readonly BoletaHonorariosEmitida[]): string | null {
  const vigentes = boletas.filter((b) => !b.anulada);
  const detalle = { vigentes: vigentes.length, anuladas: boletas.length - vigentes.length, bruto: vigentes.reduce((s, b) => s + b.bruto, 0) };
  if (detalle.vigentes === mes.vigentes && detalle.anuladas === mes.anuladas && detalle.bruto === mes.bruto) return null;
  const describir = (d: { vigentes: number; anuladas: number; bruto: number }): string =>
    `${cantidad(d.vigentes, 'vigente', 'vigentes')}, ${cantidad(d.anuladas, 'anulada', 'anuladas')} y bruto ${formatearClp(d.bruto)}`;
  return `Boletas emitidas ${periodo}: el detalle trae ${describir(detalle)}; el informe anual dice ${describir(mes)}.`;
}

/** Quien recibió (y pagó) boletas emitidas vigentes: cuántas, el bruto y la retención que hizo (de terceros). */
export interface PagadorBhe {
  readonly rutReceptor: string;
  /** El nombre que informa el SII en alguna de sus boletas; null si nunca vino. */
  readonly nombreReceptor: string | null;
  readonly boletas: number;
  readonly bruto: number;
  readonly retencion: number;
}

/**
 * Receptores de las boletas vigentes, de mayor a menor bruto (y por RUT si empatan): los `maximo` primeros y cuántos más
 * hay. Las anuladas no cuentan.
 */
export function pagadoresBheEmitidas(boletas: readonly BoletaHonorariosEmitida[], maximo = 5): { readonly principales: readonly PagadorBhe[]; readonly otros: number } {
  const porRut = new Map<string, PagadorBhe>();
  for (const b of boletas) {
    if (b.anulada) continue;
    const previo = porRut.get(b.rutReceptor);
    porRut.set(b.rutReceptor, {
      rutReceptor: b.rutReceptor,
      nombreReceptor: b.nombreReceptor ?? previo?.nombreReceptor ?? null,
      boletas: (previo?.boletas ?? 0) + 1,
      bruto: (previo?.bruto ?? 0) + b.bruto,
      retencion: (previo?.retencion ?? 0) + b.retencionReceptor,
    });
  }
  const todos = [...porRut.values()].sort((a, b) => b.bruto - a.bruto || a.rutReceptor.localeCompare(b.rutReceptor));
  return { principales: todos.slice(0, maximo), otros: Math.max(0, todos.length - maximo) };
}

/** DJ con las retenciones de honorarios que informa quien pagó boletas y retuvo. */
export const DJ_RETENCION_HONORARIOS = 1879;
/** Superficie de la lista de DJ informadas por terceros de un año tributario (período AT<AAAA>). */
export const SUPERFICIE_TERCEROS = 'terceros';
/** Superficie del detalle de una DJ informada por terceros (período AT<AAAA>): `terceros.1879`. */
export const superficieDetalleTerceros = (dj: number): string => `${SUPERFICIE_TERCEROS}.${dj}`;

/** Un monto informado por terceros comparado con otro (el F22 o las boletas). */
export interface ComparacionMonto {
  /** El monto con que se compara; null si no viene (cuenta como 0). */
  readonly otro: number | null;
  readonly estado: 'cuadra' | 'difiere';
  /** Lo informado por terceros menos `otro`. */
  readonly diferencia: number;
  /** Solo contra boletas (nominales): cuánto más trae lo informado, en %; null si alguno no es positivo. */
  readonly reajustePct: number | null;
}

/**
 * Lo informado por terceros contra un código del F22 (por defecto el 492, retención de honorarios). Las DJ traen montos
 * «actualizados» (reajustados por IPC), igual que el F22: cuadra solo si son iguales.
 */
export function compararConF22(informado: number, valores: readonly F22Valor[], codigo = CODIGO_F22_RETENCION_HONORARIOS): ComparacionMonto {
  const otro = valores.find((v) => v.codigo === codigo)?.valor ?? null;
  const diferencia = informado - (otro ?? 0);
  return { otro, estado: diferencia === 0 ? 'cuadra' : 'difiere', diferencia, reajustePct: null };
}

/**
 * Lo informado por terceros (actualizado por IPC) contra el monto nominal de las boletas: cuadra si trae entre 0 % y
 * 10 % más, la misma tolerancia que el cruce de las boletas con el F22. Ambos en 0 también cuadra.
 */
export function compararConBoletas(informado: number, boletas: number): ComparacionMonto {
  const cuadra = (boletas === 0 && informado === 0) || dentroDelReajuste(boletas, informado);
  return { otro: boletas, estado: cuadra ? 'cuadra' : 'difiere', diferencia: informado - boletas, reajustePct: reajustePctDe(boletas, informado) };
}

/** Retención de honorarios que informan los terceros en la DJ 1879, contra las boletas emitidas del año y el F22. */
export interface CruceRetencionTerceros {
  readonly dj: number;
  /** Suma de la retención de honorarios de las filas de la 1879 (actualizada por IPC). */
  readonly informada: number;
  /** Contra la retención de terceros de las boletas emitidas del año comercial; null si no hay boletas guardadas. */
  readonly boletas: ComparacionMonto | null;
  /** Contra el código 492 del folio vigente; null si no hay folio vigente con detalle guardado. */
  readonly f22: ComparacionMonto | null;
}

/**
 * Suma la retención de honorarios de las filas de la DJ 1879 y la cruza con la retención de terceros nominal de las
 * boletas emitidas del año comercial (con tolerancia de reajuste) y con el 492 del F22 (directo). Null si no hay filas
 * de la 1879 con retención. Es información para la persona, nunca un hallazgo crítico.
 */
export function cruzarRetencionTerceros(filas: readonly DjTercero[], retencionBoletas: number | null, valoresF22: readonly F22Valor[] | null): CruceRetencionTerceros | null {
  const montos = filas.flatMap((f) => (f.dj === DJ_RETENCION_HONORARIOS && f.retencionHonorarios !== undefined ? [f.retencionHonorarios] : []));
  if (montos.length === 0) return null;
  const informada = montos.reduce((s, m) => s + m, 0);
  return {
    dj: DJ_RETENCION_HONORARIOS,
    informada,
    boletas: retencionBoletas === null ? null : compararConBoletas(informada, retencionBoletas),
    f22: valoresF22 === null ? null : compararConF22(informada, valoresF22),
  };
}

/** Un informante de la DJ 1879 contra las boletas vigentes que el contribuyente le emitió ese año. */
export interface CruceInformanteBoletas {
  readonly boletas: number;
  /** Meses (1 a 12) con boletas emitidas al informante. */
  readonly mesesBoletas: readonly number[];
  /** Meses con rentas en la DJ sin boletas emitidas ese mes, y al revés. El pago puede caer en otro mes que la boleta. */
  readonly soloDj: readonly number[];
  readonly soloBoletas: readonly number[];
  /** Retención de terceros (la que hace quien paga) de esas boletas, nominal. */
  readonly retencionBoletas: number;
  /** La retención de la DJ contra la de las boletas; null si la fila no trae retención de honorarios. */
  readonly retencion: ComparacionMonto | null;
}

/**
 * Compara una fila de la DJ con las boletas vigentes del año comercial emitidas al RUT del informante: meses y
 * retención. Null si no hay boletas a ese RUT.
 */
export function cruzarInformanteBoletas(fila: DjTercero, boletasDelAnio: readonly BoletaHonorariosEmitida[]): CruceInformanteBoletas | null {
  const suyas = boletasDelAnio.filter((b) => !b.anulada && b.rutReceptor === fila.informanteRut);
  if (suyas.length === 0) return null;
  const mesesBoletas = [...new Set(suyas.map((b) => Number(b.periodo.slice(5, 7))))].sort((a, b) => a - b);
  const retencionBoletas = suyas.reduce((s, b) => s + b.retencionReceptor, 0);
  return {
    boletas: suyas.length,
    mesesBoletas,
    soloDj: fila.meses.filter((m) => !mesesBoletas.includes(m)),
    soloBoletas: mesesBoletas.filter((m) => !fila.meses.includes(m)),
    retencionBoletas,
    retencion: fila.retencionHonorarios === undefined ? null : compararConBoletas(fila.retencionHonorarios, retencionBoletas),
  };
}
