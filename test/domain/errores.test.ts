import { describe, expect, it } from 'vitest';
import { ACCION_POR_DEFECTO, ERRORES_FATALES, ErrorImpuestocl, esErrorImpuestocl, REINTENTO, reintentoDe, type CodigoError } from '../../src/domain/errores.js';

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
    expect([...ERRORES_FATALES].sort()).toEqual(['CLAVE_RECHAZADA', 'RUT_BLOQUEADO_LOCAL', 'SESION_REQUERIDA', 'SII_EN_ESPERA', 'SII_SESIONES_MAXIMAS']);
  });

  it.each<CodigoError>(['SII_SESIONES_MAXIMAS', 'RESPUESTA_VACIA', 'DATOS_INCOMPLETOS', 'LECTURA_INCOHERENTE', 'RESPALDO_FALLIDO'])('%s trae una acción por defecto clara', (codigo) => {
    expect(new ErrorImpuestocl(codigo, 'x').accion.length).toBeGreaterThan(20);
  });

  it('solo las sesiones máximas son fatales entre los códigos nuevos', () => {
    expect(ERRORES_FATALES.has('SII_SESIONES_MAXIMAS')).toBe(true);
    for (const codigo of ['RESPUESTA_VACIA', 'DATOS_INCOMPLETOS', 'LECTURA_INCOHERENTE', 'RESPALDO_FALLIDO'] as const) expect(ERRORES_FATALES.has(codigo)).toBe(false);
  });

  it('esErrorImpuestocl rechaza errores comunes', () => {
    expect(esErrorImpuestocl(new Error('x'))).toBe(false);
  });

  describe('reintento', () => {
    it('REINTENTO cubre exactamente los mismos códigos que ACCION_POR_DEFECTO', () => {
      expect(Object.keys(REINTENTO).sort()).toEqual(Object.keys(ACCION_POR_DEFECTO).sort());
    });

    it.each<[CodigoError, 'inmediato' | 'mas_tarde' | 'no']>([
      ['SII_NO_DISPONIBLE', 'mas_tarde'],
      ['SII_EN_ESPERA', 'mas_tarde'],
      ['SII_SESIONES_MAXIMAS', 'mas_tarde'],
      ['RESPUESTA_VACIA', 'mas_tarde'],
      ['DATOS_INCOMPLETOS', 'mas_tarde'],
      ['SESION_REQUERIDA', 'no'],
      ['CLAVE_RECHAZADA', 'no'],
      ['RUT_BLOQUEADO_LOCAL', 'no'],
      ['CAPTCHA_REQUERIDO', 'no'],
      ['SIN_PERMISO', 'no'],
      ['PORTAL_CAMBIO', 'no'],
      ['LECTURA_INCOHERENTE', 'no'],
      ['RESPALDO_FALLIDO', 'mas_tarde'],
      ['RUT_INVALIDO', 'no'],
      ['PERIODO_INVALIDO', 'no'],
      ['PERFIL_NO_EXISTE', 'no'],
      ['CONSULTA_RECHAZADA', 'no'],
      ['SII_RECHAZO', 'no'],
      ['CONSULTA_INTERRUMPIDA', 'inmediato'],
    ])('%s se reintenta: %s', (codigo, esperado) => {
      expect(reintentoDe(codigo)).toBe(esperado);
    });

    it('CANCELADO se reintenta de inmediato; ERROR_INTERNO y códigos desconocidos no', () => {
      expect(reintentoDe('CANCELADO')).toBe('inmediato');
      expect(reintentoDe('ERROR_INTERNO')).toBe('no');
      expect(reintentoDe('CODIGO_QUE_NO_EXISTE')).toBe('no');
    });

    it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('el nombre heredado "%s" no es un código: no se reintenta', (nombre) => {
      expect(reintentoDe(nombre)).toBe('no');
    });
  });
});
