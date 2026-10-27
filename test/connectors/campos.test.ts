import { describe, expect, it } from 'vitest';
import { aNumero, numeroChileno } from '../../src/connectors/sii/campos.js';

describe('aNumero', () => {
  it('lee miles con punto y decimales con coma, como en el PDF del F29', () => {
    expect(aNumero('12.345.678')).toBe(12_345_678);
    expect(aNumero('-1.000')).toBe(-1000);
    expect(aNumero('12,5')).toBe(12.5);
    expect(aNumero('0.5')).toBe(0.5);
    expect(aNumero('1.25')).toBe(1.25);
    expect(aNumero('77')).toBe(77);
  });

  it('lee miles con punto y decimales con coma juntos', () => {
    expect(aNumero('1.234,5')).toBe(1234.5);
  });
});

describe('numeroChileno', () => {
  it('convierte textos en formato chileno, con signo', () => {
    expect(numeroChileno('12.345.678')).toBe(12_345_678);
    expect(numeroChileno(' -250.000 ')).toBe(-250_000);
    expect(numeroChileno('+1.000')).toBe(1000);
    expect(numeroChileno('- 1.000')).toBe(-1000);
    expect(numeroChileno('12,5')).toBe(12.5);
    expect(numeroChileno('1.234.567,89')).toBe(1_234_567.89);
    expect(numeroChileno('0')).toBe(0);
  });

  it('acepta números ya numéricos', () => {
    expect(numeroChileno(1234)).toBe(1234);
    expect(numeroChileno(-5.5)).toBe(-5.5);
    expect(numeroChileno(Number.NaN)).toBeNull();
  });

  it('lo vacío, ausente o no numérico vale null, nunca 0', () => {
    for (const v of [undefined, null, '', '   ', 'abc', '15/04/2026', '12.34.5', '1,2,3', '$ 100', '1e3', true, {}, []]) {
      expect(numeroChileno(v), JSON.stringify(v)).toBeNull();
    }
  });
});
