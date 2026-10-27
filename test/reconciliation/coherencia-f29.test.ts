import { describe, expect, it } from 'vitest';
import { conciliarPeriodo } from '../../src/reconciliation/conciliar.js';
import { lecturaConfiable, verificarCoherenciaF29 } from '../../src/reconciliation/coherencia-f29.js';
import { CODIGO_F29, VERSION_REGLAS } from '../../src/reconciliation/mapeo-f29.js';
import { reglaF29Incoherente } from '../../src/reconciliation/reglas.js';
import { entrada } from '../helpers/entrada.js';
import { F29_COMPACTO_SINTETICO_CODIGOS } from '../helpers/pdf.js';
import { valores } from '../helpers/fabricas.js';

const v = (codigos: Record<string, number>) => valores(codigos);

describe('verificarCoherenciaF29', () => {
  it('declara los códigos nuevos y la versión de reglas', () => {
    expect(CODIGO_F29.IVA_DETERMINADO).toBe('89');
    expect(CODIGO_F29.TOTAL_DETERMINADO).toBe('547');
    expect(VERSION_REGLAS).toBe('iva-2026.10.6');
  });

  it('un F29 con pago coherente no tiene incoherencias', () => {
    expect(verificarCoherenciaF29(v({ '538': 190_000, '537': 24_000, '89': 166_000, '77': 0, '547': 166_000, '91': 166_000 }))).toEqual([]);
  });

  it('un F29 con remanente coherente (537 > 538) no tiene incoherencias', () => {
    expect(verificarCoherenciaF29(v({ '538': 10_000, '537': 40_000, '77': 30_000, '547': 0, '91': 0 }))).toEqual([]);
  });

  it('una devolución que baja el 77 por debajo de 537 − 538 se acepta', () => {
    expect(verificarCoherenciaF29(v({ '538': 10_000, '537': 40_000, '77': 12_000 }))).toEqual([]);
  });

  it('el 89 ausente vale 0 y se exige 538 − 537 cuando el débito supera al crédito', () => {
    const r = verificarCoherenciaF29(v({ '538': 190_000, '537': 24_000, '91': 166_000 }));
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('89');
    expect(r[0]).toContain('166.000');
  });

  it('el 89 distinto de max(538 − 537, 0) es incoherente, también cuando 537 ≥ 538', () => {
    expect(verificarCoherenciaF29(v({ '538': 190_000, '537': 24_000, '89': 100_000 }))).toHaveLength(1);
    const r = verificarCoherenciaF29(v({ '538': 10_000, '537': 40_000, '89': 5_000 }));
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('89');
  });

  it('un 77 mayor que el crédito sobrante es incoherente', () => {
    const r = verificarCoherenciaF29(v({ '538': 10_000, '537': 40_000, '77': 31_000 }));
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('77');
  });

  it('un 77 con débito mayor o igual al crédito es incoherente', () => {
    expect(verificarCoherenciaF29(v({ '538': 40_000, '537': 40_000, '89': 0, '77': 1 }))).toHaveLength(1);
    expect(verificarCoherenciaF29(v({ '538': 50_000, '537': 40_000, '89': 10_000, '77': 5 }))).toHaveLength(1);
  });

  it('un 91 mayor que el 547 se detecta', () => {
    const r = verificarCoherenciaF29(v({ '538': 190_000, '537': 24_000, '89': 166_000, '547': 100_000, '91': 120_000 }));
    expect(r.some((t) => t.includes('91') && t.includes('547'))).toBe(true);
  });

  it.each(['755', '779'])('un IVA postergado (%s) que cubre el IVA determinado deja el 89 en 0 y es coherente', (codigo) => {
    const postergado = { '538': 500_000, '537': 200_000, '89': 0 };
    expect(verificarCoherenciaF29(v({ ...postergado, [codigo]: 300_000 }))).toEqual([]);
    // Sin el código de postergación, el mismo F29 no cuadra.
    expect(verificarCoherenciaF29(v(postergado)).some((t) => t.includes('89'))).toBe(true);
  });

  it('una postergación parcial reduce el IVA determinado; sumadas, 755 y 779 también', () => {
    const base = { '538': 500_000, '537': 200_000 };
    expect(verificarCoherenciaF29(v({ ...base, '755': 100_000, '89': 200_000 }))).toEqual([]);
    expect(verificarCoherenciaF29(v({ ...base, '755': 100_000, '779': 200_000, '89': 0 }))).toEqual([]);
    expect(verificarCoherenciaF29(v({ ...base, '755': 100_000, '89': 300_000 })).some((t) => t.includes('89'))).toBe(true);
    // El 779 también se acepta con el 89 sin rebajar (solo baja el pago).
    expect(verificarCoherenciaF29(v({ ...base, '779': 100_000, '89': 300_000 }))).toEqual([]);
    // Una postergación mayor que el IVA no deja el 89 bajo 0.
    expect(verificarCoherenciaF29(v({ ...base, '755': 900_000, '89': 0 }))).toEqual([]);
  });

  it('un 91 menor que el 547 solo es válido si hay 779 positivo', () => {
    const base = { '538': 190_000, '537': 24_000, '89': 166_000, '547': 166_000, '91': 150_000 };
    expect(verificarCoherenciaF29(v(base))).toHaveLength(1);
    expect(verificarCoherenciaF29(v({ ...base, '779': 16_000 }))).toEqual([]);
    expect(verificarCoherenciaF29(v({ ...base, '779': 0 }))).toHaveLength(1);
  });

  it('sin 91 o sin 547 no compara el pago', () => {
    expect(verificarCoherenciaF29(v({ '538': 190_000, '537': 24_000, '89': 166_000, '91': 1 }))).toEqual([]);
    expect(verificarCoherenciaF29(v({ '538': 190_000, '537': 24_000, '89': 166_000, '547': 1 }))).toEqual([]);
  });

  it('no aplica si el F29 no se leyó o no hay 538/537 legibles', () => {
    expect(verificarCoherenciaF29(null)).toEqual([]);
    expect(verificarCoherenciaF29(v({}))).toEqual([]);
    // 538 ausente con 502 sin nota de crédito que lo cubra: montoF29 da null (lectura fallida), no es incoherencia.
    expect(verificarCoherenciaF29(v({ '502': 100_000, '537': 24_000, '89': 5 }))).toEqual([]);
    expect(verificarCoherenciaF29(v({ '538': 100_000, '520': 24_000, '511': 1, '89': 5 }))).toEqual([]);
  });

  it('no usa las composiciones de totales: 538 ausente y anulado vale 0', () => {
    expect(verificarCoherenciaF29(v({ '537': 40_000, '77': 40_000 }))).toEqual([]);
  });

  it('F29_COMPACTO_SINTETICO_CODIGOS es coherente y el autocontrol sí aplica (trae 538 y 537)', () => {
    expect(F29_COMPACTO_SINTETICO_CODIGOS['538']).toBe(300_000);
    expect(F29_COMPACTO_SINTETICO_CODIGOS['537']).toBe(550_000);
    expect(verificarCoherenciaF29(valores({ ...F29_COMPACTO_SINTETICO_CODIGOS }))).toEqual([]);
    expect(lecturaConfiable(valores({ ...F29_COMPACTO_SINTETICO_CODIGOS }))).toBe(true);
  });
});

describe('lecturaConfiable', () => {
  it('es confiable solo si está leída, el autocontrol aplica y no tiene incoherencias', () => {
    expect(lecturaConfiable(v({ '538': 190_000, '537': 24_000, '89': 166_000 }))).toBe(true);
    // 538 y 537 ausentes sin líneas que los compongan valen 0: el autocontrol aplica y cuadra.
    expect(lecturaConfiable(v({ '151': 13_750, '547': 13_750, '91': 13_750 }))).toBe(true);
  });

  it('no es confiable si no cuadra', () => {
    expect(lecturaConfiable(v({ '538': 190_000, '537': 24_000, '89': 5_000 }))).toBe(false);
  });

  it('no es confiable si el autocontrol no aplica: sin leer, o 538/537 sin dato', () => {
    expect(lecturaConfiable(null)).toBe(false);
    expect(lecturaConfiable(v({}))).toBe(false);
    expect(lecturaConfiable(v({ '502': 100_000, '537': 24_000, '89': 76_000 }))).toBe(false);
    expect(lecturaConfiable(v({ '538': 100_000, '520': 24_000, '511': 1, '89': 76_000 }))).toBe(false);
  });
});

describe('F29-01', () => {
  const incoherente = { '538': 190_000, '537': 24_000, '504': 5_000, '77': 0, '89': 100_000, '91': 100_000 };

  it('el hallazgo es una advertencia de hecho con la evidencia del folio', () => {
    const [h, ...resto] = reglaF29Incoherente(entrada({ valores: valores(incoherente) }));
    expect(resto).toEqual([]);
    expect(h).toMatchObject({ regla: 'F29-01', severidad: 'advertencia', naturaleza: 'HECHO', titulo: 'El F29 leído no cuadra', montos: null, evidencia: ['F29:555001'] });
    expect(h!.detalle).toContain('89');
  });

  it('no hay hallazgo si es coherente o no aplica', () => {
    expect(reglaF29Incoherente(entrada())).toEqual([]);
    expect(reglaF29Incoherente(entrada({ valores: null }))).toEqual([]);
  });

  it('conciliarPeriodo lo incluye y entrada() base sigue sin hallazgos', () => {
    expect(conciliarPeriodo(entrada()).hallazgos).toEqual([]);
    const r = conciliarPeriodo(entrada({ valores: valores(incoherente) }));
    expect(r.hallazgos.map((h) => h.regla)).toEqual(['F29-01']);
    expect(r.versionReglas).toBe('iva-2026.10.6');
  });
});
