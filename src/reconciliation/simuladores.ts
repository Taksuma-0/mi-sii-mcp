import { impuestoSegunTabla, type TramoIgc } from './estimar-renta.js';

/** Un dueño de la empresa: su participación en porcentaje y sus otras rentas del año para el Global Complementario. */
export interface SocioSimulado {
  readonly participacion: number;
  readonly otrasRentas: number;
}

export interface EntradaRegimen {
  /** Base imponible anual de la empresa (resultado del año); negativa si hay pérdida. */
  readonly base: number;
  readonly socios: readonly SocioSimulado[];
  /** Tasa del Impuesto de Primera Categoría del Pro Pyme General para el año, en porcentaje (p. ej. 12,5). */
  readonly tasaIdpc: number;
  readonly tablaIgc: readonly TramoIgc[];
  /** Porcentaje de las utilidades del año que los dueños retiran en el Pro Pyme General (0 a 100). */
  readonly retiroPct: number;
}

export interface ImpuestoSocio {
  readonly participacion: number;
  readonly otrasRentas: number;
  /** Impuesto adicional del dueño por la empresa (Global Complementario menos créditos); negativo es devolución. */
  readonly impuesto: number;
}

export interface ResultadoRegimen {
  readonly impuestoEmpresa: number;
  readonly socios: readonly ImpuestoSocio[];
  readonly impuestoDuenos: number;
  readonly total: number;
  /** Utilidades después de impuesto que quedan sin retirar (solo el General): pagan el impuesto del dueño al retirarse. */
  readonly diferido: number;
}

export interface SimulacionRegimen {
  readonly base: number;
  readonly general: ResultadoRegimen;
  readonly transparente: ResultadoRegimen;
  /** Total del General menos total del Transparente: positivo, el Transparente paga menos este año. */
  readonly diferencia: number;
  readonly supuestos: readonly string[];
}

/** Impuesto que agrega una renta extra sobre las otras rentas del dueño, según la tabla del año. */
const igcAdicional = (otras: number, extra: number, tabla: readonly TramoIgc[]): number => impuestoSegunTabla(otras + extra, tabla) - impuestoSegunTabla(otras, tabla);

const sumar = (socios: readonly ImpuestoSocio[]): number => socios.reduce((s, x) => s + x.impuesto, 0);

/**
 * Compara un año en Pro Pyme General (art. 14 D N°3: la empresa paga Primera Categoría y los dueños tributan al retirar,
 * con crédito total sin restitución) y en Pro Pyme Transparente (art. 14 D N°8: la empresa no paga Primera Categoría y
 * los dueños tributan por toda la base según su participación). Es una simulación de un año, no una recomendación.
 */
export function simularRegimen(e: EntradaRegimen): SimulacionRegimen {
  const supuestos: string[] = [];
  const base = Math.max(Math.round(e.base), 0);
  if (e.base < 0) supuestos.push('La base es una pérdida: ningún régimen paga impuesto este año y la pérdida no se atribuye a los dueños.');
  const tasa = e.tasaIdpc / 100;
  const retiro = e.retiroPct / 100;

  const impuestoEmpresa = Math.round(base * tasa);
  const sociosGeneral = e.socios.map((s) => {
    const retiroBruto = Math.round(base * retiro * (s.participacion / 100));
    const credito = Math.round(retiroBruto * tasa);
    return { ...s, impuesto: igcAdicional(s.otrasRentas, retiroBruto, e.tablaIgc) - credito };
  });
  if (sociosGeneral.some((s) => s.impuesto < 0)) supuestos.push('Si el crédito por Primera Categoría supera el impuesto del dueño, se supone que el excedente se le devuelve: confírmalo con tu contador.');
  const diferido = Math.round(base * (1 - tasa) * (1 - retiro));
  if (diferido > 0) supuestos.push('En el General, lo que no se retira paga el impuesto del dueño recién al retirarse: el total de este año no lo incluye.');
  const duenosGeneral = sumar(sociosGeneral);
  const general: ResultadoRegimen = { impuestoEmpresa, socios: sociosGeneral, impuestoDuenos: duenosGeneral, total: impuestoEmpresa + duenosGeneral, diferido };

  const sociosTransparente = e.socios.map((s) => ({ ...s, impuesto: igcAdicional(s.otrasRentas, Math.round(base * (s.participacion / 100)), e.tablaIgc) }));
  const duenosTransparente = sumar(sociosTransparente);
  const transparente: ResultadoRegimen = { impuestoEmpresa: 0, socios: sociosTransparente, impuestoDuenos: duenosTransparente, total: duenosTransparente, diferido: 0 };

  return { base: Math.round(e.base), general, transparente, diferencia: general.total - transparente.total, supuestos };
}

export interface EntradaCierre {
  /** Meses del año con datos guardados (RCV), sobre los que se proyecta. */
  readonly mesesConDatos: number;
  readonly ingresos: number;
  readonly gastos: number;
  /** PPM pagados en los F29 del año (código 62) y en cuántos meses. */
  readonly ppm: number;
  readonly mesesPpm: number;
  /** Tasa del Impuesto de Primera Categoría en porcentaje; null si no se informó. */
  readonly tasaIdpc: number | null;
}

export interface ProyeccionCierre {
  readonly ingresosProyectados: number;
  readonly gastosProyectados: number;
  readonly baseAcumulada: number;
  readonly baseProyectada: number;
  readonly ppmPagados: number;
  readonly ppmProyectados: number;
  /** Primera Categoría estimada sobre la base proyectada; null sin tasa. */
  readonly idpcEstimado: number | null;
  /** Impuesto estimado menos PPM proyectados: positivo, a pagar en abril; negativo, a devolver. */
  readonly saldoAbril: number | null;
  readonly notas: readonly string[];
  readonly faltantes: readonly string[];
}

const MESES_DEL_ANIO = 12;
export const URL_SUSPENSION_PPM = 'https://www.sii.cl/servicios_online/instrucciones_f29_20241112.pdf';

/** Proyecta al cierre del año lo acumulado, al mismo ritmo mensual, y lo compara con los PPM. */
export function proyectarCierre(e: EntradaCierre): ProyeccionCierre {
  const anual = (monto: number, meses: number): number => (meses > 0 ? Math.round((monto * MESES_DEL_ANIO) / meses) : 0);
  const ingresosProyectados = anual(e.ingresos, e.mesesConDatos);
  const gastosProyectados = anual(e.gastos, e.mesesConDatos);
  const baseProyectada = ingresosProyectados - gastosProyectados;
  const ppmProyectados = anual(e.ppm, e.mesesPpm);
  const notas: string[] = [];
  const faltantes: string[] = [];
  const idpcEstimado = e.tasaIdpc === null ? null : Math.round(Math.max(baseProyectada, 0) * (e.tasaIdpc / 100));
  if (e.tasaIdpc === null) faltantes.push('La tasa de Primera Categoría del año (tasa_idpc) para estimar el impuesto y el saldo de abril.');
  const saldoAbril = idpcEstimado === null ? null : idpcEstimado - ppmProyectados;
  if (baseProyectada < 0 && e.ppm > 0) {
    notas.push(`Con pérdida, el art. 90 de la Ley de la Renta permite suspender los PPM del trimestre siguiente (instrucciones del F29: ${URL_SUSPENSION_PPM}). Es posible, no seguro: confírmalo con tu contador.`);
  }
  if (saldoAbril !== null && saldoAbril < 0) notas.push('Los PPM superarían el impuesto estimado: la diferencia se devuelve en la Operación Renta.');
  return {
    ingresosProyectados,
    gastosProyectados,
    baseAcumulada: e.ingresos - e.gastos,
    baseProyectada,
    ppmPagados: e.ppm,
    ppmProyectados,
    idpcEstimado,
    saldoAbril,
    notas,
    faltantes,
  };
}
