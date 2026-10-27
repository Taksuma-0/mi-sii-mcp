/**
 * Dónde consultar los datos públicos de la renta (docs/decisiones/0007-datos-publicos-renta.md). mi-sii-mcp no guarda
 * esos valores: cambian cada año y copiados en el código se desactualizan sin aviso. Aquí solo hay páginas oficiales
 * (abiertas y revisadas el 27/10/2026) y qué buscar en cada una; quien estima los consulta allí.
 */
export interface FuenteOficial {
  readonly parametro: string;
  readonly urls: readonly string[];
  readonly buscar: string;
}

const RENTA_PN = 'https://www.sii.cl/valores_y_fechas/renta/2026/personas_naturales.html';
const GUIA_RENTA = 'https://www.sii.cl/servicios_online/renta/guia_practica_renta_2026.pdf';
const INDEPENDIENTES = 'https://previsionsocial.gob.cl/wp-content/uploads/2026/05/Independientes-Consideraciones-Generales-VF.pdf';

export const FUENTES_OFICIALES: readonly FuenteOficial[] = [
  {
    parametro: 'UTM y UTA por mes',
    urls: ['https://www.sii.cl/valores_y_fechas/utm/utm2026.htm'],
    buscar: 'Cambia el año en la URL. Fila de diciembre del año comercial (UTA = 12 × UTM de diciembre); los montos del F22 se expresan en esa UTA. Si diciembre no está publicado, la fila está vacía.',
  },
  {
    parametro: 'Tabla del Impuesto Global Complementario (IGC) por año tributario',
    urls: [RENTA_PN, GUIA_RENTA],
    buscar: 'Cambia el año tributario en la ruta. Tabla del art. 52 (no la del 52 bis): tramos en pesos, factor y cantidad a rebajar. La guía práctica trae casos resueltos (código [157]).',
  },
  {
    parametro: 'Tabla del Impuesto Único de Segunda Categoría (sueldos, mensual)',
    urls: ['https://www.sii.cl/valores_y_fechas/impuesto_2da_categoria/impuesto2026.htm'],
    buscar: 'Cambia el año en la URL. Tabla «mensual» de cada mes; el primer tramo exento equivale a 13,5 UTM del mes.',
  },
  {
    parametro: 'Factores de actualización (reajuste IPC) del F22',
    urls: [RENTA_PN],
    buscar: 'Bloque «Factores de actualización» del año comercial: un factor por mes (diciembre = 1). Los montos de las DJ de terceros y de la propuesta del SII ya vienen actualizados: no actualizarlos dos veces.',
  },
  {
    parametro: 'Gastos presuntos de honorarios (porcentaje y tope en UTA)',
    urls: [RENTA_PN, GUIA_RENTA],
    buscar: '«Gastos presuntos (art. 50)», con el tope en pesos del año tributario; en la guía, el caso práctico del IGC.',
  },
  {
    parametro: 'Tasa de retención de boletas de honorarios por año',
    urls: [INDEPENDIENTES, 'https://www.chileatiende.gob.cl/fichas/12016-prorroga-de-la-cotizacion-previsional-obligatoria-para-independientes-que-perciben-honorarios'],
    buscar: '«Cuadro 1: Porcentaje de retenciones…» por año comercial y tributario; ChileAtiende trae las tasas del año en curso y siguientes.',
  },
  {
    parametro: 'Obligación de cotizar por honorarios: umbral de exención, exceptuados y tope imponible',
    urls: [GUIA_RENTA, 'https://www.sii.cl/preguntas_frecuentes/declaracion_renta/001_140_7292.htm'],
    buscar: '«Contribuyentes no obligados a cotizar»: monto anual de honorarios bajo el cual no se cotiza y límite máximo imponible; la pregunta frecuente lista a los exceptuados. Si ChileAtiende da otro monto, para el F22 manda el SII.',
  },
  {
    parametro: 'Cobertura parcial o total de la cotización de honorarios',
    urls: [INDEPENDIENTES, GUIA_RENTA],
    buscar: '«Cuadro 2» (total) y «Cuadro 3» (parcial): porcentaje de la renta imponible que cotiza salud y pensiones en cada Operación Renta; en la guía, el orden de descuento y un caso práctico.',
  },
  {
    parametro: 'Tasas de ATEP, SANNA y salud de independientes',
    urls: [GUIA_RENTA, INDEPENDIENTES],
    buscar: 'Fichas «Seguro contra Accidentes Laborales (ATEP)», «SANNA» y «Salud»; la lámina final del PDF trae las tasas. La tasa adicional de ATEP depende de la actividad.',
  },
  {
    parametro: 'Comisiones de las AFP',
    urls: ['https://www.spensiones.cl/portal/institucional/594/w3-propertyvalue-9897.html'],
    buscar: 'Tabla de comisiones por AFP (porcentaje de la renta imponible).',
  },
  {
    parametro: 'Tasa del SIS para independientes en la Operación Renta',
    urls: ['https://www.spensiones.cl/portal/institucional/594/w3-propertyvalue-9917.html'],
    buscar: '«La tasa SIS a considerar para el año tributario N» (no la tasa general del mes). Si la guía del SII da otra cifra redondeada, gana la de la Superintendencia.',
  },
];

/** Cómo estimar el F22 de una persona con sueldo y honorarios, en palabras y sin cifras (detalle en la decisión 0007). */
export const REGLA_ESTIMACION_RENTA: readonly string[] = [
  'Actualizar al 31 de diciembre sueldos, impuesto único, honorarios y retenciones con el factor de su mes (lo que viene de las DJ o de la propuesta ya viene actualizado).',
  'Honorarios netos: brutos menos lo mayor entre gastos efectivos y gastos presuntos (porcentaje legal con tope en UTA).',
  'Base del IGC: sueldos tributables (sin cotizaciones) + honorarios netos + otras rentas, menos rebajas que procedan.',
  'Impuesto según la tabla del IGC del año tributario (nunca negativo).',
  'Restar el crédito por impuesto único retenido y otros créditos; solo el impuesto único retenido puede devolverse.',
  'Las retenciones de honorarios van primero a las cotizaciones de honorarios (si la persona está obligada) y el saldo queda como crédito.',
  'Cotizaciones: renta imponible = porcentaje legal de los honorarios brutos (con mínimo y tope, descontado lo cotizado como dependiente); en orden SIS, ATEP, SANNA, salud y pensiones; con cobertura parcial, salud y pensiones sobre el porcentaje de esa Operación Renta; con cobertura total, pensiones toma lo que queda de las retenciones. Si las retenciones no alcanzan, lo que falta queda como saldo insoluto de cotizaciones para Operaciones Renta siguientes.',
  'Resultado: impuesto menos retenciones restantes; positivo es a pagar y negativo a devolver.',
  'Si el año tributario aún no tiene publicados tabla, UTA, factores o tasa del SIS, usar el último año publicado y decir que es una estimación provisional.',
];

const normalizar = (t: string): string => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Las fuentes cuyo parámetro o indicación contiene todas las palabras de `buscar` (sin tildes ni mayúsculas); todas si no hay filtro. */
export function fuentesOficiales(buscar?: string): FuenteOficial[] {
  const palabras = normalizar(buscar ?? '').split(/\s+/).filter(Boolean);
  return FUENTES_OFICIALES.filter((f) => {
    const texto = normalizar(`${f.parametro} ${f.buscar}`);
    return palabras.every((p) => texto.includes(p));
  });
}
