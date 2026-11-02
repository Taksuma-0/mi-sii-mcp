import { describe, expect, it } from 'vitest';
import type { TramoIgc } from '../../src/reconciliation/estimar-renta.js';
import { proyectarCierre, simularRegimen } from '../../src/reconciliation/simuladores.js';

// Tabla ficticia y simple: exento hasta 10.000.000; 10 % hasta 50.000.000; 30 % sobre eso.
const TABLA: TramoIgc[] = [
  { desde: 0, hasta: 10_000_000, factor: 0, rebaja: 0 },
  { desde: 10_000_000, hasta: 50_000_000, factor: 0.1, rebaja: 1_000_000 },
  { desde: 50_000_000, hasta: null, factor: 0.3, rebaja: 11_000_000 },
];

describe('simularRegimen', () => {
  it('compara Pro Pyme General y Transparente con un socio que retira todo', () => {
    const s = simularRegimen({ base: 40_000_000, socios: [{ participacion: 100, otrasRentas: 0 }], tasaIdpc: 12.5, tablaIgc: TABLA, retiroPct: 100 });

    // General: IDPC 5.000.000; el socio declara 40.000.000 (retiro + crédito) → IGC 3.000.000 − crédito 5.000.000 = −2.000.000.
    expect(s.general.impuestoEmpresa).toBe(5_000_000);
    expect(s.general.socios[0]!.impuesto).toBe(-2_000_000);
    expect(s.general.total).toBe(3_000_000);
    // Transparente: sin IDPC; el socio declara 40.000.000 → IGC 3.000.000.
    expect(s.transparente.impuestoEmpresa).toBe(0);
    expect(s.transparente.total).toBe(3_000_000);
    expect(s.diferencia).toBe(0);
    expect(s.supuestos.join(' ')).toContain('excedente');
  });

  it('con retiros parciales, el General difiere el impuesto del dueño y lo informa', () => {
    const s = simularRegimen({ base: 40_000_000, socios: [{ participacion: 100, otrasRentas: 20_000_000 }], tasaIdpc: 12.5, tablaIgc: TABLA, retiroPct: 0 });

    expect(s.general.impuestoEmpresa).toBe(5_000_000);
    expect(s.general.impuestoDuenos).toBe(0);
    expect(s.general.diferido).toBe(35_000_000);
    // Transparente: IGC(60.000.000) − IGC(20.000.000) = 7.000.000 − 1.000.000 = 6.000.000.
    expect(s.transparente.impuestoDuenos).toBe(6_000_000);
    expect(s.diferencia).toBe(-1_000_000);
  });

  it('reparte la base según la participación de cada socio', () => {
    const s = simularRegimen({ base: 40_000_000, socios: [{ participacion: 50, otrasRentas: 0 }, { participacion: 50, otrasRentas: 60_000_000 }], tasaIdpc: 12.5, tablaIgc: TABLA, retiroPct: 100 });

    // Transparente: socio 1 IGC(20.000.000) = 1.000.000; socio 2 IGC(80.000.000) − IGC(60.000.000) = 13.000.000 − 7.000.000 = 6.000.000.
    expect(s.transparente.socios.map((x) => x.impuesto)).toEqual([1_000_000, 6_000_000]);
  });

  it('una pérdida no genera impuesto en ningún régimen ni se atribuye a los dueños', () => {
    const s = simularRegimen({ base: -5_000_000, socios: [{ participacion: 100, otrasRentas: 30_000_000 }], tasaIdpc: 12.5, tablaIgc: TABLA, retiroPct: 100 });

    expect(s.general.total).toBe(0);
    expect(s.transparente.total).toBe(0);
    expect(s.supuestos.join(' ')).toContain('pérdida');
  });
});

describe('proyectarCierre', () => {
  it('proyecta al ritmo del año los ingresos, gastos y PPM, y estima el saldo de abril con la tasa', () => {
    const p = proyectarCierre({ mesesConDatos: 10, ingresos: 100_000_000, gastos: 60_000_000, ppm: 1_000_000, mesesPpm: 10, tasaIdpc: 12.5 });

    expect(p.baseAcumulada).toBe(40_000_000);
    expect(p.baseProyectada).toBe(48_000_000);
    expect(p.ppmProyectados).toBe(1_200_000);
    expect(p.idpcEstimado).toBe(6_000_000);
    expect(p.saldoAbril).toBe(4_800_000);
  });

  it('sin tasa no estima el impuesto y lo pide', () => {
    const p = proyectarCierre({ mesesConDatos: 12, ingresos: 10, gastos: 5, ppm: 0, mesesPpm: 0, tasaIdpc: null });

    expect(p.idpcEstimado).toBeNull();
    expect(p.saldoAbril).toBeNull();
    expect(p.faltantes.join(' ')).toContain('tasa_idpc');
  });

  it('con pérdida proyectada y PPM pagados, avisa la suspensión del art. 90 como posible', () => {
    const p = proyectarCierre({ mesesConDatos: 6, ingresos: 10_000_000, gastos: 14_000_000, ppm: 300_000, mesesPpm: 6, tasaIdpc: 12.5 });

    expect(p.baseProyectada).toBe(-8_000_000);
    expect(p.idpcEstimado).toBe(0);
    expect(p.saldoAbril).toBe(-600_000);
    expect(p.notas.join(' ')).toContain('art. 90');
    expect(p.notas.join(' ')).toContain('confírmalo con tu contador');
  });
});
