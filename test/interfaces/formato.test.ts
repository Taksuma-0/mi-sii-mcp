import { describe, expect, it } from 'vitest';
import type { ResultadoRelectura } from '../../src/app/releer-f29.js';
import { textoHallazgos, textoPerfiles, textoPlazos, textoReleerF29, textoRenta, textoResumenRenta, textoSync } from '../../src/interfaces/formato.js';

describe('formato', () => {
  it('textoPerfiles dice si la sesión se renueva sola o habrá que conectar de nuevo en la página', () => {
    const sesion = { tieneSesion: true, guardadaEn: '2026-10-27T10:00:00.000Z', bloqueado: false };
    const texto = textoPerfiles([
      { rut: '11111111-1', alias: 'Yo', tipo: 'persona', representa: [], razonSocial: null, sesion: { ...sesion, renuevaSola: true } },
      { rut: '22222222-2', alias: 'Pyme', tipo: 'empresa', representa: [], razonSocial: null, sesion: { ...sesion, renuevaSola: false } },
    ]).split('\n');
    expect(texto[0]).toContain('(se renueva sola)');
    expect(texto[1]).toContain('sin clave guardada: cuando venza, hay que conectar de nuevo en «Abrir impuestocl.cmd»');
  });

  it('textoPerfiles dice con qué sesión se entra y si la sesión es del navegador', () => {
    const sesion = { tieneSesion: true, guardadaEn: '2026-10-27T10:00:00.000Z', bloqueado: false };
    const texto = textoPerfiles([
      { rut: '22222222-2', alias: 'Pyme', tipo: 'empresa', representa: [], razonSocial: null, accedeCon: '33333333-3', sesion: { tieneSesion: false, guardadaEn: null, bloqueado: false } },
      { rut: '33333333-3', alias: 'Juana', tipo: 'persona', representa: [], razonSocial: null, sesion: { ...sesion, origen: 'navegador' } },
    ]);
    expect(texto).toContain('22222222-2  Pyme (empresa) · sesión: sin sesión · accede con 33333333-3');
    expect(texto).toContain('33333333-3  Juana (persona) · sesión: guardada 2026-10-27T10:00:00.000Z (navegador, sin renovación automática)');
  });

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
          { anioTributario: 2024, declaraciones: 0, folioVigente: null, detalle: 'sin_vigente', boletasEmitidas: null, errores: [] },
          { anioTributario: 2025, declaraciones: 1, folioVigente: 7, detalle: 'sin_leer', boletasEmitidas: null, errores: [{ superficie: 'f22.folio', codigo: 'PORTAL_CAMBIO', mensaje: 'x' }] },
          { anioTributario: 2026, declaraciones: 2, folioVigente: 123_456_789, detalle: 'leido', boletasEmitidas: null, errores: [] },
          { anioTributario: 2023, declaraciones: null, folioVigente: null, detalle: 'sin_leer', boletasEmitidas: null, errores: [{ superficie: 'f22', codigo: 'RESPUESTA_VACIA', mensaje: 'x' }] },
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
      honorariosEmitidos: null,
      obtenidoEn: '2026-10-21T15:00:00.000Z',
    };
    const sinVigente = { ...anio, anioTributario: 2025, folio: null, vigente: null, declaraciones: 1, conclusion: null, codigoConclusion: null, codigos: 0, codigosClave: [], observaciones: [], eventos: [] };

    expect(textoResumenRenta({ rut: '22222222-2', anios: [anio, sinVigente] })).toBe(
      [
        'Renta (F22) 22222222-2 — 2 años tributarios guardados',
        'AT2026 · folio 123456789 (vigente) de 2 declaraciones · ingreso 2026-04-15 · Conclusión ficticia',
        '  Impuesto pagado $1.234.567 · giro $0 · remanente solicitado $0 · devuelto $0',
        '  305 Resultado ficticio: -$250.000',
        '  Sin monto en el folio: 90',
        '  Observación A01: Observación ficticia',
        '  Evento 2026-04-15: Declaración recibida',
        '  3 códigos guardados (todos en f22_valor)',
        'AT2025 · sin folio vigente (1 declaración)',
      ].join('\n'),
    );
    expect(textoResumenRenta({ rut: '22222222-2', anios: [] })).toMatch(/No hay renta \(F22\) guardada de 22222222-2/);
  });

  it('textoResumenRenta omite los montos que el SII no informó y el tipo impugnado 0', () => {
    const anio = {
      anioTributario: 2026, folio: 1, vigente: true, declaraciones: 1, codigoConclusion: null, conclusion: 'Devolución ficticia', fechaIngreso: null, tipoImpugnado: '0',
      impuestoPagado: null, montoGiro: null, remanenteSolicitado: 100_000, remanenteDevuelto: 100_000, fechaVencimiento: null, codigos: 2,
      codigosClave: [{ codigo: '87', valor: 100_000, glosa: 'Devolución ficticia' }, { codigo: '91', valor: null, glosa: 'Total ficticio' }],
      observaciones: [], eventos: [], honorariosEmitidos: null, obtenidoEn: '2026-10-21T15:00:00.000Z',
    };
    const texto = textoResumenRenta({ rut: '11111111-1', anios: [anio] });
    expect(texto).toContain('  remanente solicitado $100.000 · devuelto $100.000\n');
    expect(texto).not.toMatch(/Impuesto pagado|giro|tipo impugnado|sin dato/);
    expect(texto).toContain('  Sin monto en el folio: 91');
  });

  it('textoRenta dice cuántas boletas de honorarios emitidas trajo del año comercial', () => {
    const texto = textoRenta({
      rut: '11111111-1',
      anios: [
        { anioTributario: 2026, declaraciones: 1, folioVigente: 9, detalle: 'leido', boletasEmitidas: 11, errores: [] },
        { anioTributario: 2027, declaraciones: 0, folioVigente: null, detalle: 'sin_vigente', boletasEmitidas: 1, errores: [] },
        { anioTributario: 2025, declaraciones: 0, folioVigente: null, detalle: 'sin_vigente', boletasEmitidas: 0, errores: [] },
      ],
      abortado: null,
    });
    expect(texto).toBe(
      [
        'Renta (F22) 11111111-1:',
        'AT2026: 1 declaración · folio vigente 9 · detalle leído · 11 boletas emitidas en 2025',
        'AT2027: sin declaraciones · 1 boleta emitida en 2026',
        'AT2025: sin declaraciones · 0 boletas emitidas en 2024',
      ].join('\n'),
    );
  });

  describe('textoResumenRenta: boletas de honorarios emitidas', () => {
    const base = {
      anioTributario: 2026, folio: 9, vigente: true, declaraciones: 1, codigoConclusion: null, conclusion: null, fechaIngreso: null, tipoImpugnado: null,
      impuestoPagado: null, montoGiro: null, remanenteSolicitado: null, remanenteDevuelto: null, fechaVencimiento: null, codigos: 40,
      codigosClave: [], observaciones: [], eventos: [], obtenidoEn: '2026-10-21T15:00:00.000Z',
    };
    const honorarios = {
      anioComercial: 2025, vigentes: 3, anuladas: 1, bruto: 2_000_000, retencionTerceros: 290_000, retencionPropia: 0, obtenidoEn: '2026-10-21T15:00:00.000Z',
      cruceF22: {
        bruto: { codigo: '547', boletas: 2_000_000, f22: 2_012_600, estado: 'cuadra' as const, reajustePct: 0.63 },
        retencion: { codigo: '492', boletas: 290_000, f22: 291_827, estado: 'cuadra' as const, reajustePct: 0.63 },
      },
    };

    it('muestra el año comercial, vigentes, anuladas, bruto y retención, y el cruce que cuadra con el reajuste por IPC', () => {
      const texto = textoResumenRenta({ rut: '11111111-1', anios: [{ ...base, honorariosEmitidos: honorarios }] });
      expect(texto.split('\n').slice(-2)).toEqual([
        '  Boletas de honorarios emitidas en 2025: 3 vigentes (1 anulada) · bruto $2.000.000 · retención $290.000',
        '  Cruce con el F22: bruto vs 547 cuadra (el F22 reajusta por IPC: +0,6 %) · retención vs 492 cuadra (+0,6 %)',
      ]);
    });

    it('un año solo con boletas: sin F22 guardado, la retención propia si la hay y sin cruce', () => {
      const soloBoletas = { ...base, anioTributario: 2027, folio: null, vigente: null, declaraciones: 0, codigos: 0 };
      const texto = textoResumenRenta({
        rut: '11111111-1',
        anios: [{ ...soloBoletas, honorariosEmitidos: { ...honorarios, anioComercial: 2026, vigentes: 1, anuladas: 0, bruto: 100_000, retencionTerceros: 0, retencionPropia: 14_500, cruceF22: null } }],
      });
      expect(texto).toBe(
        [
          'Renta (F22) 11111111-1 — 1 año tributario guardado',
          'AT2027 · sin F22 guardado',
          '  Boletas de honorarios emitidas en 2026: 1 vigente · bruto $100.000 · retención $0 · retención propia $14.500',
        ].join('\n'),
      );
    });

    it('sin boletas dice ninguna y no cruza; un cruce que no cuadra muestra ambos montos', () => {
      const ninguna = { ...honorarios, vigentes: 0, anuladas: 0, bruto: 0, retencionTerceros: 0, cruceF22: { bruto: { ...honorarios.cruceF22.bruto, boletas: 0, f22: null, estado: 'sin_datos' as const, reajustePct: null }, retencion: { ...honorarios.cruceF22.retencion, boletas: 0, f22: null, estado: 'sin_datos' as const, reajustePct: null } } };
      expect(textoResumenRenta({ rut: '11111111-1', anios: [{ ...base, honorariosEmitidos: ninguna }] }).split('\n').at(-1)).toBe('  Boletas de honorarios emitidas en 2025: ninguna');

      const distinto = {
        ...honorarios,
        cruceF22: {
          bruto: { ...honorarios.cruceF22.bruto, f22: 2_500_000, estado: 'difiere' as const, reajustePct: 25 },
          retencion: { ...honorarios.cruceF22.retencion, f22: null, estado: 'sin_declarar' as const, reajustePct: null },
        },
      };
      expect(textoResumenRenta({ rut: '11111111-1', anios: [{ ...base, honorariosEmitidos: distinto }] }).split('\n').at(-1)).toBe(
        '  Cruce con el F22: bruto vs 547 difiere (boletas $2.000.000, F22 $2.500.000) · retención vs 492: el F22 no la declara (boletas $290.000)',
      );
    });
  });
});
