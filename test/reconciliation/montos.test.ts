import { describe, expect, it } from 'vitest';
import { creditoDocumentosF29, creditoRcv, debitoF29, debitoRcv } from '../../src/reconciliation/mapeo-f29.js';
import { reglaCredito, reglaDebito, reglaRemanente } from '../../src/reconciliation/reglas.js';
import { entrada } from '../helpers/entrada.js';
import { fila, resumen, valores } from '../helpers/fabricas.js';

describe('mapeo RCV ↔ F29', () => {
  it('las notas de crédito restan del débito', () => {
    expect(debitoRcv([resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000), fila(61, 100_000, 19_000)] })])).toBe(171_000);
  });

  it('el crédito solo considera compras registradas, no pendientes', () => {
    expect(creditoRcv([resumen({ lado: 'COMPRA', filas: [fila(33, 100_000, 19_000)] }), resumen({ lado: 'COMPRA', estado: 'PENDIENTE', filas: [fila(33, 50_000, 9_500)] })])).toBe(19_000);
  });

  it('el crédito del F29 comparable es 537 menos el remanente 504', () => {
    expect(creditoDocumentosF29(valores({ '537': 24_000, '504': 5_000 }))).toBe(19_000);
    expect(creditoDocumentosF29(valores({ '537': 24_000 }))).toBe(24_000);
    expect(creditoDocumentosF29(valores({ '504': 5_000 }))).toBeNull();
    expect(debitoF29(valores({ '538': 190_000 }))).toBe(190_000);
    expect(debitoF29(null)).toBeNull();
  });
});

describe('IVA-01 débito', () => {
  it('un mes cuadrado no produce hallazgos', () => {
    expect(reglaDebito(entrada())).toEqual([]);
  });

  it('una diferencia es crítica y trae los montos', () => {
    const [h] = reglaDebito(entrada({ valores: valores({ '538': 200_000, '537': 24_000, '504': 5_000 }) }));
    expect(h).toMatchObject({ regla: 'IVA-01', severidad: 'critico', naturaleza: 'DERIVADO', periodo: '2026-09', montos: { esperado: 190_000, declarado: 200_000, diferencia: -10_000 } });
    expect(h!.detalle).toContain('$190.000');
    expect(h!.evidencia).toEqual(['F29:555001', 'RCV:VENTA:2026-09']);
  });

  it('respeta la tolerancia', () => {
    expect(reglaDebito(entrada({ toleranciaPesos: 10_000, valores: valores({ '538': 200_000 }) }))).toEqual([]);
  });

  it('sin F29 no compara (eso lo reporta IVA-04)', () => {
    expect(reglaDebito(entrada({ valores: null }))).toEqual([]);
  });

  it('si el F29 no trae el 538 avisa que no se pudo leer', () => {
    expect(reglaDebito(entrada({ valores: valores({ '91': 1 }) }))[0]).toMatchObject({ regla: 'IVA-01', severidad: 'advertencia', naturaleza: 'HECHO' });
  });
});

describe('IVA-02 crédito e IVA-03 remanente', () => {
  it('detecta crédito declarado distinto del RCV', () => {
    expect(reglaCredito(entrada({ valores: valores({ '538': 190_000, '537': 30_000, '504': 5_000 }) }))[0]?.montos).toEqual({ esperado: 19_000, declarado: 25_000, diferencia: -6_000 });
  });

  it('detecta un remanente que no calza con el mes anterior', () => {
    const [h] = reglaRemanente(entrada({ valoresAnterior: valores({ '77': 7_000 }, { periodo: '2026-08', folio: 554_000 }) }));
    expect(h).toMatchObject({ regla: 'IVA-03', severidad: 'critico', montos: { esperado: 7_000, declarado: 5_000, diferencia: 2_000 } });
    expect(h!.evidencia).toEqual(['F29:554000', 'F29:555001']);
  });

  it('sin F29 del mes anterior no compara el remanente', () => {
    expect(reglaRemanente(entrada({ valoresAnterior: null }))).toEqual([]);
  });
});
