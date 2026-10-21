/** `$1.234.567`; los negativos como `-$5.000`. */
export function formatearClp(n: number): string {
  const absoluto = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}$${absoluto}`;
}

const NOMBRES_TIPO: Readonly<Record<number, string>> = {
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

export const nombreTipoDocumento = (tipo: number): string => NOMBRES_TIPO[tipo] ?? `Documento tipo ${tipo}`;
