import { describe, expect, it } from 'vitest';
import type { ResultadoRelectura } from '../../src/app/releer-f29.js';
import { textoHallazgos, textoPlazos, textoReleerF29, textoRenta, textoResumenRenta, textoSync } from '../../src/interfaces/formato.js';

describe('formato', () => {
  it('muestra la relectura del F29 folio por folio', () => {
    const folio = (periodo: string, folio: number, resultado: ResultadoRelectura, codigosCambiados: string[] = [], mensaje: string | null = null) => ({
      periodo,
      folio,
      resultado,
      codigosCambiados,
      mensaje,
    });
    expect(
      textoReleerF29({
        rut: '22222222-2',
        versionLector: 'f29-v9',
        folios: [
          folio('2026-07', 1, 'sin_cambios'),
          folio('2026-08', 2, 'actualizado', ['547', '91']),
          folio('2026-08', 3, 'actualizado', ['89'], 'La lectura no cuadra (x).'),
          folio('2026-09', 4, 'ilegible', [], 'No se pudo leer el PDF.'),
          folio('2026-09', 5, 'incoherente_conservado', [], 'La lectura del folio 5 no cuadra; se conserva la lectura guardada.'),
          folio('2026-10', 6, 'sin_declaracion'),
        ],
      }),
    ).toBe(
      [
        'Relectura del F29 de 22222222-2 con el lector f29-v9 (sin ir al SII):',
        '2026-07 folio 1: sin cambios',
        '2026-08 folio 2: actualizado (códigos 547, 91)',
        '2026-08 folio 3: actualizado (códigos 89) — La lectura no cuadra (x).',
        '2026-09 folio 4: ilegible — No se pudo leer el PDF.',
        '2026-09 folio 5: se conserva la lectura guardada — La lectura del folio 5 no cuadra; se conserva la lectura guardada.',
        '2026-10 folio 6: sin declaración guardada, no se escribió',
      ].join('\n'),
    );
    expect(textoReleerF29({ rut: '22222222-2', versionLector: 'f29-v9', folios: [] })).toBe(
      'Relectura del F29 de 22222222-2: no hay PDF del F29 guardados en el rango; sincroniza el F29 para traerlos.',
    );
  });

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

describe('formato: renta F22', () => {
  it('resume la sincronización año por año, con errores y la detención', () => {
    expect(
      textoRenta({
        rut: '22222222-2',
        anios: [
          { anioTributario: 2024, declaraciones: 0, folioVigente: null, detalle: 'sin_vigente', errores: [] },
          { anioTributario: 2025, declaraciones: 1, folioVigente: 7, detalle: 'sin_leer', errores: [{ superficie: 'f22.folio', codigo: 'PORTAL_CAMBIO', mensaje: 'x' }] },
          { anioTributario: 2026, declaraciones: 2, folioVigente: 123_456_789, detalle: 'leido', errores: [] },
          { anioTributario: 2023, declaraciones: null, folioVigente: null, detalle: 'sin_leer', errores: [{ superficie: 'f22', codigo: 'RESPUESTA_VACIA', mensaje: 'x' }] },
        ],
        abortado: { superficie: 'sesion', codigo: 'SESION_REQUERIDA', mensaje: 'Inicia sesión.' },
      }),
    ).toBe(
      [
        'Renta (F22) 22222222-2:',
        'AT2024: sin declaraciones',
        'AT2025: 1 declaración · folio vigente 7 · detalle sin leer · errores: f22.folio PORTAL_CAMBIO',
        'AT2026: 2 declaraciones · folio vigente 123456789 · detalle leído',
        'AT2023: declaraciones sin leer · errores: f22 RESPUESTA_VACIA',
        'Sincronización detenida: [SESION_REQUERIDA] Inicia sesión.',
      ].join('\n'),
    );
  });

  it('muestra lo guardado de cada año con conclusión, códigos clave, observaciones y eventos', () => {
    const anio = {
      anioTributario: 2026,
      folio: 123_456_789,
      vigente: true,
      declaraciones: 2,
      codigoConclusion: '07',
      conclusion: 'Conclusión ficticia',
      fechaIngreso: '2026-04-15',
      tipoImpugnado: null,
      impuestoPagado: 1_234_567,
      montoGiro: 0,
      remanenteSolicitado: 0,
      remanenteDevuelto: 0,
      fechaVencimiento: '2026-04-30',
      codigos: 3,
      codigosClave: [
        { codigo: '305', valor: -250_000, glosa: 'Resultado ficticio' },
        { codigo: '90', valor: null, glosa: 'Saldo ficticio' },
      ],
      observaciones: [{ codigo: 'A01', descripcion: 'Observación ficticia' }],
      eventos: [{ orden: 1, codigoEvento: 'E01', nombre: 'Declaración recibida', fecha: '2026-04-15', tipo: 'INFO', codigoCarta: null }],
      obtenidoEn: '2026-10-21T15:00:00.000Z',
    };
    const sinVigente = { ...anio, anioTributario: 2025, folio: null, vigente: null, declaraciones: 1, conclusion: null, codigoConclusion: null, codigos: 0, codigosClave: [], observaciones: [], eventos: [] };

    expect(textoResumenRenta({ rut: '22222222-2', anios: [anio, sinVigente] })).toBe(
      [
        'Renta (F22) 22222222-2 — 2 años tributarios guardados',
        'AT2026 · folio 123456789 (vigente) de 2 declaraciones · ingreso 2026-04-15 · Conclusión ficticia',
        '  Impuesto pagado $1.234.567 · giro $0 · remanente solicitado $0 · devuelto $0',
        '  305 Resultado ficticio: -$250.000',
        '  90 Saldo ficticio: sin dato',
        '  Observación A01: Observación ficticia',
        '  Evento 2026-04-15: Declaración recibida',
        '  3 códigos guardados (todos en f22_valor)',
        'AT2025 · sin folio vigente (1 declaración)',
      ].join('\n'),
    );
    expect(textoResumenRenta({ rut: '22222222-2', anios: [] })).toMatch(/No hay renta \(F22\) guardada de 22222222-2/);
  });
});
