import { describe, expect, it } from 'vitest';
import { esDiaHabil, siguienteDiaHabil, vencimientoReclamo, vencimientosF29 } from '../../src/calendar/plazos.js';
import { parsePeriodo } from '../../src/domain/periodo.js';

const venc = (periodo: string, autorizadoDia20: boolean | null = true) => vencimientosF29(parsePeriodo(periodo), { autorizadoDia20 });

describe('plazos', () => {
  it('distingue días hábiles de fines de semana y feriados', () => {
    expect(esDiaHabil('2026-10-21')).toBe(true);
    expect(esDiaHabil('2026-10-24')).toBe(false);
    expect(esDiaHabil('2026-09-18')).toBe(false);
  });

  it('el 31 de diciembre no es día hábil aunque caiga en día de semana', () => {
    expect(esDiaHabil('2026-12-30')).toBe(true);
    expect(esDiaHabil('2026-12-31')).toBe(false);
    expect(esDiaHabil('2027-12-31')).toBe(false);
  });

  it('salta fin de semana y feriados al siguiente día hábil', () => {
    expect(siguienteDiaHabil('2026-09-18')).toBe('2026-09-21');
    expect(siguienteDiaHabil('2026-10-21')).toBe('2026-10-21');
  });

  it('desde el 31 de diciembre salta el feriado del 1 de enero y el fin de semana', () => {
    // 31/12/2026 jueves, 1/1/2027 viernes feriado, 2 y 3 fin de semana.
    expect(siguienteDiaHabil('2026-12-31')).toBe('2027-01-04');
  });

  it.each([
    ['2026-09', '2026-10-20'],
    ['2026-08', '2026-09-21'],
    ['2026-05', '2026-06-22'],
    ['2026-12', '2027-01-20'],
    ['2100-12', '2101-01-20'],
  ])('con autorización del día 20, el F29 de %s con pago vence el %s', (periodo, vence) => {
    expect(venc(periodo).conPago).toBe(vence);
  });

  it('si el día 20 es feriado pasa al siguiente día hábil', () => {
    // 20/6/2025 viernes feriado → lunes 23 (el 21 es sábado y el 22 domingo).
    expect(venc('2025-05').conPago).toBe('2025-06-23');
  });

  it('si el día 20 es sábado pasa al lunes (con el domingo feriado de por medio)', () => {
    expect(venc('2026-05').conPago).toBe('2026-06-22');
  });

  it('si se desconoce la autorización se mantiene el día 20', () => {
    expect(venc('2026-09', null)).toEqual(venc('2026-09', true));
    expect(venc('2025-05', null).conPago).toBe('2025-06-23');
  });

  it('sin autorización del día 20, con pago vence el 12', () => {
    expect(venc('2026-07', false).conPago).toBe('2026-08-12');
    expect(venc('2026-11', false).conPago).toBe('2026-12-14');
  });

  it('sin autorización, el 12 también pasa al siguiente día hábil (feriado y sábado)', () => {
    // 12/10/2026 lunes feriado → martes 13.
    expect(venc('2026-09', false).conPago).toBe('2026-10-13');
    // 12/9/2026 sábado → lunes 14.
    expect(venc('2026-08', false).conPago).toBe('2026-09-14');
  });

  it('sin pago vence el 28 del mes siguiente, haya o no autorización del día 20', () => {
    expect(venc('2026-09').sinPago).toBe('2026-10-28');
    expect(venc('2026-09', false).sinPago).toBe('2026-10-28');
    expect(venc('2026-09', null).sinPago).toBe('2026-10-28');
    expect(venc('2026-12').sinPago).toBe('2027-01-28');
    expect(venc('2100-12').sinPago).toBe('2101-01-28');
  });

  it('el día 28 sin pago no se traslada aunque caiga en sábado', () => {
    // 28/2/2026 es sábado.
    expect(venc('2026-01').sinPago).toBe('2026-02-28');
  });

  it('el plazo de reclamo es de 8 días corridos desde la recepción', () => {
    expect(vencimientoReclamo('2026-10-01 10:22:33')).toBe('2026-10-09');
    expect(vencimientoReclamo('2026-12-28')).toBe('2027-01-05');
  });
});
