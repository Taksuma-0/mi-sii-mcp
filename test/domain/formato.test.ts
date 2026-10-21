import { describe, expect, it } from 'vitest';
import { formatearClp, nombreTipoDocumento } from '../../src/domain/formato.js';

describe('formato', () => {
  it('formatea pesos chilenos con punto de miles', () => {
    expect(formatearClp(1_234_567)).toBe('$1.234.567');
    expect(formatearClp(-5_000)).toBe('-$5.000');
    expect(formatearClp(0)).toBe('$0');
  });

  it('nombra los tipos de documento', () => {
    expect(nombreTipoDocumento(33)).toBe('Factura');
    expect(nombreTipoDocumento(61)).toBe('Nota de crédito');
    expect(nombreTipoDocumento(999)).toBe('Documento tipo 999');
  });
});
