import { describe, expect, it } from 'vitest';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { oportunidades, type EntradaOportunidades } from '../../src/reconciliation/oportunidades.js';
import { documento } from '../helpers/fabricas.js';

const base: EntradaOportunidades = { tipo: 'empresa', actual: parsePeriodo('2026-10'), comprasPendientes: [], f29: [], honorariosEmitidos: null, tieneIngresosPersona: false };
const ids = (e: EntradaOportunidades) => oportunidades(e).map((o) => o.id);

describe('oportunidades de ahorro tributario', () => {
  it('sin datos que las sostengan no inventa ninguna', () => {
    expect(oportunidades(base)).toEqual([]);
  });

  it('OPO-IVA-01: IVA de compras pendientes de los últimos dos períodos que aún se puede usar', () => {
    const [o] = oportunidades({
      ...base,
      comprasPendientes: [documento({ periodo: '2026-09', estado: 'PENDIENTE', montoIva: 19_000 }), documento({ periodo: '2026-10', folio: 2, estado: 'NO_INCLUIR', montoIva: 1_900 }), documento({ periodo: '2026-06', folio: 3, estado: 'PENDIENTE', montoIva: 99_000 })],
    });
    expect(o).toMatchObject({ id: 'OPO-IVA-01', montoEstimado: 20_900, baseLegal: { norma: expect.stringContaining('art. 24') } });
    expect(o!.antielusion).toMatch(/operaciones reales/);
  });

  it('OPO-IVA-02: remanente de crédito sin usar por seis meses o más', () => {
    const f29 = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].map((periodo, i) => ({ periodo, valores: { '77': 100_000 + i * 1_000 } }));
    expect(oportunidades({ ...base, f29 })[0]).toMatchObject({ id: 'OPO-IVA-02', montoEstimado: 105_000 });
    expect(ids({ ...base, f29: f29.slice(1) })).toEqual([]);
  });

  it('OPO-IVA-03: IVA pagado en plazo que una pyme podía postergar dos meses; si ya lo posterga, nada', () => {
    const f29 = [{ periodo: '2026-08', valores: { '89': 300_000 } }, { periodo: '2026-09', valores: { '89': 200_000 } }];
    expect(oportunidades({ ...base, f29 })[0]).toMatchObject({ id: 'OPO-IVA-03', montoEstimado: 500_000 });
    expect(ids({ ...base, f29: [{ periodo: '2026-09', valores: { '89': 0, '755': 200_000 } }] })).toEqual([]);
  });

  it('OPO-HON-01 y OPO-APV-01: una persona con honorarios ve el umbral de gastos efectivos y el APV régimen B', () => {
    const r = oportunidades({ ...base, tipo: 'persona', honorariosEmitidos: { anioComercial: 2026, bruto: 3_000_000 }, tieneIngresosPersona: true });
    expect(r.map((o) => [o.id, o.montoEstimado])).toEqual([['OPO-HON-01', 900_000], ['OPO-APV-01', null]]);
    expect(r[0]!.detalle).toContain('Solo baja tu impuesto si tu base supera el tramo exento');
  });
});
