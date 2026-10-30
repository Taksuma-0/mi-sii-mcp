import { describe, expect, it } from 'vitest';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { estimarF29, type EntradaEstimacionF29, type EstimacionF29 } from '../../src/reconciliation/estimar-f29.js';
import { fila, resumen } from '../helpers/fabricas.js';

const monto = (r: EstimacionF29, codigo: string): number | undefined => r.lineas.find((l) => l.codigo === codigo)?.monto;

/** Mes con débito: ventas 10.000.000 + IVA 1.900.000, compras IVA 380.000, remanente 100.000, tasa 0,25 % y retención 14.500. */
function entrada(o: Partial<EntradaEstimacionF29> = {}): EntradaEstimacionF29 {
  return {
    periodo: parsePeriodo('2026-09'),
    resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 10_000_000, 1_900_000)] }), resumen({ lado: 'COMPRA', filas: [fila(33, 2_000_000, 380_000)] })],
    retencionHonorarios: 14_500,
    remanenteAnterior: { monto: 100_000, origen: 'f29' },
    tasaPpm: { tasa: 0.25, origen: 'f29' },
    impuestoUnico: null,
    factorRemanente: 1.001,
    ...o,
  };
}

describe('estimarF29', () => {
  it('suma el IVA, el PPM y la retención en el total a pagar, con el remanente reajustado', () => {
    const r = estimarF29(entrada());
    expect(monto(r, '538')).toBe(1_900_000);
    expect(monto(r, '504')).toBe(100_100);
    expect(monto(r, '537')).toBe(480_100);
    expect(monto(r, '89')).toBe(1_419_900);
    expect(monto(r, '563')).toBe(10_000_000);
    expect(monto(r, '115')).toBe(0.25);
    expect(monto(r, '62')).toBe(25_000);
    expect(monto(r, '151')).toBe(14_500);
    expect(monto(r, '91')).toBe(1_459_400);
    expect(r.totalAPagar).toBe(1_459_400);
    expect(r.remanenteSiguiente).toBe(0);
    expect(r.periodo).toBe('2026-09');
    expect(r.faltantes).toEqual([]);
  });

  it('con más crédito que débito no hay IVA a pagar y queda remanente, pero el PPM y la retención se pagan igual', () => {
    const r = estimarF29(entrada({ resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000)] }), resumen({ lado: 'COMPRA', filas: [fila(33, 2_000_000, 380_000)] })] }));
    expect(monto(r, '89')).toBe(0);
    expect(r.remanenteSiguiente).toBe(290_100);
    expect(monto(r, '77')).toBe(290_100);
    expect(monto(r, '62')).toBe(2_500);
    expect(r.totalAPagar).toBe(17_000);
  });

  it('una nota de crédito de venta rebaja el débito y la base del PPM', () => {
    const r = estimarF29(entrada({ resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 10_000_000, 1_900_000), fila(61, 2_000_000, 380_000)] }), resumen({ lado: 'COMPRA', filas: [] })] }));
    expect(monto(r, '538')).toBe(1_520_000);
    expect(monto(r, '563')).toBe(8_000_000);
    expect(monto(r, '62')).toBe(20_000);
  });

  it('las ventas exentas suman a la base del PPM y las compras pendientes no dan crédito', () => {
    const exenta = { ...fila(34, 0, 0), exento: 500_000, total: 500_000 };
    const r = estimarF29(
      entrada({
        resumenes: [
          resumen({ lado: 'VENTA', filas: [fila(33, 10_000_000, 1_900_000), exenta] }),
          resumen({ lado: 'COMPRA', filas: [fila(33, 2_000_000, 380_000)] }),
          resumen({ lado: 'COMPRA', estado: 'PENDIENTE', filas: [fila(33, 1_000_000, 190_000)] }),
        ],
      }),
    );
    expect(monto(r, '563')).toBe(10_500_000);
    expect(monto(r, '537')).toBe(480_100);
  });

  it('suma el impuesto único de los trabajadores cuando se informa', () => {
    const r = estimarF29(entrada({ impuestoUnico: 30_000 }));
    expect(monto(r, '48')).toBe(30_000);
    expect(r.totalAPagar).toBe(1_489_400);
  });

  it('lo que no se sabe va a faltantes y no se inventa', () => {
    const r = estimarF29(entrada({ retencionHonorarios: null, tasaPpm: null, remanenteAnterior: { monto: 0, origen: 'sin_dato' } }));
    expect(monto(r, '62')).toBe(0);
    expect(monto(r, '151')).toBe(0);
    expect(r.faltantes).toEqual([expect.stringMatching(/tasa del PPM/), expect.stringMatching(/boletas de honorarios/), expect.stringMatching(/remanente/)]);
  });

  it('dice cuando el remanente viene estimado o va sin reajuste por falta de la UTM', () => {
    const r = estimarF29(entrada({ factorRemanente: null, remanenteAnterior: { monto: 100_000, origen: 'estimado' } }));
    expect(monto(r, '504')).toBe(100_000);
    expect(r.supuestos).toEqual(expect.arrayContaining([expect.stringMatching(/estimado/), expect.stringMatching(/sin reajuste/)]));
    expect(r.lineas.find((l) => l.codigo === '504')?.origen).toBe('estimado');
  });
});
