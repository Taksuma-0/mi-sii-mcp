import type { DocumentoRcv } from './tipos.js';

export type TipoCuenta = 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'gasto';

export interface CuentaContable {
  readonly codigo: string;
  readonly nombre: string;
  readonly tipo: TipoCuenta;
}

/** Cuentas que usan los asientos propuestos; cada contribuyente puede renombrarlas o sumar las suyas. */
export const CUENTAS = {
  BANCO: '1101',
  CLIENTES: '1103',
  IVA_CF: '1105',
  IVA_USO_COMUN: '1106',
  PPM: '1107',
  ACTIVO_FIJO: '1201',
  BIENES_RAICES: '1202',
  PROVEEDORES: '2101',
  IVA_DF: '2103',
  RETENCIONES: '2104',
  IMPUESTO_UNICO: '2105',
  PPM_POR_PAGAR: '2106',
  HONORARIOS_POR_PAGAR: '2107',
  IMPUESTOS_POR_PAGAR: '2108',
  VENTAS: '4101',
  VENTAS_EXENTAS: '4102',
  INGRESOS_HONORARIOS: '4103',
  COSTOS: '5101',
  GASTOS_GENERALES: '5201',
  HONORARIOS: '5202',
  IVA_NO_RECUPERABLE: '5203',
  POR_CLASIFICAR: '9999',
} as const;

/** Plan de cuentas básico de una pyme: lo justo para los asientos que salen del RCV, las boletas, el F29 y el banco. */
export const PLAN_CUENTAS_BASE: readonly CuentaContable[] = [
  { codigo: CUENTAS.BANCO, nombre: 'Banco', tipo: 'activo' },
  { codigo: CUENTAS.CLIENTES, nombre: 'Clientes', tipo: 'activo' },
  { codigo: CUENTAS.IVA_CF, nombre: 'IVA crédito fiscal', tipo: 'activo' },
  { codigo: CUENTAS.IVA_USO_COMUN, nombre: 'IVA de uso común por proporcionar', tipo: 'activo' },
  { codigo: CUENTAS.PPM, nombre: 'Pagos provisionales mensuales (PPM)', tipo: 'activo' },
  { codigo: CUENTAS.ACTIVO_FIJO, nombre: 'Activo fijo', tipo: 'activo' },
  { codigo: CUENTAS.BIENES_RAICES, nombre: 'Bienes raíces', tipo: 'activo' },
  { codigo: CUENTAS.PROVEEDORES, nombre: 'Proveedores', tipo: 'pasivo' },
  { codigo: CUENTAS.IVA_DF, nombre: 'IVA débito fiscal', tipo: 'pasivo' },
  { codigo: CUENTAS.RETENCIONES, nombre: 'Retenciones de honorarios por pagar', tipo: 'pasivo' },
  { codigo: CUENTAS.IMPUESTO_UNICO, nombre: 'Impuesto único por pagar', tipo: 'pasivo' },
  { codigo: CUENTAS.PPM_POR_PAGAR, nombre: 'PPM por pagar', tipo: 'pasivo' },
  { codigo: CUENTAS.HONORARIOS_POR_PAGAR, nombre: 'Honorarios por pagar', tipo: 'pasivo' },
  { codigo: CUENTAS.IMPUESTOS_POR_PAGAR, nombre: 'Impuestos por pagar (F29)', tipo: 'pasivo' },
  { codigo: CUENTAS.VENTAS, nombre: 'Ventas', tipo: 'ingreso' },
  { codigo: CUENTAS.VENTAS_EXENTAS, nombre: 'Ventas exentas', tipo: 'ingreso' },
  { codigo: CUENTAS.INGRESOS_HONORARIOS, nombre: 'Ingresos por honorarios', tipo: 'ingreso' },
  { codigo: CUENTAS.COSTOS, nombre: 'Costos y gastos del giro', tipo: 'gasto' },
  { codigo: CUENTAS.GASTOS_GENERALES, nombre: 'Gastos generales', tipo: 'gasto' },
  { codigo: CUENTAS.HONORARIOS, nombre: 'Honorarios', tipo: 'gasto' },
  { codigo: CUENTAS.IVA_NO_RECUPERABLE, nombre: 'IVA no recuperable', tipo: 'gasto' },
  { codigo: CUENTAS.POR_CLASIFICAR, nombre: 'Por clasificar', tipo: 'gasto' },
];

/** Cómo se trata el IVA de una compra: crédito fiscal, IVA de uso común por proporcionar o mayor gasto. */
export type TratamientoIva = 'recuperable' | 'uso_comun' | 'gasto';

/**
 * Tipo de compra del RCV («tipo de transacción», campo `detTipoTransaccion`), según las instrucciones del registro de
 * compras del SII (https://www.sii.cl/ayudas/ayudas_por_servicios/FormatoyValidacionesCompras.pdf, revisado el
 * 30-10-2026): 1 del giro, 2 supermercados o similares, 3 bienes raíces, 4 activo fijo, 5 IVA uso común, 6 sin derecho a
 * crédito y 7 que no corresponde incluir.
 */
const POR_TIPO_COMPRA: Readonly<Record<string, { readonly cuenta: string; readonly iva: TratamientoIva }>> = {
  '1': { cuenta: CUENTAS.COSTOS, iva: 'recuperable' },
  '2': { cuenta: CUENTAS.GASTOS_GENERALES, iva: 'recuperable' },
  '3': { cuenta: CUENTAS.BIENES_RAICES, iva: 'recuperable' },
  '4': { cuenta: CUENTAS.ACTIVO_FIJO, iva: 'recuperable' },
  '5': { cuenta: CUENTAS.COSTOS, iva: 'uso_comun' },
  '6': { cuenta: CUENTAS.GASTOS_GENERALES, iva: 'gasto' },
  '7': { cuenta: CUENTAS.POR_CLASIFICAR, iva: 'gasto' },
};

/**
 * Cuenta de una compra y el trato de su IVA, según su tipo de compra en el RCV; una regla por proveedor (RUT → cuenta)
 * cambia la cuenta, nunca el trato del IVA. Sin tipo informado, se toma como compra del giro.
 */
export function cuentaDeCompra(doc: Pick<DocumentoRcv, 'tipoCompra' | 'rutContraparte'>, reglas: ReadonlyMap<string, string>): { readonly cuenta: string; readonly iva: TratamientoIva } {
  const base = POR_TIPO_COMPRA[doc.tipoCompra ?? '1'] ?? POR_TIPO_COMPRA['1']!;
  return { cuenta: reglas.get(doc.rutContraparte) ?? base.cuenta, iva: base.iva };
}
