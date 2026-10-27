import { describe, expect, it } from 'vitest';
import { ErrorMiSiiMcp } from '../../src/domain/errores.js';
import {
  compararPeriodos,
  parsePeriodo,
  periodoAnterior,
  periodoDeFecha,
  periodoSiguiente,
  periodoSii,
  rangoPeriodos,
  restarPeriodos,
} from '../../src/domain/periodo.js';

describe('periodo', () => {
  it('parsea AAAA-MM y AAAAMM', () => {
    expect(parsePeriodo('2026-09')).toEqual({ anio: 2026, mes: 9, texto: '2026-09' });
    expect(parsePeriodo('202609').texto).toBe('2026-09');
  });

  it.each(['2026-13', '2026-00', '26-09', '1999-12', '2026/09', ''])('rechaza "%s"', (entrada) => {
    expect(() => parsePeriodo(entrada)).toThrow(ErrorMiSiiMcp);
  });

  it('formatea para el SII y navega meses', () => {
    expect(periodoSii(parsePeriodo('2026-09'))).toBe('202609');
    expect(periodoSiguiente(parsePeriodo('2026-12')).texto).toBe('2027-01');
    expect(periodoAnterior(parsePeriodo('2026-01')).texto).toBe('2025-12');
    expect(restarPeriodos(parsePeriodo('2026-03'), 12).texto).toBe('2025-03');
    expect(compararPeriodos(parsePeriodo('2026-01'), parsePeriodo('2025-12'))).toBeGreaterThan(0);
  });

  it('arma rangos inclusivos', () => {
    expect(rangoPeriodos(parsePeriodo('2026-11'), parsePeriodo('2027-02')).map((p) => p.texto)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('rechaza rangos invertidos o demasiado largos', () => {
    expect(() => rangoPeriodos(parsePeriodo('2026-05'), parsePeriodo('2026-04'))).toThrow(ErrorMiSiiMcp);
    expect(() => rangoPeriodos(parsePeriodo('2000-01'), parsePeriodo('2026-01'))).toThrow(ErrorMiSiiMcp);
  });

  it('incluye el último período permitido sin avanzar fuera del dominio', () => {
    expect(rangoPeriodos(parsePeriodo('2100-11'), parsePeriodo('2100-12')).map((p) => p.texto)).toEqual([
      '2100-11',
      '2100-12',
    ]);
  });

  it('obtiene el período de una fecha', () => {
    expect(periodoDeFecha('2026-10-21').texto).toBe('2026-10');
  });
});
