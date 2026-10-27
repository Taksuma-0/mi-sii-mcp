import { describe, expect, it } from 'vitest';
import { f22Vigente, parseAnioTributario, periodoRenta, rangoAnios } from '../../src/domain/renta.js';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { declaracionF22 } from '../helpers/fabricas.js';

/** Código del ErrorImpuestocl que lanza la función, o una descripción si no lanza así. */
function codigoDe(fn: () => unknown): string {
  try {
    fn();
    return 'sin error';
  } catch (e) {
    return e instanceof ErrorImpuestocl ? e.codigo : `otro error: ${String(e)}`;
  }
}

describe('parseAnioTributario', () => {
  it('lee el año tributario AAAA, con espacios', () => {
    expect(parseAnioTributario('2026')).toBe(2026);
    expect(parseAnioTributario(' 2025 ')).toBe(2025);
  });

  it('rechaza lo que no es un año AAAA con PERIODO_INVALIDO', () => {
    for (const v of ['', '26', '2026-04', 'AT2026', '1999', '2101', 'abcd']) {
      expect(codigoDe(() => parseAnioTributario(v)), v).toBe('PERIODO_INVALIDO');
    }
  });
});

describe('rangoAnios', () => {
  it('entrega los años del rango, ambos incluidos', () => {
    expect(rangoAnios(2023, 2026)).toEqual([2023, 2024, 2025, 2026]);
    expect(rangoAnios(2026, 2026)).toEqual([2026]);
  });

  it('rechaza un inicio posterior al fin y más de 10 años', () => {
    expect(codigoDe(() => rangoAnios(2026, 2025))).toBe('PERIODO_INVALIDO');
    expect(rangoAnios(2017, 2026)).toHaveLength(10);
    expect(codigoDe(() => rangoAnios(2016, 2026))).toBe('PERIODO_INVALIDO');
  });
});

describe('periodoRenta', () => {
  it('es AT<AAAA>: no calza con los meses AAAA-MM', () => {
    expect(periodoRenta(2026)).toBe('AT2026');
  });
});

describe('f22Vigente', () => {
  it('elige la marcada vigente', () => {
    const vigente = declaracionF22({ folio: 200, vigente: true, fechaIngreso: '2026-04-10' });
    expect(f22Vigente([declaracionF22({ folio: 300, vigente: false, fechaIngreso: '2026-04-20' }), vigente])).toBe(vigente);
  });

  it('sin marca, la de ingreso más reciente y luego el folio más alto; nunca una marcada no vigente', () => {
    const a = declaracionF22({ folio: 100, vigente: null, fechaIngreso: '2026-04-10' });
    const b = declaracionF22({ folio: 90, vigente: null, fechaIngreso: '2026-04-20' });
    const c = declaracionF22({ folio: 95, vigente: null, fechaIngreso: '2026-04-20' });
    expect(f22Vigente([a, b, c])).toBe(c);
    expect(f22Vigente([declaracionF22({ vigente: false })])).toBeNull();
    expect(f22Vigente([])).toBeNull();
  });
});
