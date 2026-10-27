import { describe, expect, it } from 'vitest';
import { textoHallazgos, textoPlazos, textoSync } from '../../src/interfaces/formato.js';

describe('formato', () => {
  it('muestra hallazgos con severidad legible', () => {
    expect(textoHallazgos([])).toBe('Sin hallazgos.');
    const texto = textoHallazgos([
      { regla: 'IVA-01', severidad: 'critico', naturaleza: 'DERIVADO', rut: '22222222-2', periodo: '2026-09', titulo: 'Débito distinto', detalle: 'detalle', montos: null, evidencia: [] },
    ]);
    expect(texto).toBe('[CRÍTICO] IVA-01 2026-09 — Débito distinto\n    detalle');
  });

  it('muestra plazos vencidos y por vencer', () => {
    expect(
      textoPlazos([
        { rut: '22222222-2', tipo: 'F29', vence: '2026-10-20', diasRestantes: -1, descripcion: 'F29 vencido', referencia: '2026-09' },
        { rut: '22222222-2', tipo: 'RECLAMO_FACTURA', vence: '2026-10-27', diasRestantes: 6, descripcion: 'Reclamar', referencia: null },
      ]),
    ).toBe('2026-10-20 (vencido hace 1 día(s)) — F29 vencido\n2026-10-27 (en 6 día(s)) — Reclamar');
  });

  it('resume una sincronización con errores y aborto', () => {
    const texto = textoSync({
      rut: '22222222-2',
      superficies: ['rcv', 'f29'],
      periodos: [{ periodo: '2026-09', errores: [{ superficie: 'f29.valores', codigo: 'PORTAL_CAMBIO', mensaje: 'x' }], avisos: [], documentos: 4, f29Folio: 555_001 }],
      abortado: { superficie: 'sesion', codigo: 'SESION_REQUERIDA', mensaje: 'Sin sesión.' },
    });
    expect(texto).toContain('2026-09: 4 documentos RCV · F29 folio 555001 · errores: f29.valores PORTAL_CAMBIO');
    expect(texto).toContain('Sincronización detenida: [SESION_REQUERIDA] Sin sesión.');
  });

  it('una sincronización cancelada dice que se conservan los meses traídos', () => {
    const texto = textoSync({
      rut: '22222222-2',
      superficies: ['rcv', 'f29'],
      periodos: [{ periodo: '2026-09', errores: [], avisos: [], documentos: 4, f29Folio: 555_001 }],
      abortado: { superficie: 'cancelacion', codigo: 'CANCELADO', mensaje: 'Sincronización cancelada; se conservan los meses ya traídos.' },
    });
    expect(texto).toBe('Sincronización 22222222-2\n2026-09: 4 documentos RCV · F29 folio 555001\nSincronización cancelada; se conservan los meses ya traídos.');
  });

  describe('solo las superficies pedidas', () => {
    const periodo = { periodo: '2026-09', errores: [], avisos: [], documentos: 4, f29Folio: 555_001 };

    it('con solo f29 no habla de documentos RCV', () => {
      const texto = textoSync({ rut: '22222222-2', superficies: ['f29'], periodos: [periodo], abortado: null });
      expect(texto).toBe('Sincronización 22222222-2\n2026-09: F29 folio 555001');
      expect(texto).not.toContain('documentos RCV');
    });

    it('con solo f29 y sin folio dice que no hay folio informado', () => {
      const texto = textoSync({ rut: '22222222-2', superficies: ['f29'], periodos: [{ ...periodo, f29Folio: null }], abortado: null });
      expect(texto).toBe('Sincronización 22222222-2\n2026-09: F29 sin folio informado');
    });

    it('con solo rcv no habla del F29', () => {
      const texto = textoSync({ rut: '22222222-2', superficies: ['rcv'], periodos: [{ ...periodo, f29Folio: null }], abortado: null });
      expect(texto).toBe('Sincronización 22222222-2\n2026-09: 4 documentos RCV');
      expect(texto).not.toContain('F29');
    });

    it('con solo rcv conserva los errores y avisos del mes', () => {
      const texto = textoSync({
        rut: '22222222-2',
        superficies: ['rcv'],
        periodos: [{ ...periodo, errores: [{ superficie: 'rcv.COMPRA', codigo: 'DATOS_INCOMPLETOS', mensaje: 'x' }], avisos: ['a'] }],
        abortado: null,
      });
      expect(texto).toBe('Sincronización 22222222-2\n2026-09: 4 documentos RCV · errores: rcv.COMPRA DATOS_INCOMPLETOS\n    avisos: a');
    });

    it('con ambas superficies la línea es la de siempre', () => {
      const texto = textoSync({ rut: '22222222-2', superficies: ['rcv', 'f29'], periodos: [periodo], abortado: null });
      expect(texto).toBe('Sincronización 22222222-2\n2026-09: 4 documentos RCV · F29 folio 555001');
    });
  });
});
