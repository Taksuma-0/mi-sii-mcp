import { formatearClp } from '../domain/formato.js';
import { restarPeriodos, type Periodo } from '../domain/periodo.js';
import type { DocumentoRcv, TipoContribuyente } from '../domain/tipos.js';

/**
 * Una oportunidad legal de pagar menos (o de pagar después) que los datos guardados sostienen. Cada una cita su norma y
 * la página oficial donde se verificó (docs/decisiones/0008-ahorro-tributario.md); nunca es una recomendación cerrada.
 */
export interface Oportunidad {
  readonly id: string;
  readonly titulo: string;
  readonly baseLegal: { readonly norma: string; readonly url: string };
  /** Monto involucrado (crédito, remanente, IVA que se podía postergar o umbral); null si depende de datos que faltan. */
  readonly montoEstimado: number | null;
  readonly detalle: string;
  readonly datosFaltantes: readonly string[];
  readonly accion: string;
  readonly antielusion: string;
}

export interface EntradaOportunidades {
  readonly tipo: TipoContribuyente;
  /** Período en curso. */
  readonly actual: Periodo;
  /** Compras del RCV en estado PENDIENTE o NO_INCLUIR. */
  readonly comprasPendientes: readonly DocumentoRcv[];
  /** F29 presentados de los últimos 12 meses, del más antiguo al más nuevo. */
  readonly f29: readonly { readonly periodo: string; readonly valores: Readonly<Record<string, number>> }[];
  /** Boletas de honorarios emitidas del año comercial en curso (personas). */
  readonly honorariosEmitidos: { readonly anioComercial: number; readonly bruto: number } | null;
  /** La persona tiene honorarios o sueldo (base del Global Complementario). */
  readonly tieneIngresosPersona: boolean;
}

export const ANTIELUSION = 'Solo con operaciones reales, necesarias para tu actividad y con respaldo. Simular gastos, compras o contratos para pagar menos no es ahorro: es elusión o fraude.';
/** Meses seguidos con remanente desde los que vale la pena revisarlo. */
const MESES_REMANENTE = 6;

function creditoPendiente(e: EntradaOportunidades): Oportunidad[] {
  const desde = restarPeriodos(e.actual, 2).texto;
  const docs = e.comprasPendientes.filter((d) => d.periodo >= desde && d.montoIva > 0);
  if (docs.length === 0) return [];
  const iva = docs.reduce((s, d) => s + d.montoIva, 0);
  return [
    {
      id: 'OPO-IVA-01',
      titulo: 'Crédito de IVA de compras pendientes que aún puedes usar',
      baseLegal: { norma: 'Ley sobre Impuesto a las Ventas y Servicios (DL 825), art. 24, inciso final', url: 'https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_0693.htm' },
      montoEstimado: iva,
      detalle: `${docs.length} factura(s) de compra pendiente(s) o sin incluir de los últimos dos períodos con IVA por ${formatearClp(iva)}. Si son de tu giro, su IVA es crédito fiscal; una factura recibida o registrada con atraso por un hecho que no te es imputable se puede usar hasta dos períodos después de su emisión.`,
      datosFaltantes: [],
      accion: 'Revisa esas facturas en el Registro de Compras del SII (rcv_documentos con estado PENDIENTE) y, si corresponden a tu actividad y no hay que reclamarlas, regístralas antes de declarar el F29.',
      antielusion: ANTIELUSION,
    },
  ];
}

function remanenteAcumulado(e: EntradaOportunidades): Oportunidad[] {
  const ultimos = e.f29.slice(-MESES_REMANENTE);
  if (ultimos.length < MESES_REMANENTE || !ultimos.every((f) => (f.valores['77'] ?? 0) > 0)) return [];
  const remanente = ultimos.at(-1)!.valores['77']!;
  return [
    {
      id: 'OPO-IVA-02',
      titulo: 'Remanente de crédito fiscal sin usar',
      baseLegal: { norma: 'DL 825, arts. 26 y 27 (el remanente se acumula al período siguiente, reajustado en UTM) y art. 27 bis (devolución del originado en activo fijo)', url: 'https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_1926.htm' },
      montoEstimado: remanente,
      detalle: `Hace al menos ${MESES_REMANENTE} meses que tu F29 deja remanente de crédito; el último es de ${formatearClp(remanente)}. Se reajusta y se descuenta del IVA de tus próximas ventas.`,
      datosFaltantes: ['Si el remanente viene de compras de activo fijo y se mantiene dos períodos seguidos, el art. 27 bis permite pedir su devolución; si viene de exportaciones, hay otra vía. Confírmalo con tu contador.'],
      accion: 'Considéralo en tu flujo: tus próximas ventas pagarán menos IVA hasta agotarlo. Revisa con tu contador si te corresponde alguna devolución.',
      antielusion: ANTIELUSION,
    },
  ];
}

function postergacionIva(e: EntradaOportunidades): Oportunidad[] {
  if (e.f29.some((f) => (f.valores['755'] ?? 0) > 0)) return [];
  const conIva = e.f29.filter((f) => (f.valores['89'] ?? 0) > 0);
  if (conIva.length === 0) return [];
  const iva = conIva.reduce((s, f) => s + f.valores['89']!, 0);
  return [
    {
      id: 'OPO-IVA-03',
      titulo: 'Postergar el pago del IVA dos meses (flujo de caja)',
      baseLegal: { norma: 'Postergación del pago del IVA para pymes (F29, códigos 756 y 755)', url: 'https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_6631.htm' },
      montoEstimado: iva,
      detalle: `En ${conIva.length} mes(es) de los últimos 12 pagaste IVA por ${formatearClp(iva)} sin postergarlo. Una pyme (ingresos promedio de hasta 100.000 UF en los últimos tres años) que declara por Internet dentro de plazo y sin morosidad reiterada puede pagarlo dos meses después, sin intereses ni multas. No rebaja el impuesto: mejora tu caja.`,
      datosFaltantes: ['Que cumplas los requisitos: promedio de ingresos, sin deudas de IVA de tres períodos en doce meses y el F29 presentado por Internet a tiempo.'],
      accion: 'Al declarar el F29 en plazo, marca la postergación (código 756) y paga el IVA a los dos meses; el resto del F29 se paga igual en la fecha normal.',
      antielusion: ANTIELUSION,
    },
  ];
}

function gastosEfectivos(e: EntradaOportunidades): Oportunidad[] {
  if (e.tipo !== 'persona' || e.honorariosEmitidos === null || e.honorariosEmitidos.bruto <= 0) return [];
  const umbral = Math.round(e.honorariosEmitidos.bruto * 0.3);
  return [
    {
      id: 'OPO-HON-01',
      titulo: 'Gastos efectivos en vez de presuntos',
      baseLegal: { norma: 'Ley sobre Impuesto a la Renta, art. 50 (gastos presuntos de 30 % con tope de 15 UTA)', url: 'https://www.sii.cl/valores_y_fechas/renta/2026/personas_naturales.html' },
      montoEstimado: umbral,
      detalle: `Tus boletas de ${e.honorariosEmitidos.anioComercial} suman ${formatearClp(e.honorariosEmitidos.bruto)}: los gastos presuntos rebajan hasta ${formatearClp(umbral)} (30 %, con tope de 15 UTA). Si tus gastos reales necesarios para tu actividad son mayores, conviene declarar gastos efectivos.`,
      datosFaltantes: ['El total de tus gastos reales del año, con sus boletas o facturas.'],
      accion: 'Junta los respaldos de tus gastos del año; si superan ese monto, pide estimar la renta con gastos_efectivos y revísalo con tu contador.',
      antielusion: ANTIELUSION,
    },
  ];
}

function apvRegimenB(e: EntradaOportunidades): Oportunidad[] {
  if (e.tipo !== 'persona' || !e.tieneIngresosPersona) return [];
  return [
    {
      id: 'OPO-APV-01',
      titulo: 'Ahorro previsional voluntario (APV) régimen B',
      baseLegal: { norma: 'Ley sobre Impuesto a la Renta, art. 42 bis, inciso 1° (tope de 600 UF al año)', url: 'https://www.sii.cl/servicios_online/renta/2025/archivos/l23_instruccion.pdf' },
      montoEstimado: null,
      detalle: 'Lo que ahorres en APV régimen B se rebaja de tu base del Global Complementario, hasta 600 UF al año: si tu base supera el tramo exento, cada peso ahorrado baja tu impuesto según tu tasa marginal.',
      datosFaltantes: ['Tu base estimada del año (renta_estimar) para saber tu tasa marginal.'],
      accion: 'Estima tu renta con renta_estimar; si pagas impuesto, compara el ahorro con y sin APV (parámetro apv_regimen_b) antes de fin de año.',
      antielusion: ANTIELUSION,
    },
  ];
}

/** Las oportunidades que los datos sostienen, en orden: IVA, remanente, postergación, gastos y APV. */
export function oportunidades(e: EntradaOportunidades): Oportunidad[] {
  return [...creditoPendiente(e), ...remanenteAcumulado(e), ...postergacionIva(e), ...gastosEfectivos(e), ...apvRegimenB(e)];
}
