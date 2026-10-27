import { describe, expect, it } from 'vitest';
import { ErrorMiSiiMcp } from '../../src/domain/errores.js';
import { calcularDv, formatearRut, parseRut } from '../../src/domain/rut.js';

describe('rut', () => {
  it.each([
    ['6', 'K'],
    ['28', '0'],
    ['11111111', '1'],
    ['22222222', '2'],
    ['33333333', '3'],
    ['44444444', '4'],
    ['55555555', '5'],
    ['66666666', '6'],
  ])('calcula el DV de %s', (cuerpo, dv) => {
    expect(calcularDv(Number(cuerpo))).toBe(dv);
  });

  it('normaliza puntos, guion y espacios', () => {
    expect(parseRut('11.111.111-1').canonico).toBe('11111111-1');
    expect(parseRut(' 22.222.222 - 2 ').canonico).toBe('22222222-2');
    expect(parseRut('333333333')).toEqual({ cuerpo: 33333333, dv: '3', canonico: '33333333-3' });
  });

  it('normaliza k minúscula antes de validar el DV del cuerpo sintético', () => {
    expect(() => parseRut('11.111.111-k')).toThrowError('Dígito verificador incorrecto');
  });

  it.each(['11.111.111-4', 'abc', '0-0', '', '1111111111-1'])('rechaza "%s" con RUT_INVALIDO', (entrada) => {
    let error: unknown;
    try {
      parseRut(entrada);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorMiSiiMcp);
    expect((error as ErrorMiSiiMcp).codigo).toBe('RUT_INVALIDO');
  });

  it('formatea con puntos', () => {
    expect(formatearRut(parseRut('22222222-2'))).toBe('22.222.222-2');
    expect(formatearRut(parseRut('66666666-6'))).toBe('66.666.666-6');
  });
});
