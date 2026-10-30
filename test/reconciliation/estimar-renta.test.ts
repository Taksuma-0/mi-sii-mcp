import { describe, expect, it } from 'vitest';
import { estimarRenta, impuestoSegunTabla, type DatosRenta, type ParametrosRenta } from '../../src/reconciliation/estimar-renta.js';

/** Tabla ficticia de dos tramos: exento hasta $10.000.000 y 4 % con rebaja de $400.000 sobre eso. */
const parametros: ParametrosRenta = {
  tablaIgc: [
    { desde: 0, hasta: 10_000_000, factor: 0, rebaja: 0 },
    { desde: 10_000_000, hasta: null, factor: 0.04, rebaja: 400_000 },
  ],
  uta: 800_000,
  gastosPresuntosPct: 30,
  topeGastosPresuntosUta: 15,
  obligadoCotizar: true,
  cotizaciones: 1_000_000,
};
const datos = (o: Partial<DatosRenta> = {}): DatosRenta => ({ honorariosBrutos: 10_000_000, retencionHonorarios: 1_525_000, sueldos: 0, impuestoUnicoRetenido: 0, ...o });
const linea = (r: ReturnType<typeof estimarRenta>, codigo: string) => r.lineas.find((l) => l.codigo === codigo)?.monto;

describe('impuestoSegunTabla', () => {
  it('aplica el factor y la rebaja del tramo de la base, y nunca da negativo', () => {
    expect(impuestoSegunTabla(7_000_000, parametros.tablaIgc)).toBe(0);
    expect(impuestoSegunTabla(15_000_000, parametros.tablaIgc)).toBe(200_000);
  });
});

describe('estimarRenta', () => {
  it('honorarios bajo el tramo exento: sin impuesto, se devuelve la retención menos las cotizaciones', () => {
    const r = estimarRenta(datos(), parametros);
    expect(linea(r, 'gastos')).toBe(3_000_000);
    expect(r.baseIgc).toBe(7_000_000);
    expect(r.igc).toBe(0);
    expect(r.resultado).toBe(-525_000);
  });

  it('con sueldo la base sube de tramo; el impuesto único retenido es crédito', () => {
    const r = estimarRenta(datos({ sueldos: 8_000_000, impuestoUnicoRetenido: 50_000 }), parametros);
    expect(r.baseIgc).toBe(15_000_000);
    expect(r.igc).toBe(200_000);
    expect(r.resultado).toBe(200_000 - 50_000 - 525_000);
  });

  it('los gastos presuntos tienen tope en UTA y los efectivos se usan si son mayores', () => {
    expect(linea(estimarRenta(datos({ honorariosBrutos: 50_000_000 }), parametros), 'gastos')).toBe(12_000_000);
    expect(linea(estimarRenta(datos({ gastosEfectivos: 4_000_000 }), parametros), 'gastos')).toBe(4_000_000);
  });

  it('el APV régimen B rebaja la base y una persona no obligada a cotizar recupera toda su retención', () => {
    const r = estimarRenta(datos({ sueldos: 8_000_000, apvRegimenB: 2_000_000 }), { ...parametros, obligadoCotizar: false, cotizaciones: undefined });
    expect(r.baseIgc).toBe(13_000_000);
    expect(r.igc).toBe(120_000);
    expect(r.resultado).toBe(120_000 - 1_525_000);
  });

  it('si está obligada a cotizar y no se informa el monto, lo dice en faltantes y no lo inventa', () => {
    const r = estimarRenta(datos(), { ...parametros, cotizaciones: undefined });
    expect(r.cotizaciones).toBe(0);
    expect(r.faltantes).toEqual([expect.stringMatching(/cotizaciones/)]);
  });
});
