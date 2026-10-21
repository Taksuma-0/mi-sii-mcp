import { describe, expect, it } from 'vitest';
import { ddmmaaaaAIso, diaSemana, diasEntre, fechaEnSantiago, sumarDias } from '../../src/domain/fechas.js';

describe('fechas', () => {
  it('suma días cruzando meses y años', () => {
    expect(sumarDias('2026-10-01', 8)).toBe('2026-10-09');
    expect(sumarDias('2026-12-28', 5)).toBe('2027-01-02');
  });

  it('cuenta días entre fechas (negativo si ya pasó)', () => {
    expect(diasEntre('2026-10-21', '2026-10-20')).toBe(-1);
    expect(diasEntre('2026-10-21', '2026-10-28')).toBe(7);
  });

  it('calcula el día de la semana (0 = domingo)', () => {
    expect(diaSemana('2026-10-21')).toBe(3);
    expect(diaSemana('2026-09-20')).toBe(0);
  });

  it('obtiene la fecha civil en Santiago', () => {
    expect(fechaEnSantiago(new Date('2026-10-21T02:00:00Z'))).toBe('2026-10-20');
    expect(fechaEnSantiago(new Date('2026-10-21T15:00:00Z'))).toBe('2026-10-21');
  });

  it('convierte DD/MM/AAAA del portal a ISO', () => {
    expect(ddmmaaaaAIso('05/09/2026')).toBe('2026-09-05');
    expect(ddmmaaaaAIso('5/9/2026 10:22:33')).toBe('2026-09-05 10:22:33');
    expect(ddmmaaaaAIso('2026-09-05')).toBe('2026-09-05');
    expect(ddmmaaaaAIso(null)).toBeNull();
    expect(ddmmaaaaAIso('  ')).toBeNull();
  });
});
