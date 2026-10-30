import { describe, expect, it } from 'vitest';
import { conciliacionBancaria, cuentasPendientes, fijarConciliacion } from '../../src/app/banco.js';
import type { MovimientoLeido } from '../../src/domain/banco.js';
import { depsDePrueba } from '../helpers/deps.js';
import { codigoDe } from '../helpers/errores.js';
import { boleta, declaracion, documento, perfilEmpresa, RUT_CLIENTE, RUT_EMPRESA } from '../helpers/fabricas.js';
import { sembrarMes, T_SEMBRADO } from '../helpers/sembrar.js';

const T = '2026-10-30T12:00:00.000Z';
const mov = (huella: string, fecha: string, monto: number, descripcion = 'MOVIMIENTO'): MovimientoLeido => ({ huella, fecha, descripcion, documento: null, monto, saldo: null });

/** Octubre de una empresa: una venta, una compra, una boleta recibida, el F29 de septiembre pagado y una comisión del banco. */
function preparar() {
  const p = depsDePrueba({ ahora: '2026-10-30T15:00:00.000Z' });
  p.store.guardarContribuyente(perfilEmpresa());
  sembrarMes(p.store, '2026-09', { declaraciones: [declaracion({ periodo: '2026-09', folio: 555, totalAPagar: 171_000, fechaPresentacion: '2026-10-15' })] });
  sembrarMes(p.store, '2026-10', {
    documentos: [
      documento({ periodo: '2026-10', lado: 'VENTA', tipoDoc: 33, rutContraparte: RUT_CLIENTE, folio: 1, razonSocial: 'CLIENTE DEMO SPA', fechaEmision: '2026-10-01', montoTotal: 1_190_000 }),
      documento({ periodo: '2026-10', lado: 'COMPRA', tipoDoc: 33, folio: 9, fechaEmision: '2026-10-02', montoTotal: 119_000 }),
    ],
  });
  const id = p.store.iniciarSincronizacion(RUT_EMPRESA, 'bhe.recibidas', '2026-10', T_SEMBRADO);
  p.store.reemplazarBhe(id, RUT_EMPRESA, '2026-10', [boleta({ periodo: '2026-10', fecha: '2026-10-03', liquido: 50_000 })], T_SEMBRADO);
  p.store.terminarSincronizacion(id, T_SEMBRADO, 'ok');
  p.store.guardarImportacionBanco(RUT_EMPRESA, 'principal', { archivo: 'octubre.csv', sha256: 'x', filas: 5 }, [
    mov('venta', '2026-10-05', 1_190_000, 'TRANSF DE 44.444.444-4'),
    mov('compra', '2026-10-06', -119_000),
    mov('boleta', '2026-10-07', -50_000),
    mov('f29', '2026-10-15', -171_000, 'PAGO TGR'),
    mov('comision', '2026-10-20', -9_990, 'COMISION MANTENCION'),
  ], T);
  return p;
}

describe('conciliacionBancaria', () => {
  it('concilia ventas, compras, boletas recibidas y el F29 pagado con la cartola, y deja lo demás pendiente', () => {
    const { deps } = preparar();

    const r = conciliacionBancaria(deps, RUT_EMPRESA, '2026-10', '2026-10');

    expect(r).toMatchObject({ rut: RUT_EMPRESA, desde: '2026-10-01', hasta: '2026-10-31', movimientos: 5, conciliados: 4, manuales: 0, descartados: 0 });
    expect(r.pares.map((p) => [p.huella, p.tipo, p.criterio])).toEqual([
      ['venta', 'venta', 'monto_rut'],
      ['compra', 'compra', 'monto_fecha'],
      ['boleta', 'bhe_recibida', 'monto_fecha'],
      ['f29', 'f29', 'monto_fecha'],
    ]);
    expect(r.pares[0]).toMatchObject({ nombre: 'CLIENTE DEMO SPA', monto: 1_190_000, fecha: '2026-10-05' });
    expect(r.sinConciliar.map((m) => [m.huella, m.monto])).toEqual([['comision', -9_990]]);
    expect(r.partidasSinMovimiento).toEqual([]);
  });

  it('respeta lo asignado a mano y los descartados al volver a conciliar', () => {
    const { deps } = preparar();
    const antes = conciliacionBancaria(deps, RUT_EMPRESA, '2026-10', '2026-10');
    const claveCompra = antes.pares.find((p) => p.tipo === 'compra')!.clave;

    fijarConciliacion(deps, RUT_EMPRESA, 'descartar', 'comision');
    fijarConciliacion(deps, RUT_EMPRESA, 'descartar', 'compra');
    const r = conciliacionBancaria(deps, RUT_EMPRESA, '2026-10', '2026-10');

    expect(r).toMatchObject({ conciliados: 3, descartados: 2, sinConciliar: [] });
    expect(r.partidasSinMovimiento.map((p) => p.clave)).toEqual([claveCompra]);
    fijarConciliacion(deps, RUT_EMPRESA, 'asignar', 'compra', claveCompra);
    expect(conciliacionBancaria(deps, RUT_EMPRESA, '2026-10', '2026-10')).toMatchObject({ conciliados: 4, manuales: 1, descartados: 1 });
  });

  it('asignar exige una partida que exista y un movimiento guardado', async () => {
    const { deps } = preparar();
    expect(await codigoDe(Promise.resolve().then(() => fijarConciliacion(deps, RUT_EMPRESA, 'asignar', 'comision', 'VENTA:33:no-existe:1')))).toBe('PARAMETROS_INVALIDOS');
    expect(await codigoDe(Promise.resolve().then(() => fijarConciliacion(deps, RUT_EMPRESA, 'descartar', 'no-existe')))).toBe('PARAMETROS_INVALIDOS');
  });

  it('sin cartolas pide importarlas', async () => {
    const { deps } = depsDePrueba();
    deps.store.guardarContribuyente(perfilEmpresa());
    expect(await codigoDe(Promise.resolve().then(() => conciliacionBancaria(deps, RUT_EMPRESA, '2026-10', '2026-10')))).toBe('SIN_DATOS_LOCALES');
  });
});

describe('cuentasPendientes', () => {
  it('lista lo facturado que no aparece en la cartola, por antigüedad', () => {
    const { deps, store } = preparar();
    sembrarMes(store, '2026-08', { documentos: [documento({ periodo: '2026-08', lado: 'VENTA', rutContraparte: RUT_CLIENTE, folio: 7, razonSocial: 'CLIENTE DEMO SPA', fechaEmision: '2026-08-15', montoTotal: 500_000 })] });
    sembrarMes(store, '2026-10', {
      documentos: [
        documento({ periodo: '2026-10', lado: 'VENTA', rutContraparte: RUT_CLIENTE, folio: 1, fechaEmision: '2026-10-01', montoTotal: 1_190_000 }),
        documento({ periodo: '2026-10', lado: 'COMPRA', folio: 9, fechaEmision: '2026-10-02', montoTotal: 119_000 }),
        documento({ periodo: '2026-10', lado: 'COMPRA', folio: 10, fechaEmision: '2026-10-10', montoTotal: 238_000 }),
      ],
    });

    const r = cuentasPendientes(deps, RUT_EMPRESA, '2026-10-30');

    expect(r.porCobrar.total).toBe(500_000);
    expect(r.porCobrar.tramos).toEqual({ '0-30': 0, '31-60': 0, '61-90': 500_000, '+90': 0 });
    expect(r.porCobrar.documentos.map((d) => [d.fecha, d.monto, d.dias])).toEqual([['2026-08-15', 500_000, 76]]);
    expect(r.porPagar.total).toBe(238_000);
    expect(r.porPagar.documentos.map((d) => [d.clave, d.tramo])).toEqual([['COMPRA:33:33333333-3:10', '0-30']]);
    expect(r.cartolaDesde).toBe('2026-10-05');
  });
});
