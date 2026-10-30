import type { MovimientoBancario, TipoPartida } from '../domain/banco.js';
import { CUENTAS, cuentaDeCompra } from '../domain/contabilidad.js';
import { nombreTipoDocumento } from '../domain/formato.js';
import { claveDocumento, type BoletaHonorarios, type BoletaHonorariosEmitida, type DocumentoRcv } from '../domain/tipos.js';
import { CODIGO_F29, signoTipoDoc } from './mapeo-f29.js';

export interface LineaAsiento {
  readonly cuenta: string;
  readonly debe: number;
  readonly haber: number;
}

/** Un asiento propuesto: siempre cuadra (Σ debe = Σ haber); lo que no se sabe dónde va queda en «por clasificar». */
export interface Asiento {
  readonly fecha: string;
  readonly glosa: string;
  /** De qué sale: `RCV:<documento>`, `BOLETAS:<período>:<tipo>`, `BHE:R:…`, `BHE:E:…`, `F29:<período>:<folio>` o `BANCO:<huella>`. */
  readonly origen: string;
  readonly lineas: readonly LineaAsiento[];
}

/** Resumen de boletas de venta de un mes (el RCV no las trae una por una). */
export interface ResumenBoletas {
  readonly periodo: string;
  readonly tipoDoc: number;
  readonly cantidad: number;
  readonly exento: number;
  readonly neto: number;
  readonly iva: number;
  readonly total: number;
}

export interface F29Asiento {
  readonly periodo: string;
  readonly folio: number;
  /** Fecha de presentación (o de pago) `AAAA-MM-DD`. */
  readonly fecha: string;
  readonly valores: Readonly<Record<string, number>>;
}

export interface EntradaAsientos {
  /** Documentos registrados del RCV (compras y ventas). */
  readonly documentos: readonly DocumentoRcv[];
  readonly resumenesBoletas: readonly ResumenBoletas[];
  readonly boletasRecibidas: readonly BoletaHonorarios[];
  readonly boletasEmitidas: readonly BoletaHonorariosEmitida[];
  readonly f29: readonly F29Asiento[];
  /** Movimientos del banco con el tipo de partida con que se conciliaron; null si no se conciliaron o se descartaron. */
  readonly banco: readonly { readonly movimiento: MovimientoBancario; readonly tipo: TipoPartida | null }[];
  /** Reglas por proveedor: RUT → cuenta. */
  readonly reglas: ReadonlyMap<string, string>;
}

const debe = (cuenta: string, monto: number): LineaAsiento => ({ cuenta, debe: monto, haber: 0 });
const haber = (cuenta: string, monto: number): LineaAsiento => ({ cuenta, debe: 0, haber: monto });

/**
 * Arma un asiento: invierte el lado de los montos negativos, quita las líneas en cero y, si no cuadra (otros impuestos,
 * redondeos), deja la diferencia en «por clasificar» antes de la última línea (la contrapartida).
 */
function asiento(fecha: string, glosa: string, origen: string, lineas: readonly LineaAsiento[]): Asiento {
  const normales = lineas.map((l) => (l.debe < 0 || l.haber < 0 ? { cuenta: l.cuenta, debe: -l.haber || 0, haber: -l.debe || 0 } : l)).filter((l) => l.debe !== 0 || l.haber !== 0);
  const diferencia = normales.reduce((s, l) => s + l.debe - l.haber, 0);
  const ajustadas = diferencia === 0 ? normales : [...normales.slice(0, -1), diferencia > 0 ? haber(CUENTAS.POR_CLASIFICAR, diferencia) : debe(CUENTAS.POR_CLASIFICAR, -diferencia), ...normales.slice(-1)];
  return { fecha, glosa, origen, lineas: ajustadas };
}

function asientoDocumento(d: DocumentoRcv, reglas: ReadonlyMap<string, string>): Asiento {
  const s = signoTipoDoc(d.tipoDoc);
  const fecha = d.fechaEmision?.slice(0, 10) ?? `${d.periodo}-01`;
  const glosa = `${nombreTipoDocumento(d.tipoDoc)} ${d.folio} ${d.razonSocial ?? d.rutContraparte}`;
  const origen = `RCV:${claveDocumento(d)}`;
  if (d.lado === 'VENTA') {
    return asiento(fecha, glosa, origen, [debe(CUENTAS.CLIENTES, s * d.montoTotal), haber(CUENTAS.VENTAS, s * d.montoNeto), haber(CUENTAS.VENTAS_EXENTAS, s * d.montoExento), haber(CUENTAS.IVA_DF, s * d.montoIva)]);
  }
  const { cuenta, iva } = cuentaDeCompra(d, reglas);
  const recuperable = iva === 'recuperable' ? d.montoIva : 0;
  const noRecuperable = d.montoIvaNoRecuperable + (iva === 'gasto' ? d.montoIva : 0);
  const usoComun = d.montoIvaUsoComun + (iva === 'uso_comun' ? d.montoIva : 0);
  return asiento(fecha, glosa, origen, [
    debe(cuenta, s * (d.montoNeto + d.montoExento)),
    debe(CUENTAS.IVA_CF, s * recuperable),
    debe(CUENTAS.IVA_NO_RECUPERABLE, s * noRecuperable),
    debe(CUENTAS.IVA_USO_COMUN, s * usoComun),
    haber(CUENTAS.PROVEEDORES, s * d.montoTotal),
  ]);
}

/** Centralización del F29: el IVA del mes (usando solo el crédito necesario), PPM, retenciones, impuesto único y recargos. */
function asientoF29(f: F29Asiento): Asiento {
  const v = (codigo: string): number => f.valores[codigo] ?? 0;
  const debito = v(CODIGO_F29.TOTAL_DEBITOS);
  const iva = Math.max(debito - v(CODIGO_F29.TOTAL_CREDITOS), 0);
  const enPlazo = iva + v('62') + v(CODIGO_F29.RETENCION_HONORARIOS) + v('48');
  const recargos = Math.max((f.valores[CODIGO_F29.TOTAL_CON_RECARGO] ?? enPlazo) - enPlazo, 0);
  return asiento(f.fecha, `F29 de ${f.periodo} folio ${f.folio}`, `F29:${f.periodo}:${f.folio}`, [
    debe(CUENTAS.IVA_DF, debito),
    haber(CUENTAS.IVA_CF, debito - iva),
    debe(CUENTAS.PPM, v('62')),
    debe(CUENTAS.RETENCIONES, v(CODIGO_F29.RETENCION_HONORARIOS)),
    debe(CUENTAS.IMPUESTO_UNICO, v('48')),
    debe(CUENTAS.MULTAS, recargos),
    haber(CUENTAS.IMPUESTOS_POR_PAGAR, enPlazo + recargos),
  ]);
}

/** La cuenta que salda un cobro o pago del banco, según con qué se concilió. */
const CONTRAPARTIDA_BANCO: Readonly<Record<TipoPartida, string>> = {
  venta: CUENTAS.CLIENTES,
  bhe_emitida: CUENTAS.CLIENTES,
  compra: CUENTAS.PROVEEDORES,
  bhe_recibida: CUENTAS.HONORARIOS_POR_PAGAR,
  f29: CUENTAS.IMPUESTOS_POR_PAGAR,
  f22: CUENTAS.POR_CLASIFICAR,
};

function asientoBanco(m: MovimientoBancario, tipo: TipoPartida | null): Asiento {
  const contrapartida = tipo === null ? CUENTAS.POR_CLASIFICAR : CONTRAPARTIDA_BANCO[tipo];
  const lineas = m.monto >= 0 ? [debe(CUENTAS.BANCO, m.monto), haber(contrapartida, m.monto)] : [debe(contrapartida, -m.monto), haber(CUENTAS.BANCO, -m.monto)];
  return asiento(m.fecha, `${m.descripcion}${tipo === null ? ' (sin conciliar)' : ''}`, `BANCO:${m.huella}`, lineas);
}

/**
 * Asientos propuestos de un período a partir de lo que sabe mi-sii-mcp: ventas y compras del RCV, boletas de venta,
 * boletas de honorarios recibidas y emitidas, la centralización de cada F29 y los movimientos del banco. Es una propuesta
 * para revisar y llevar al software contable, no una contabilidad completa (faltan sueldos, inventario, depreciación…).
 */
export function asientosDelPeriodo(e: EntradaAsientos): Asiento[] {
  const asientos = [
    ...e.documentos.map((d) => asientoDocumento(d, e.reglas)),
    ...e.resumenesBoletas.map((b) =>
      asiento(`${b.periodo}-01`, `${nombreTipoDocumento(b.tipoDoc)}: ${b.cantidad} del mes`, `BOLETAS:${b.periodo}:${b.tipoDoc}`, [
        debe(CUENTAS.CLIENTES, b.total),
        haber(CUENTAS.VENTAS, b.neto),
        haber(CUENTAS.VENTAS_EXENTAS, b.exento),
        haber(CUENTAS.IVA_DF, b.iva),
      ]),
    ),
    ...e.boletasRecibidas
      .filter((b) => !b.anulada)
      .map((b) =>
        asiento(b.fecha ?? `${b.periodo}-01`, `Boleta de honorarios ${b.folio} ${b.nombreEmisor ?? b.rutEmisor}`, `BHE:R:${b.rutEmisor}:${b.folio}`, [
          debe(CUENTAS.HONORARIOS, b.bruto),
          haber(CUENTAS.RETENCIONES, b.retencion),
          haber(CUENTAS.HONORARIOS_POR_PAGAR, b.liquido),
        ]),
      ),
    ...e.boletasEmitidas
      .filter((b) => !b.anulada)
      .map((b) =>
        asiento(b.fecha ?? `${b.periodo}-01`, `Boleta de honorarios emitida ${b.folio} ${b.nombreReceptor ?? b.rutReceptor}`, `BHE:E:${b.folio}`, [
          debe(CUENTAS.CLIENTES, b.liquido),
          debe(CUENTAS.RETENCIONES_POR_RECUPERAR, b.retencionReceptor + b.retencionEmisor),
          haber(CUENTAS.INGRESOS_HONORARIOS, b.bruto),
        ]),
      ),
    ...e.f29.map(asientoF29),
    ...e.banco.map(({ movimiento, tipo }) => asientoBanco(movimiento, tipo)),
  ];
  // Orden estable por fecha: dentro del mismo día se conserva el orden de origen (documentos, boletas, F29, banco).
  return asientos.sort((a, b) => a.fecha.localeCompare(b.fecha));
}
