import { describe, expect, it } from 'vitest';
import { CUENTAS } from '../../src/domain/contabilidad.js';
import { asientosDelPeriodo, type Asiento, type EntradaAsientos } from '../../src/reconciliation/asientos.js';
import { boleta, boletaEmitida, documento, RUT_CLIENTE, RUT_EMPRESA, RUT_PROVEEDOR } from '../helpers/fabricas.js';

const vacia: EntradaAsientos = { documentos: [], resumenesBoletas: [], boletasRecibidas: [], boletasEmitidas: [], f29: [], banco: [], reglas: new Map() };
const lineas = (a: Asiento | undefined) => a?.lineas.map((l) => [l.cuenta, l.debe, l.haber]);
const cuadra = (asientos: readonly Asiento[]) => asientos.every((a) => a.lineas.reduce((s, l) => s + l.debe - l.haber, 0) === 0);

describe('asientosDelPeriodo', () => {
  it('una venta: clientes al debe; ventas, exentas e IVA débito al haber', () => {
    const [a] = asientosDelPeriodo({ ...vacia, documentos: [documento({ lado: 'VENTA', rutContraparte: RUT_CLIENTE, folio: 1, fechaEmision: '2026-09-03', montoExento: 50_000, montoNeto: 1_000_000, montoIva: 190_000, montoTotal: 1_240_000 })] });
    expect(a).toMatchObject({ fecha: '2026-09-03', origen: `RCV:VENTA:33:${RUT_CLIENTE}:1` });
    expect(lineas(a)).toEqual([[CUENTAS.CLIENTES, 1_240_000, 0], [CUENTAS.VENTAS, 0, 1_000_000], [CUENTAS.VENTAS_EXENTAS, 0, 50_000], [CUENTAS.IVA_DF, 0, 190_000]]);
  });

  it('una compra del giro va a costos con IVA crédito; con regla, a la cuenta del proveedor; una nota de crédito invierte', () => {
    const compra = documento({ folio: 9, fechaEmision: '2026-09-05', montoNeto: 100_000, montoIva: 19_000, montoTotal: 119_000 });
    const nc = documento({ tipoDoc: 61, folio: 10, fechaEmision: '2026-09-06', montoNeto: 10_000, montoIva: 1_900, montoTotal: 11_900 });
    const asientos = asientosDelPeriodo({ ...vacia, documentos: [compra, nc], reglas: new Map([[RUT_PROVEEDOR, '5210']]) });
    expect(lineas(asientos[0])).toEqual([['5210', 100_000, 0], [CUENTAS.IVA_CF, 19_000, 0], [CUENTAS.PROVEEDORES, 0, 119_000]]);
    expect(lineas(asientos[1])).toEqual([['5210', 0, 10_000], [CUENTAS.IVA_CF, 0, 1_900], [CUENTAS.PROVEEDORES, 11_900, 0]]);
  });

  it('una compra sin derecho a crédito lleva el IVA a gasto, y lo que no calza del total queda por clasificar', () => {
    const [a] = asientosDelPeriodo({ ...vacia, documentos: [documento({ tipoCompra: '6', montoNeto: 100_000, montoIva: 0, montoIvaNoRecuperable: 19_000, montoTotal: 125_000 })] });
    expect(lineas(a)).toEqual([[CUENTAS.GASTOS_GENERALES, 100_000, 0], [CUENTAS.IVA_NO_RECUPERABLE, 19_000, 0], [CUENTAS.POR_CLASIFICAR, 6_000, 0], [CUENTAS.PROVEEDORES, 0, 125_000]]);
  });

  it('una boleta recibida reconoce el gasto, la retención y lo que se le debe al profesional; las anuladas no van', () => {
    const asientos = asientosDelPeriodo({ ...vacia, boletasRecibidas: [boleta(), boleta({ folio: 102, anulada: true })] });
    expect(asientos).toHaveLength(1);
    expect(lineas(asientos[0])).toEqual([[CUENTAS.HONORARIOS, 1_000_000, 0], [CUENTAS.RETENCIONES, 0, 152_500], [CUENTAS.HONORARIOS_POR_PAGAR, 0, 847_500]]);
  });

  it('una boleta emitida reconoce el ingreso, la retención por recuperar y lo que se cobra', () => {
    const [a] = asientosDelPeriodo({ ...vacia, boletasEmitidas: [boletaEmitida()] });
    const b = boletaEmitida();
    expect(lineas(a)).toEqual([[CUENTAS.CLIENTES, b.liquido, 0], [CUENTAS.RETENCIONES_POR_RECUPERAR, b.retencionReceptor + b.retencionEmisor, 0], [CUENTAS.INGRESOS_HONORARIOS, 0, b.bruto]]);
  });

  it('el F29 centraliza el IVA, el PPM, la retención y los recargos contra impuestos por pagar', () => {
    const [a] = asientosDelPeriodo({
      ...vacia,
      f29: [{ periodo: '2026-09', folio: 555, fecha: '2026-10-15', valores: { '538': 190_000, '537': 69_000, '89': 121_000, '62': 2_500, '151': 15_250, '48': 4_000, '91': 142_750, '94': 150_000 } }],
    });
    expect(a).toMatchObject({ fecha: '2026-10-15', origen: 'F29:2026-09:555' });
    expect(lineas(a)).toEqual([
      [CUENTAS.IVA_DF, 190_000, 0],
      [CUENTAS.IVA_CF, 0, 69_000],
      [CUENTAS.PPM, 2_500, 0],
      [CUENTAS.RETENCIONES, 15_250, 0],
      [CUENTAS.IMPUESTO_UNICO, 4_000, 0],
      [CUENTAS.MULTAS, 7_250, 0],
      [CUENTAS.IMPUESTOS_POR_PAGAR, 0, 150_000],
    ]);
  });

  it('con más crédito que débito solo se usa el crédito necesario: el resto queda como remanente en el IVA crédito', () => {
    const [a] = asientosDelPeriodo({ ...vacia, f29: [{ periodo: '2026-09', folio: 1, fecha: '2026-10-15', valores: { '538': 50_000, '537': 80_000, '77': 30_000, '91': 0 } }] });
    expect(lineas(a)).toEqual([[CUENTAS.IVA_DF, 50_000, 0], [CUENTAS.IVA_CF, 0, 50_000]]);
  });

  it('el banco: cobros, pagos y F29 contra su cuenta; lo descartado o sin conciliar, por clasificar', () => {
    const mov = (huella: string, monto: number) => ({ rut: RUT_EMPRESA, cuenta: 'principal', fecha: '2026-10-05', descripcion: huella, documento: null, monto, saldo: null, huella });
    const asientos = asientosDelPeriodo({
      ...vacia,
      banco: [
        { movimiento: mov('cobro', 1_190_000), tipo: 'venta' },
        { movimiento: mov('pago', -119_000), tipo: 'compra' },
        { movimiento: mov('honorario', -847_500), tipo: 'bhe_recibida' },
        { movimiento: mov('impuesto', -150_000), tipo: 'f29' },
        { movimiento: mov('comision', -9_990), tipo: null },
      ],
    });
    expect(asientos.map((a) => lineas(a))).toEqual([
      [[CUENTAS.BANCO, 1_190_000, 0], [CUENTAS.CLIENTES, 0, 1_190_000]],
      [[CUENTAS.PROVEEDORES, 119_000, 0], [CUENTAS.BANCO, 0, 119_000]],
      [[CUENTAS.HONORARIOS_POR_PAGAR, 847_500, 0], [CUENTAS.BANCO, 0, 847_500]],
      [[CUENTAS.IMPUESTOS_POR_PAGAR, 150_000, 0], [CUENTAS.BANCO, 0, 150_000]],
      [[CUENTAS.POR_CLASIFICAR, 9_990, 0], [CUENTAS.BANCO, 0, 9_990]],
    ]);
  });

  it('todo asiento cuadra: debe igual a haber', () => {
    const asientos = asientosDelPeriodo({
      ...vacia,
      documentos: [documento({ lado: 'VENTA', montoTotal: 1_190_001 }), documento({ tipoDoc: 61 }), documento({ tipoCompra: '5', montoIva: 0, montoIvaUsoComun: 19_000 })],
      resumenesBoletas: [{ periodo: '2026-09', tipoDoc: 39, cantidad: 3, exento: 0, neto: 50_000, iva: 9_500, total: 59_500 }],
      boletasRecibidas: [boleta({ liquido: 847_499 })],
      f29: [{ periodo: '2026-09', folio: 1, fecha: '2026-10-15', valores: { '538': 1, '537': 2, '91': 0 } }],
    });
    expect(asientos.length).toBeGreaterThan(0);
    expect(cuadra(asientos)).toBe(true);
  });
});
