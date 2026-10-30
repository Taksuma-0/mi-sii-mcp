/** `$1.234.567`; los negativos como `-$5.000`. */
export function formatearClp(n: number): string {
  const absoluto = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}$${absoluto}`;
}

export const NOMBRES_TIPO_DOCUMENTO: Readonly<Record<number, string>> = {
  29: 'Factura de inicio',
  30: 'Factura',
  32: 'Factura exenta',
  33: 'Factura',
  34: 'Factura exenta',
  35: 'Boleta',
  38: 'Boleta exenta',
  39: 'Boleta',
  41: 'Boleta exenta',
  43: 'Liquidación factura',
  45: 'Factura de compra',
  46: 'Factura de compra',
  48: 'Comprobante de pago electrónico',
  52: 'Guía de despacho',
  55: 'Nota de débito',
  56: 'Nota de débito',
  60: 'Nota de crédito',
  61: 'Nota de crédito',
  110: 'Factura de exportación',
  111: 'Nota de débito de exportación',
  112: 'Nota de crédito de exportación',
  914: 'Declaración de ingreso (importación)',
};

export const nombreTipoDocumento = (tipo: number): string => NOMBRES_TIPO_DOCUMENTO[tipo] ?? `Documento tipo ${tipo}`;

/** Una celda de una tabla exportable: texto, número o vacía. */
export type CeldaCsv = string | number | null;

const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function celdaCsv(valor: CeldaCsv): string {
  if (valor === null) return '';
  if (typeof valor === 'number') return String(Math.round(valor) === valor ? valor : valor.toFixed(2).replace('.', ','));
  const fecha = FECHA_ISO.exec(valor);
  if (fecha) return `${fecha[3]}-${fecha[2]}-${fecha[1]}`;
  return /[;"\r\n]/.test(valor) ? `"${valor.replaceAll('"', '""')}"` : valor;
}

/**
 * CSV que Excel en español abre bien: BOM UTF-8, punto y coma, fechas `dd-mm-aaaa`, montos enteros sin separador de miles
 * (con coma decimal si los hay) y comillas solo donde hacen falta.
 */
export function aCsv(columnas: readonly string[], filas: readonly (readonly CeldaCsv[])[]): string {
  return `﻿${[columnas, ...filas].map((f) => f.map(celdaCsv).join(';')).join('\r\n')}\r\n`;
}
