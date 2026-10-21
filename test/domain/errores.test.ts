import { describe, expect, it } from 'vitest';
import { ERRORES_FATALES, ErrorImpuestocl, esErrorImpuestocl } from '../../src/domain/errores.js';

describe('ErrorImpuestocl', () => {
  it('trae código, mensaje y acción por defecto', () => {
    const e = new ErrorImpuestocl('SESION_REQUERIDA', 'Sin sesión');
    expect(e).toBeInstanceOf(Error);
    expect(esErrorImpuestocl(e)).toBe(true);
    expect(e.codigo).toBe('SESION_REQUERIDA');
    expect(e.accion).toContain('impuestocl login');
    expect(e.toJSON()).toEqual({ codigo: 'SESION_REQUERIDA', mensaje: 'Sin sesión', accion: e.accion });
  });

  it('permite reemplazar la acción y adjuntar detalle', () => {
    const e = new ErrorImpuestocl('SII_RECHAZO', 'x', { accion: 'otra', detalle: { a: 1 } });
    expect(e.accion).toBe('otra');
    expect(e.detalle).toEqual({ a: 1 });
  });

  it('conserva la causa sin incluirla ni incluir el detalle en JSON', () => {
    const cause = new Error('Fallo original');
    const e = new ErrorImpuestocl('SII_RECHAZO', 'Consulta rechazada', { cause, detalle: { a: 1 } });
    expect(e.cause).toBe(cause);
    expect(e.toJSON()).toEqual({ codigo: 'SII_RECHAZO', mensaje: 'Consulta rechazada', accion: e.accion });
  });

  it('marca como fatales los errores de sesión y la sala de espera', () => {
    expect([...ERRORES_FATALES].sort()).toEqual(['CLAVE_RECHAZADA', 'RUT_BLOQUEADO_LOCAL', 'SESION_REQUERIDA', 'SII_EN_ESPERA']);
  });

  it('esErrorImpuestocl rechaza errores comunes', () => {
    expect(esErrorImpuestocl(new Error('x'))).toBe(false);
  });
});
