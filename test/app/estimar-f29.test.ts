import { describe, expect, it } from 'vitest';
import { estimacionF29 } from '../../src/app/estimar-f29.js';
import { depsDePrueba } from '../helpers/deps.js';
import { codigoDe } from '../helpers/errores.js';
import { declaracion, fila, perfilEmpresa, resumen, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { sembrarMes } from '../helpers/sembrar.js';

const ventas = (periodo: string, neto: number, iva: number) => resumen({ periodo, lado: 'VENTA', filas: [fila(33, neto, iva)] });
const compras = (periodo: string, neto: number, iva: number) => resumen({ periodo, lado: 'COMPRA', filas: [fila(33, neto, iva)] });

function preparar() {
  const p = depsDePrueba({ ahora: '2026-10-21T15:00:00.000Z' });
  p.store.guardarContribuyente(perfilEmpresa());
  return p;
}

describe('estimacionF29', () => {
  it('toma el remanente y la tasa del F29 presentado y compara con el total presentado del mes', () => {
    const { deps, store } = preparar();
    sembrarMes(store, '2026-08', {
      resumenes: [compras('2026-08', 263_158, 50_000)],
      declaraciones: [declaracion({ periodo: '2026-08', folio: 801, totalAPagar: 0 })],
      valores: [valores({ '537': 50_000, '77': 50_000, '115': 0.25, '91': 0 }, { periodo: '2026-08', folio: 801 })],
    });
    sembrarMes(store, '2026-09', {
      resumenes: [ventas('2026-09', 1_000_000, 190_000), compras('2026-09', 100_000, 19_000)],
      declaraciones: [declaracion({ folio: 901, totalAPagar: 123_500 })],
      valores: [valores({ '538': 190_000, '537': 69_000, '504': 50_000, '89': 121_000, '62': 2_500, '115': 0.25, '91': 123_500 }, { folio: 901 })],
    });

    const r = estimacionF29(deps, RUT_EMPRESA, '2026-09');

    expect(r.totalAPagar).toBe(123_500);
    expect(r.presentado).toEqual({ folio: 901, totalAPagar: 123_500 });
    expect(r.diferenciaConPresentado).toBe(0);
    expect(r.diasAtraso).toBeNull();
    expect(r.lineas.find((l) => l.codigo === '504')).toMatchObject({ monto: 50_000, origen: 'F29 anterior' });
    expect(r.rut).toBe(RUT_EMPRESA);
  });

  it('arrastra el remanente estimado de los meses sin F29 presentado y cuenta los días de atraso', () => {
    const { deps, store } = preparar();
    sembrarMes(store, '2026-07', {
      declaraciones: [declaracion({ periodo: '2026-07', folio: 701, totalAPagar: 0 })],
      valores: [valores({ '537': 100_000, '77': 100_000, '115': 0.25, '91': 0 }, { periodo: '2026-07', folio: 701 })],
    });
    // 2026-08 sin F29 presentado: compras con IVA 20.000 dejan un remanente estimado de 120.000.
    sembrarMes(store, '2026-08', { resumenes: [compras('2026-08', 105_263, 20_000)] });
    sembrarMes(store, '2026-09', { resumenes: [ventas('2026-09', 1_000_000, 190_000)] });

    const r = estimacionF29(deps, RUT_EMPRESA, '2026-09');

    expect(r.lineas.find((l) => l.codigo === '504')).toMatchObject({ monto: 120_000, origen: 'estimado' });
    // IVA 190.000 − 120.000 = 70.000; PPM 0,25 % de 1.000.000 = 2.500.
    expect(r.totalAPagar).toBe(72_500);
    expect(r.presentado).toBeNull();
    expect(r.vence.conPago).toBe('2026-10-20');
    expect(r.diasAtraso).toBe(1);
  });

  it('usa los parámetros: tasa del PPM, impuesto único y la UTM para reajustar el remanente', () => {
    const { deps, store } = preparar();
    sembrarMes(store, '2026-08', {
      declaraciones: [declaracion({ periodo: '2026-08', folio: 801, totalAPagar: 0 })],
      valores: [valores({ '537': 100_000, '77': 100_000, '91': 0 }, { periodo: '2026-08', folio: 801 })],
    });
    sembrarMes(store, '2026-09', { resumenes: [ventas('2026-09', 1_000_000, 190_000)] });

    const r = estimacionF29(deps, RUT_EMPRESA, '2026-09', { tasaPpm: 0.5, impuestoUnico: 10_000, utmActual: 70_000, utmAnterior: 69_930 });

    expect(r.lineas.find((l) => l.codigo === '504')?.monto).toBe(100_100);
    expect(r.lineas.find((l) => l.codigo === '62')?.monto).toBe(5_000);
    expect(r.totalAPagar).toBe(89_900 + 5_000 + 10_000);
  });

  it('sin RCV del mes pide sincronizarlo y una sola UTM es un parámetro inválido', async () => {
    const { deps, store } = preparar();
    expect(await codigoDe(Promise.resolve().then(() => estimacionF29(deps, RUT_EMPRESA, '2026-09')))).toBe('SIN_DATOS_LOCALES');
    sembrarMes(store, '2026-09', { resumenes: [ventas('2026-09', 1_000_000, 190_000)] });
    expect(await codigoDe(Promise.resolve().then(() => estimacionF29(deps, RUT_EMPRESA, '2026-09', { utmActual: 70_000 })))).toBe('PARAMETROS_INVALIDOS');
  });
});
