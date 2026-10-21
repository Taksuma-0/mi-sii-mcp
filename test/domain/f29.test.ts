import { describe, expect, it } from 'vitest';
import { declaracionVigente } from '../../src/domain/f29.js';
import { claveDocumento } from '../../src/domain/tipos.js';
import { declaracion, documento } from '../helpers/fabricas.js';

describe('declaracionVigente', () => {
  it('es null si no hay declaraciones o solo hay guardadas sin folio', () => {
    expect(declaracionVigente([])).toBeNull();
    expect(declaracionVigente([declaracion({ folio: 0, estado: 'Guardada' })])).toBeNull();
  });

  it('prefiere la que el SII marca como vigente aunque sea anterior', () => {
    const original = declaracion({ folio: 111, estado: 'Vigente', fechaPresentacion: '2026-10-10' });
    const otra = declaracion({ folio: 222, estado: 'Anulada', fechaPresentacion: '2026-10-18' });
    expect(declaracionVigente([otra, original])?.folio).toBe(111);
  });

  it('sin etiqueta vigente toma la presentada más reciente (rectificatoria)', () => {
    const a = declaracion({ folio: 111, estado: 'Presentada', fechaPresentacion: '2026-10-10' });
    const b = declaracion({ folio: 222, estado: 'Presentada', fechaPresentacion: '2026-10-18' });
    expect(declaracionVigente([a, b])?.folio).toBe(222);
  });
});

describe('claveDocumento', () => {
  it('combina lado, tipo, contraparte y folio', () => {
    expect(claveDocumento(documento({ folio: 7 }))).toBe('COMPRA:33:33333333-3:7');
  });
});
