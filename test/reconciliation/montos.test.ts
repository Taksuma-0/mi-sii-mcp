import { describe, expect, it } from 'vitest';
import { CODIGOS_F29 } from '../../src/connectors/sii/codigos-f29.js';
import {
  CODIGO_F29,
  CODIGOS_CREDITO_FUERA_RCV,
  CODIGOS_DEBITO_FUERA_RCV,
  creditoDocumentosF29,
  creditoRcv,
  debitoF29,
  debitoRcv,
  LINEAS_DE_TOTALES,
  montoF29,
} from '../../src/reconciliation/mapeo-f29.js';
import { REAJUSTE_UTM_REMANENTE, reglaCredito, reglaDebito, reglaRemanente } from '../../src/reconciliation/reglas.js';
import { entrada } from '../helpers/entrada.js';
import { fila, resumen, valores } from '../helpers/fabricas.js';

describe('mapeo RCV ↔ F29', () => {
  it('todo código que usan las reglas está en el catálogo del lector', () => {
    const usados = [
      ...Object.values(CODIGO_F29),
      ...CODIGOS_DEBITO_FUERA_RCV,
      ...CODIGOS_CREDITO_FUERA_RCV,
      ...Object.entries(LINEAS_DE_TOTALES).flatMap(([total, { suman, restan, informativas }]) => [total, ...suman, ...restan, ...informativas]),
    ];
    expect(usados.filter((codigo) => !CODIGOS_F29.has(codigo))).toEqual([]);
  });

  it('las notas de crédito restan del débito', () => {
    expect(debitoRcv([resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000), fila(61, 100_000, 19_000)] })])).toBe(171_000);
  });

  it('el crédito solo considera compras registradas, no pendientes', () => {
    expect(creditoRcv([resumen({ lado: 'COMPRA', filas: [fila(33, 100_000, 19_000)] }), resumen({ lado: 'COMPRA', estado: 'PENDIENTE', filas: [fila(33, 50_000, 9_500)] })])).toBe(19_000);
  });

  it('el crédito del F29 comparable es 537 menos el remanente 504', () => {
    expect(creditoDocumentosF29(valores({ '537': 24_000, '504': 5_000 }))).toBe(19_000);
    expect(creditoDocumentosF29(valores({ '537': 24_000 }))).toBe(24_000);
    expect(debitoF29(valores({ '538': 190_000 }))).toBe(190_000);
    expect(debitoF29(null)).toBeNull();
  });

  it('en un F29 leído, el PDF compacto omite las líneas en cero: 538, 537, 504 y 77 ausentes valen 0', () => {
    expect(debitoF29(valores({ '537': 24_000 }))).toBe(0);
    expect(creditoDocumentosF29(valores({ '538': 190_000 }))).toBe(0);
    expect(montoF29(valores({ '538': 190_000 }), '77')).toBe(0);
    expect(montoF29(valores({ '538': 190_000 }), '504')).toBe(0);
  });

  it('falta el 538 con el 502 presente y sin notas de crédito emitidas: el PDF se leyó mal, el débito queda sin dato', () => {
    expect(montoF29(valores({ '502': 190_000, '537': 19_000 }), '538')).toBeNull();
    expect(debitoF29(valores({ '502': 190_000, '537': 19_000 }))).toBeNull();
    expect(reglaDebito(entrada({ valores: valores({ '502': 190_000, '537': 19_000 }) }))[0]).toMatchObject({ regla: 'IVA-01', severidad: 'advertencia', naturaleza: 'HECHO' });
  });

  it.each(['511', '520', '504'])('falta el 537 con el %s presente y sin notas de crédito recibidas: el crédito queda sin dato', (codigo) => {
    const v = valores({ '538': 190_000, [codigo]: 19_000 });
    expect(montoF29(v, '537')).toBeNull();
    expect(creditoDocumentosF29(v)).toBeNull();
    expect(reglaCredito(entrada({ valores: v }))[0]).toMatchObject({ regla: 'IVA-02', severidad: 'advertencia', naturaleza: 'HECHO' });
  });

  it('las notas de crédito pueden dejar un total en cero: entonces su ausencia sí vale 0', () => {
    expect(debitoF29(valores({ '502': 190_000, '510': 190_000 }))).toBe(0);
    expect(montoF29(valores({ '538': 1, '520': 19_000, '528': 19_000 }), '537')).toBe(0);
    expect(montoF29(valores({ '538': 1, '520': 19_000, '504': 5_000, '528': 24_000 }), '537')).toBe(0);
  });

  it.each<{ caso: string; v: Record<string, number>; total: string }>([
    { caso: '510 no cubre el 502', v: { '502': 300_000, '510': 1_000 }, total: '538' },
    { caso: '528 no cubre el 520', v: { '538': 1, '520': 19_000, '528': 1_000 }, total: '537' },
    { caso: '528 no cubre el 504', v: { '538': 1, '504': 5_000, '528': 1_000 }, total: '537' },
    { caso: '528 no cubre 520 + 532', v: { '538': 1, '520': 19_000, '528': 19_000, '532': 500 }, total: '537' },
    { caso: 'viene el 511 (crédito neto positivo)', v: { '538': 1, '511': 1_000, '520': 19_000, '528': 19_000 }, total: '537' },
  ])('un total ausente queda sin dato si las notas de crédito no lo anulan: $caso', ({ v, total }) => {
    expect(montoF29(valores(v), total)).toBeNull();
  });

  it('sin valores leídos (F29 no descargado o vacío) no hay dato', () => {
    for (const v of [null, valores({})]) {
      expect(debitoF29(v)).toBeNull();
      expect(creditoDocumentosF29(v)).toBeNull();
      expect(montoF29(v, '77')).toBeNull();
    }
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

  it('si el F29 no trajo valores avisa que no se pudo leer', () => {
    expect(reglaDebito(entrada({ valores: valores({}) }))[0]).toMatchObject({ regla: 'IVA-01', severidad: 'advertencia', naturaleza: 'HECHO' });
  });

  it('un F29 leído sin 538 declaró débito cero: cuadra con un mes sin ventas y descuadra si el RCV tiene ventas', () => {
    const sinVentas = [resumen({ lado: 'COMPRA', filas: [fila(33, 100_000, 19_000, 1)] })];
    expect(reglaDebito(entrada({ resumenes: sinVentas, valores: valores({ '537': 24_000, '504': 5_000 }) }))).toEqual([]);
    const [h] = reglaDebito(entrada({ valores: valores({ '537': 24_000, '504': 5_000 }) }));
    expect(h).toMatchObject({ regla: 'IVA-01', severidad: 'critico', montos: { esperado: 190_000, declarado: 0, diferencia: 190_000 } });
  });
});

describe('IVA-02 crédito e IVA-03 remanente', () => {
  it('detecta crédito declarado distinto del RCV', () => {
    expect(reglaCredito(entrada({ valores: valores({ '538': 190_000, '537': 30_000, '504': 5_000 }) }))[0]?.montos).toEqual({ esperado: 19_000, declarado: 25_000, diferencia: -6_000 });
  });

  it('un F29 leído sin 537 ni 504 declaró crédito cero: cuadra con un mes sin compras', () => {
    const sinCompras = [resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000, 2)] })];
    expect(reglaCredito(entrada({ resumenes: sinCompras, valores: valores({ '538': 190_000 }) }))).toEqual([]);
    expect(reglaCredito(entrada({ valores: valores({}) }))[0]).toMatchObject({ regla: 'IVA-02', severidad: 'advertencia', naturaleza: 'HECHO' });
  });

  it('detecta un remanente que no calza con el mes anterior', () => {
    const [h] = reglaRemanente(entrada({ valoresAnterior: valores({ '77': 7_000 }, { periodo: '2026-08', folio: 554_000 }) }));
    expect(h).toMatchObject({ regla: 'IVA-03', severidad: 'critico', montos: { esperado: 7_000, declarado: 5_000, diferencia: 2_000 } });
    expect(h!.evidencia).toEqual(['F29:554000', 'F29:555001']);
  });

  it('sin F29 del mes anterior no compara el remanente', () => {
    expect(reglaRemanente(entrada({ valoresAnterior: null }))).toEqual([]);
  });

  const anterior77 = (monto: number) => valores({ '77': monto }, { periodo: '2026-08', folio: 554_000 });
  const actual504 = (monto: number) => valores({ '538': 190_000, '537': 19_000 + monto, '504': monto });

  it.each([101_500, 102_000, 98_000, 100_040])('considera coherente un 504 de %s tras un 77 de 100.000: el SII reajusta el remanente por la UTM', (monto) => {
    expect(reglaRemanente(entrada({ valoresAnterior: anterior77(100_000), valores: actual504(monto) }))).toEqual([]);
  });

  it('más allá del 2 % es crítico y el detalle atribuye hasta un 2 % al reajuste por la UTM', () => {
    const [h] = reglaRemanente(entrada({ valoresAnterior: anterior77(100_000), valores: actual504(102_100) }));
    expect(h).toMatchObject({ regla: 'IVA-03', severidad: 'critico', montos: { esperado: 100_000, declarado: 102_100, diferencia: -2_100 } });
    expect(h!.detalle).toContain('Hasta un 2 % de diferencia se atribuye al reajuste del remanente según la variación de la UTM.');
    expect(REAJUSTE_UTM_REMANENTE).toBe(0.02);
  });

  it('usa la tolerancia en pesos cuando supera el 2 % del remanente', () => {
    expect(reglaRemanente(entrada({ toleranciaPesos: 500, valoresAnterior: anterior77(10_000), valores: actual504(10_400) }))).toEqual([]);
    expect(reglaRemanente(entrada({ toleranciaPesos: 500, valoresAnterior: anterior77(10_000), valores: actual504(10_600) }))).toHaveLength(1);
  });

  it('un 504 sin remanente en el F29 anterior leído es crítico', () => {
    const [h] = reglaRemanente(entrada({ valoresAnterior: valores({ '91': 1 }, { periodo: '2026-08', folio: 554_000 }), valores: actual504(5_000) }));
    expect(h?.montos).toEqual({ esperado: 0, declarado: 5_000, diferencia: -5_000 });
  });

  it('si algún F29 no trajo valores no compara ni inventa un esperado de 0', () => {
    expect(reglaRemanente(entrada({ valoresAnterior: valores({}, { periodo: '2026-08', folio: 554_000 }) }))).toEqual([]);
    expect(reglaRemanente(entrada({ valores: valores({}) }))).toEqual([]);
  });
});
