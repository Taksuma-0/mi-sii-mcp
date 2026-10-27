import { describe, expect, it } from 'vitest';
import { declaracionVigente, f29Presentada, montosPropuesta } from '../../src/domain/f29.js';
import { claveDocumento } from '../../src/domain/tipos.js';
import { declaracion, documento, propuesta } from '../helpers/fabricas.js';

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

describe('f29Presentada', () => {
  it('no cuenta los estados 10 (guardada) y 70 (rechazada) aunque tengan folio', () => {
    expect(f29Presentada(declaracion({ estadoId: 10, estado: 'Presentada' }))).toBe(false);
    expect(f29Presentada(declaracion({ estadoId: 70, estado: 'Presentada' }))).toBe(false);
    expect(f29Presentada(declaracion({ estadoId: 1 }))).toBe(true);
  });

  it('sin id decide el texto del estado', () => {
    for (const estado of ['Rechazada por pago inconcluso', 'Guardada', 'Anulada', 'ANULADO']) {
      expect(f29Presentada(declaracion({ estadoId: null, estado }))).toBe(false);
    }
    expect(f29Presentada(declaracion({ estadoId: null, estado: 'Vigente' }))).toBe(true);
  });

  it('un estado desconocido cuenta como presentado y el folio 0 nunca', () => {
    expect(f29Presentada(declaracion({ estadoId: 99, estado: 'En revisión' }))).toBe(true);
    expect(f29Presentada(declaracion({ estadoId: 1, folio: 0 }))).toBe(false);
  });
});

describe('declaracionVigente con estados no presentados', () => {
  it('ignora el folio rechazado aunque sea más reciente y diga vigente', () => {
    const ok = declaracion({ folio: 111, estado: 'Presentada', fechaPresentacion: '2026-10-10' });
    const rechazada = declaracion({ folio: 222, estadoId: 70, estado: 'Vigente', fechaPresentacion: '2026-10-18' });
    expect(declaracionVigente([rechazada, ok])?.folio).toBe(111);
    expect(declaracionVigente([rechazada])).toBeNull();
  });
});

describe('claveDocumento', () => {
  it('combina lado, tipo, contraparte y folio', () => {
    expect(claveDocumento(documento({ folio: 7 }))).toBe('COMPRA:33:33333333-3:7');
  });
});

describe('montosPropuesta', () => {
  it('toma crédito del 520, remanente del 504 y retención del 151', () => {
    expect(montosPropuesta(propuesta())).toEqual({ credito: 950_000, origenCredito: '520', remanente: 120_000, retencion: 30_000 });
  });

  it('sin el 520 usa el crédito neto por documentos (511); sin ninguno queda null', () => {
    expect(montosPropuesta(propuesta({ propuestos: { '511': 700 } }))).toMatchObject({ credito: 700, origenCredito: '511' });
    expect(montosPropuesta(propuesta({ propuestos: { '504': 5 } }))).toEqual({ credito: null, origenCredito: null, remanente: 5, retencion: null });
  });

  it('una propuesta sin nada propuesto da todo null', () => {
    expect(montosPropuesta(propuesta({ propuestos: {}, administrativos: {}, sinPropuesta: true }))).toEqual({ credito: null, origenCredito: null, remanente: null, retencion: null });
  });
});
