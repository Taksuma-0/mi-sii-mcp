import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { conciliarPeriodo } from '../../src/reconciliation/conciliar.js';
import type { EntradaConciliacion } from '../../src/reconciliation/reglas.js';

interface CasoGolden {
  readonly nombre: string;
  readonly entrada: Omit<EntradaConciliacion, 'periodo'> & { readonly periodo: string };
  readonly esperado: readonly { regla: string; severidad: string; diferencia: number | null }[];
}

const DIR = join(import.meta.dirname, '..', 'golden');
const casos = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as CasoGolden);

describe('casos golden de conciliación', () => {
  it('existen casos golden', () => {
    expect(casos.length).toBeGreaterThanOrEqual(3);
  });

  it.each(casos.map((c) => [c.nombre, c] as const))('%s', (_nombre, caso) => {
    const r = conciliarPeriodo({ ...caso.entrada, periodo: parsePeriodo(caso.entrada.periodo) });
    expect(r.hallazgos.map((h) => ({ regla: h.regla, severidad: h.severidad, diferencia: h.montos?.diferencia ?? null }))).toEqual(caso.esperado);
  });
});
