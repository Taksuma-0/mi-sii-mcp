import { describe, expect, it } from 'vitest';
import { esDiaHabil, siguienteDiaHabil, vencimientoF29, vencimientoReclamo } from '../../src/calendar/plazos.js';
import { parsePeriodo } from '../../src/domain/periodo.js';

describe('plazos', () => {
  it('distingue días hábiles de fines de semana y feriados', () => {
    expect(esDiaHabil('2026-10-21')).toBe(true);
    expect(esDiaHabil('2026-10-24')).toBe(false);
    expect(esDiaHabil('2026-09-18')).toBe(false);
  });

  it('salta fin de semana y feriados al siguiente día hábil', () => {
    expect(siguienteDiaHabil('2026-09-18')).toBe('2026-09-21');
    expect(siguienteDiaHabil('2026-10-21')).toBe('2026-10-21');
  });

  it.each([
    ['2026-09', '2026-10-20'],
    ['2026-08', '2026-09-21'],
    ['2026-05', '2026-06-22'],
    ['2026-12', '2027-01-20'],
  ])('el F29 de %s vence el %s', (periodo, vence) => {
    expect(vencimientoF29(parsePeriodo(periodo))).toBe(vence);
  });

  it('el plazo de reclamo es de 8 días corridos desde la recepción', () => {
    expect(vencimientoReclamo('2026-10-01 10:22:33')).toBe('2026-10-09');
    expect(vencimientoReclamo('2026-12-28')).toBe('2027-01-05');
  });
});
