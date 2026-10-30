import type { LineaEstimada } from './estimar-f29.js';

/** Un tramo de la tabla del Impuesto Global Complementario del año tributario: impuesto = base × factor − rebaja. */
export interface TramoIgc {
  readonly desde: number;
  /** null en el último tramo. */
  readonly hasta: number | null;
  readonly factor: number;
  readonly rebaja: number;
}

/**
 * Datos públicos del año tributario, que mi-sii-mcp no guarda (decisión 0007): se consultan en las páginas oficiales que
 * indica fuentes_oficiales y se pasan como parámetros.
 */
export interface ParametrosRenta {
  readonly tablaIgc: readonly TramoIgc[];
  /** UTA de diciembre del año comercial, en pesos. */
  readonly uta: number;
  /** Porcentaje de gastos presuntos de honorarios (p. ej. 30). */
  readonly gastosPresuntosPct: number;
  /** Tope de los gastos presuntos, en UTA (p. ej. 15). */
  readonly topeGastosPresuntosUta: number;
  readonly obligadoCotizar: boolean;
  /**
   * Cotizaciones de honorarios que se pagan con las retenciones (SIS, ATEP, SANNA, salud y pensiones según la cobertura
   * del año): dependen de topes y coberturas anuales, así que se calculan con la regla de fuentes_oficiales y se informan.
   */
  readonly cotizaciones?: number;
}

/** Datos privados de la persona para el año comercial, ya actualizados por IPC si se quiere comparar con el F22. */
export interface DatosRenta {
  readonly honorariosBrutos: number;
  readonly retencionHonorarios: number;
  readonly sueldos: number;
  readonly impuestoUnicoRetenido: number;
  readonly gastosEfectivos?: number;
  readonly apvRegimenB?: number;
  readonly otrasRentas?: number;
}

export interface EstimacionRenta {
  readonly lineas: readonly LineaEstimada[];
  readonly baseIgc: number;
  readonly igc: number;
  readonly cotizaciones: number;
  /** Positivo: a pagar; negativo: a devolver. */
  readonly resultado: number;
  readonly supuestos: readonly string[];
  readonly faltantes: readonly string[];
}

/** Impuesto según la tabla: el tramo donde cae la base, factor por base menos su rebaja, nunca negativo. */
export function impuestoSegunTabla(base: number, tabla: readonly TramoIgc[]): number {
  const tramo = tabla.find((t) => base > t.desde && (t.hasta === null || base <= t.hasta)) ?? tabla[0];
  return tramo ? Math.max(Math.round(base * tramo.factor - tramo.rebaja), 0) : 0;
}

/**
 * Estima el F22 de una persona con honorarios y sueldo, paso a paso como la regla de fuentes_oficiales: honorarios netos
 * (con lo mayor entre gastos efectivos y presuntos con tope), base del Global Complementario (menos el APV régimen B),
 * impuesto según la tabla del año, crédito por impuesto único y retenciones de honorarios después de las cotizaciones.
 * Es una estimación: no considera otras rentas ni créditos especiales que no se informen.
 */
export function estimarRenta(d: DatosRenta, p: ParametrosRenta): EstimacionRenta {
  const supuestos: string[] = [];
  const faltantes: string[] = [];
  const presuntos = Math.min(Math.round((d.honorariosBrutos * p.gastosPresuntosPct) / 100), Math.round(p.topeGastosPresuntosUta * p.uta));
  const gastos = Math.max(presuntos, d.gastosEfectivos ?? 0);
  if ((d.gastosEfectivos ?? 0) > presuntos) supuestos.push('Se usan gastos efectivos: exigen respaldo y contabilidad o registro de los gastos.');
  const honorariosNetos = Math.max(d.honorariosBrutos - gastos, 0);
  const base = Math.max(d.sueldos + honorariosNetos + (d.otrasRentas ?? 0) - (d.apvRegimenB ?? 0), 0);
  const igc = impuestoSegunTabla(base, p.tablaIgc);
  let cotizaciones = 0;
  if (p.obligadoCotizar) {
    if (p.cotizaciones === undefined) faltantes.push('Las cotizaciones de honorarios del año: calcúlalas con la regla de fuentes_oficiales (cobertura y tasas del año) e infórmalas.');
    cotizaciones = p.cotizaciones ?? 0;
  }
  const retencionDisponible = Math.max(d.retencionHonorarios - cotizaciones, 0);
  if (cotizaciones > d.retencionHonorarios) supuestos.push('Las retenciones no alcanzan para las cotizaciones: la diferencia queda como saldo de cotizaciones, no como impuesto.');
  const resultado = igc - d.impuestoUnicoRetenido - retencionDisponible;
  const lineas: LineaEstimada[] = [
    { codigo: 'honorarios', glosa: 'Honorarios brutos', monto: d.honorariosBrutos, origen: 'boletas emitidas' },
    { codigo: 'gastos', glosa: 'Gastos (los mayores entre efectivos y presuntos con tope)', monto: gastos, origen: 'cálculo' },
    { codigo: 'sueldos', glosa: 'Sueldos', monto: d.sueldos, origen: 'DJ del empleador o informado' },
    { codigo: 'apv', glosa: 'APV régimen B', monto: d.apvRegimenB ?? 0, origen: 'informado' },
    { codigo: 'base', glosa: 'Base del Global Complementario', monto: base, origen: 'cálculo' },
    { codigo: 'igc', glosa: 'Impuesto Global Complementario', monto: igc, origen: 'tabla del año' },
    { codigo: 'impuesto_unico', glosa: 'Crédito por impuesto único retenido', monto: d.impuestoUnicoRetenido, origen: 'DJ del empleador o informado' },
    { codigo: 'retencion', glosa: 'Retención de honorarios', monto: d.retencionHonorarios, origen: 'boletas emitidas' },
    { codigo: 'cotizaciones', glosa: 'Cotizaciones pagadas con la retención', monto: cotizaciones, origen: p.obligadoCotizar ? 'informado' : 'no obligado' },
    { codigo: 'resultado', glosa: resultado >= 0 ? 'A pagar' : 'A devolver', monto: Math.abs(resultado), origen: 'cálculo' },
  ];
  return { lineas, baseIgc: base, igc, cotizaciones, resultado, supuestos, faltantes };
}
