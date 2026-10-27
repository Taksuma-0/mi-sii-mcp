import { vencimientoReclamo, vencimientosF29 } from '../calendar/plazos.js';
import { declaracionVigente, f29Guardada, f29Rechazada } from '../domain/f29.js';
import { diasEntre, fechaEnSantiago } from '../domain/fechas.js';
import { formatearClp, nombreTipoDocumento } from '../domain/formato.js';
import { compararPeriodos, periodoAnterior, periodoDeFecha, type Periodo } from '../domain/periodo.js';
import { claveDocumento, type DisponibilidadFuentes, type DocumentoRcv, type F29Declaracion, type F29Valores, type Hallazgo, type Lado, type RcvResumen, type SnapshotRcv, type TipoContribuyente } from '../domain/tipos.js';
import { verificarCoherenciaF29 } from './coherencia-f29.js';
import { CODIGO_F29, creditoDocumentosF29, creditoRcv, debitoF29, debitoRcv, f29Leido, montoF29 } from './mapeo-f29.js';

export interface EntradaConciliacion {
  readonly rut: string;
  readonly tipo: TipoContribuyente;
  readonly periodo: Periodo;
  /** Fecha civil de hoy en Santiago (`AAAA-MM-DD`). */
  readonly hoy: string;
  readonly resumenes: readonly RcvResumen[];
  readonly documentos: readonly DocumentoRcv[];
  readonly declaraciones: readonly F29Declaracion[];
  /** Valores del F29 vigente del período, si existe. */
  readonly valores: F29Valores | null;
  /** Valores del F29 vigente del período anterior, si existe. */
  readonly valoresAnterior: F29Valores | null;
  readonly snapshots: readonly SnapshotRcv[];
  readonly toleranciaPesos: number;
  /** Omitido conserva el contrato de los consumidores puros previos: todas las fuentes conocidas. */
  readonly disponibilidad?: DisponibilidadFuentes;
  /**
   * Boletas de honorarios recibidas del mes: si se consultaron y la suma de la retención de las no anuladas. Omitido
   * equivale a no consultadas.
   */
  readonly bhe?: { readonly consultado: boolean; readonly retencion: number };
  /** El SII autoriza declarar y pagar el F29 hasta el día 20 (Mi SII); null u omitido = se desconoce y se mantiene el día 20. */
  readonly autorizadoDia20?: boolean | null;
}

type DatosHallazgo = Omit<Hallazgo, 'rut' | 'periodo'>;

const hallazgo = (e: EntradaConciliacion, datos: DatosHallazgo): Hallazgo => ({ rut: e.rut, periodo: e.periodo.texto, ...datos });

function comparar(
  e: EntradaConciliacion,
  regla: string,
  titulo: string,
  esperado: number,
  declarado: number,
  detalle: string,
  evidencia: string[],
  tolerancia = e.toleranciaPesos,
): Hallazgo[] {
  const diferencia = esperado - declarado;
  if (Math.abs(diferencia) <= tolerancia) return [];
  return [hallazgo(e, { regla, severidad: 'critico', naturaleza: 'DERIVADO', titulo, detalle, montos: { esperado, declarado, diferencia }, evidencia })];
}

/** IVA-01: el débito de las ventas del RCV debe coincidir con el débito declarado en el F29 (sin 538 leído, cero). */
export function reglaDebito(e: EntradaConciliacion): Hallazgo[] {
  if (e.disponibilidad?.ventasRcv === false || !e.valores) return [];
  const declarado = debitoF29(e.valores);
  if (declarado === null) {
    return [
      hallazgo(e, {
        regla: 'IVA-01',
        severidad: 'advertencia',
        naturaleza: 'HECHO',
        titulo: 'F29 sin total de débitos legible',
        detalle: `No se encontró el código ${CODIGO_F29.TOTAL_DEBITOS} en el F29 folio ${e.valores.folio}.`,
        montos: null,
        evidencia: [`F29:${e.valores.folio}`],
      }),
    ];
  }
  const esperado = debitoRcv(e.resumenes);
  return comparar(
    e,
    'IVA-01',
    'El débito del RCV no coincide con el F29',
    esperado,
    declarado,
    `Débito según ventas del RCV: ${formatearClp(esperado)}. Débito del F29 (código ${CODIGO_F29.TOTAL_DEBITOS}): ${formatearClp(declarado)}. El 538 puede incluir débitos que no vienen del RCV.`,
    [`F29:${e.valores.folio}`, `RCV:VENTA:${e.periodo.texto}`],
  );
}

/** IVA-02: el crédito de las compras registradas debe coincidir con el crédito por documentos del F29 (sin 537 leído, cero). */
export function reglaCredito(e: EntradaConciliacion): Hallazgo[] {
  if (e.disponibilidad?.comprasRcv === false || !e.valores) return [];
  const declarado = creditoDocumentosF29(e.valores);
  if (declarado === null) {
    return [
      hallazgo(e, {
        regla: 'IVA-02',
        severidad: 'advertencia',
        naturaleza: 'HECHO',
        titulo: 'F29 sin total de créditos legible',
        detalle: `No se encontró el código ${CODIGO_F29.TOTAL_CREDITOS} en el F29 folio ${e.valores.folio}.`,
        montos: null,
        evidencia: [`F29:${e.valores.folio}`],
      }),
    ];
  }
  const esperado = creditoRcv(e.resumenes);
  return comparar(
    e,
    'IVA-02',
    'El crédito del RCV no coincide con el F29',
    esperado,
    declarado,
    `Crédito según compras registradas en el RCV: ${formatearClp(esperado)}. Crédito por documentos del F29 (${CODIGO_F29.TOTAL_CREDITOS} menos ${CODIGO_F29.REMANENTE_MES_ANTERIOR}): ${formatearClp(declarado)}.`,
    [`F29:${e.valores.folio}`, `RCV:COMPRA:${e.periodo.texto}`],
  );
}

/** El SII reajusta el remanente que arrastra un mes según la variación de la UTM: hasta esta fracción del 77 es reajuste. */
export const REAJUSTE_UTM_REMANENTE = 0.02;

/** IVA-03: el remanente que deja un mes (77) debe ser el que entra al siguiente (504), salvo el reajuste por la UTM. */
export function reglaRemanente(e: EntradaConciliacion): Hallazgo[] {
  // Sin los valores de ambos F29 no hay con qué comparar: no se inventa un remanente de 0.
  if (!e.valores || !e.valoresAnterior || !f29Leido(e.valores) || !f29Leido(e.valoresAnterior)) return [];
  const esperado = montoF29(e.valoresAnterior, CODIGO_F29.REMANENTE_PERIODO_SIGUIENTE) ?? 0;
  const declarado = montoF29(e.valores, CODIGO_F29.REMANENTE_MES_ANTERIOR) ?? 0;
  return comparar(
    e,
    'IVA-03',
    'El remanente no calza con el mes anterior',
    esperado,
    declarado,
    `F29 de ${periodoAnterior(e.periodo).texto} (código ${CODIGO_F29.REMANENTE_PERIODO_SIGUIENTE}): ${formatearClp(esperado)}. F29 de ${e.periodo.texto} (código ${CODIGO_F29.REMANENTE_MES_ANTERIOR}): ${formatearClp(declarado)}. Hasta un ${REAJUSTE_UTM_REMANENTE * 100} % de diferencia se atribuye al reajuste del remanente según la variación de la UTM.`,
    [`F29:${e.valoresAnterior.folio}`, `F29:${e.valores.folio}`],
    Math.max(e.toleranciaPesos, REAJUSTE_UTM_REMANENTE * esperado),
  );
}

/** F29-01: el F29 leído debe cumplir las relaciones internas entre sus totales; si no, la lectura es sospechosa. */
export function reglaF29Incoherente(e: EntradaConciliacion): Hallazgo[] {
  const incoherencias = verificarCoherenciaF29(e.valores);
  if (!e.valores || incoherencias.length === 0) return [];
  return [
    hallazgo(e, {
      regla: 'F29-01',
      severidad: 'advertencia',
      naturaleza: 'HECHO',
      titulo: 'El F29 leído no cuadra',
      detalle: `En el F29 folio ${e.valores.folio}: ${incoherencias.join('; ')}. Puede que el PDF se haya leído mal o que el SII haya cambiado el formulario.`,
      montos: null,
      evidencia: [`F29:${e.valores.folio}`],
    }),
  ];
}

/**
 * RET-01: la retención de las boletas de honorarios recibidas no anuladas del mes debe estar en el código 151 del F29.
 * Solo si las boletas se consultaron y el F29 se leyó. Nunca es crítica: una boleta pagada en otro mes se declara en
 * ese mes, y el 151 puede incluir otras retenciones.
 */
export function reglaRetencionHonorarios(e: EntradaConciliacion): Hallazgo[] {
  if (!e.bhe?.consultado || !e.valores || !f29Leido(e.valores)) return [];
  const esperado = e.bhe.retencion;
  const declarado = montoF29(e.valores, CODIGO_F29.RETENCION_HONORARIOS) ?? 0;
  const diferencia = esperado - declarado;
  if (Math.abs(diferencia) <= e.toleranciaPesos) return [];
  const montos = `Retención de las boletas de honorarios recibidas no anuladas: ${formatearClp(esperado)}. Código ${CODIGO_F29.RETENCION_HONORARIOS} del F29 folio ${e.valores.folio}: ${formatearClp(declarado)}.`;
  const menor = declarado < esperado;
  return [
    hallazgo(e, {
      regla: 'RET-01',
      severidad: menor ? 'advertencia' : 'info',
      naturaleza: 'DERIVADO',
      titulo: menor ? 'El F29 declara menos retención de honorarios que las boletas recibidas' : 'El F29 declara más retención de honorarios que las boletas recibidas',
      detalle: `${montos} ${
        menor
          ? 'La retención de honorarios declarada en el F29 (código 151) es menor que la de las boletas recibidas del mes. Si alguna boleta se pagó en otro mes, su retención va en ese mes.'
          : 'El F29 declara más retención que las boletas recibidas del mes (puede incluir boletas de terceros o boletas de meses anteriores pagadas este mes).'
      }`,
      montos: { esperado, declarado, diferencia },
      evidencia: [`F29:${e.valores.folio}`, `BHE:${e.periodo.texto}`],
    }),
  ];
}

/** Días antes del vencimiento del plazo de reclamo en que se avisa. */
export const DIAS_ALERTA_RECLAMO = 3;

/** Por qué hay declaraciones del período que no cuentan como presentadas. */
function explicacionesNoPresentadas(declaraciones: readonly F29Declaracion[]): string[] {
  const out = declaraciones.filter(f29Rechazada).map((d) => `El SII rechazó el folio ${d.folio} (${d.estado}).`);
  if (declaraciones.some((d) => f29Guardada(d) && !f29Rechazada(d))) out.push('Hay una declaración guardada sin presentar.');
  return out;
}

/**
 * IVA-04: período cerrado sin F29 presentado. Las empresas declaran aunque no tengan movimiento. Sin F29 ni dato de pago el
 * monto es desconocido, así que se gradúa por los vencimientos oficiales (docs/decisiones/0004-plazos-f29.md): hasta el día
 * de pago, pendiente; después y hasta el 28 (sin pago), posiblemente vencido; después del 28, vencido.
 */
export function reglaF29Faltante(e: EntradaConciliacion): Hallazgo[] {
  if (e.disponibilidad?.f29 === false) return [];
  if (declaracionVigente(e.declaraciones)) return [];
  if (compararPeriodos(e.periodo, periodoDeFecha(e.hoy)) >= 0) return [];
  const hayMovimiento = e.resumenes.some((r) => r.estado === 'REGISTRO' && r.filas.some((f) => f.cantidad > 0));
  if (e.tipo !== 'empresa' && !hayMovimiento) return [];
  const { conPago, sinPago } = vencimientosF29(e.periodo, { autorizadoDia20: e.autorizadoDia20 ?? null });
  const motivo = [
    hayMovimiento ? 'El período tiene movimiento en el RCV.' : 'Aunque no haya movimiento, el F29 se declara igual.',
    ...explicacionesNoPresentadas(e.declaraciones),
  ].join(' ');
  const evidencia = [`F29:${e.periodo.texto}`];
  const diasConPago = diasEntre(e.hoy, conPago);
  const diasSinPago = diasEntre(e.hoy, sinPago);
  if (diasSinPago < 0) {
    return [
      hallazgo(e, {
        regla: 'IVA-04',
        severidad: 'critico',
        naturaleza: 'DERIVADO',
        titulo: 'F29 no presentado y vencido',
        detalle: `El F29 de ${e.periodo.texto} venció el ${sinPago} (hace ${-diasSinPago} día(s)) aun sin pago; con pago venció el ${conPago}. ${motivo}`,
        montos: null,
        evidencia,
      }),
    ];
  }
  if (diasConPago < 0) {
    return [
      hallazgo(e, {
        regla: 'IVA-04',
        severidad: 'advertencia',
        naturaleza: 'DERIVADO',
        titulo: 'F29 posiblemente vencido',
        detalle: `El F29 de ${e.periodo.texto} no figura presentado y está posiblemente vencido: si el F29 lleva pago, venció el ${conPago}; sin pago vence el ${sinPago} (en ${diasSinPago} día(s)). Sin F29 ni dato de pago no se sabe si lleva pago. ${motivo}`,
        montos: null,
        evidencia,
      }),
    ];
  }
  return [
    hallazgo(e, {
      regla: 'IVA-04',
      severidad: 'advertencia',
      naturaleza: 'DERIVADO',
      titulo: 'F29 pendiente de presentar',
      detalle: `El F29 de ${e.periodo.texto} vence el ${conPago} con pago (en ${diasConPago} día(s)); sin pago, el ${sinPago}. ${motivo}`,
      montos: null,
      evidencia,
    }),
  ];
}

/** IVA-05: facturas de compra pendientes cuyo plazo de reclamo (8 días corridos) vence pronto o ya venció. */
export function reglaReclamo(e: EntradaConciliacion): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const d of e.documentos) {
    if (d.lado !== 'COMPRA' || d.estado !== 'PENDIENTE' || !d.fechaRecepcion) continue;
    const vence = vencimientoReclamo(d.fechaRecepcion);
    const dias = diasEntre(e.hoy, vence);
    if (dias > DIAS_ALERTA_RECLAMO) continue;
    const doc = `${nombreTipoDocumento(d.tipoDoc)} folio ${d.folio} de ${d.razonSocial ?? d.rutContraparte} por ${formatearClp(d.montoTotal)}`;
    out.push(
      hallazgo(
        e,
        dias < 0
          ? {
              regla: 'IVA-05',
              severidad: 'info',
              naturaleza: 'DERIVADO',
              titulo: 'Venció el plazo para reclamar una factura',
              detalle: `${doc}: el plazo venció el ${vence}; se entiende aceptada.`,
              montos: null,
              evidencia: [claveDocumento(d)],
            }
          : {
              regla: 'IVA-05',
              severidad: 'advertencia',
              naturaleza: 'DERIVADO',
              titulo: 'Factura por revisar: vence el plazo de reclamo',
              detalle: `${doc}: quedan ${dias} día(s) para reclamarla (vence el ${vence}).`,
              montos: null,
              evidencia: [claveDocumento(d)],
            },
      ),
    );
  }
  return out;
}

const registrados = (s: SnapshotRcv): Map<string, string> => new Map(s.filas.filter((f) => f.estado === 'REGISTRO').map((f) => [f.clave, f.sha]));

/** IVA-06: el RCV del período cambió después de presentar el F29 (posible rectificación). */
export function reglaCambiosPostF29(e: EntradaConciliacion): Hallazgo[] {
  const vigente = declaracionVigente(e.declaraciones);
  const presentado = vigente?.fechaPresentacion?.slice(0, 10);
  if (!vigente || !presentado) return [];
  const out: Hallazgo[] = [];
  const lados: readonly Lado[] = ['VENTA', 'COMPRA'];
  for (const lado of lados) {
    const posteriores = e.snapshots.filter((s) => s.lado === lado && fechaEnSantiago(new Date(s.obtenidoEn)) >= presentado);
    if (posteriores.length < 2) continue;
    const base = registrados(posteriores[0]!);
    const ultimo = registrados(posteriores[posteriores.length - 1]!);
    const nuevos = [...ultimo.keys()].filter((k) => !base.has(k));
    const eliminados = [...base.keys()].filter((k) => !ultimo.has(k));
    const modificados = [...ultimo.keys()].filter((k) => base.has(k) && base.get(k) !== ultimo.get(k));
    if (nuevos.length + eliminados.length + modificados.length === 0) continue;
    out.push(
      hallazgo(e, {
        regla: 'IVA-06',
        severidad: 'advertencia',
        naturaleza: 'DERIVADO',
        titulo: 'El RCV cambió después de presentar el F29',
        detalle: `${lado === 'VENTA' ? 'Ventas' : 'Compras'}: ${nuevos.length} documento(s) nuevo(s), ${eliminados.length} eliminado(s) y ${modificados.length} modificado(s) desde el ${fechaEnSantiago(new Date(posteriores[0]!.obtenidoEn))}. Revisa si corresponde rectificar el F29 folio ${vigente.folio}.`,
        montos: null,
        evidencia: [...nuevos, ...eliminados, ...modificados].slice(0, 50),
      }),
    );
  }
  return out;
}

/** IVA-07: compras registradas con IVA no recuperable o de uso común, para revisar su tratamiento. */
export function reglaIvaEspecial(e: EntradaConciliacion): Hallazgo[] {
  const docs = e.documentos.filter((d) => d.lado === 'COMPRA' && d.estado === 'REGISTRO' && (d.montoIvaNoRecuperable > 0 || d.montoIvaUsoComun > 0));
  if (docs.length === 0) return [];
  const noRecuperable = docs.reduce((s, d) => s + d.montoIvaNoRecuperable, 0);
  const usoComun = docs.reduce((s, d) => s + d.montoIvaUsoComun, 0);
  return [
    hallazgo(e, {
      regla: 'IVA-07',
      severidad: 'info',
      naturaleza: 'HECHO',
      titulo: 'Compras con IVA no recuperable o de uso común',
      detalle: `${docs.length} documento(s): IVA no recuperable ${formatearClp(noRecuperable)} e IVA de uso común ${formatearClp(usoComun)}. Revisa que el crédito usado en el F29 respete la proporcionalidad.`,
      montos: null,
      evidencia: docs.map(claveDocumento),
    }),
  ];
}
