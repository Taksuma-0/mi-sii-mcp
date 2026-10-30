import { describe, expect, it } from 'vitest';
import { asientos, asignarCuenta, crearCuenta, exportarAsientos, vistaCuentas } from '../../src/app/contabilidad.js';
import { depsDePrueba } from '../helpers/deps.js';
import { codigoDe } from '../helpers/errores.js';
import { declaracion, documento, perfilEmpresa, RUT_CLIENTE, RUT_EMPRESA, RUT_PROVEEDOR, valores } from '../helpers/fabricas.js';
import { sembrarMes } from '../helpers/sembrar.js';

function preparar() {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilEmpresa());
  return p;
}

describe('plan de cuentas de un contribuyente', () => {
  it('parte del plan base y suma las cuentas propias, que pueden renombrar una base', () => {
    const { deps } = preparar();
    crearCuenta(deps, RUT_EMPRESA, { codigo: '5210', nombre: 'Materiales de construcción', tipo: 'gasto' });
    crearCuenta(deps, RUT_EMPRESA, { codigo: '1101', nombre: 'Banco Estado cuenta corriente', tipo: 'activo' });

    const v = vistaCuentas(deps, RUT_EMPRESA);

    expect(v.cuentas.find((c) => c.codigo === '5210')).toEqual({ codigo: '5210', nombre: 'Materiales de construcción', tipo: 'gasto', propia: true });
    expect(v.cuentas.find((c) => c.codigo === '1101')).toMatchObject({ nombre: 'Banco Estado cuenta corriente', propia: true });
    expect(v.cuentas.filter((c) => c.codigo === '1101')).toHaveLength(1);
    expect(v.cuentas.map((c) => c.codigo)).toEqual([...v.cuentas.map((c) => c.codigo)].sort());
  });

  it('asigna una cuenta a un proveedor y la regla se puede quitar', () => {
    const { deps } = preparar();
    crearCuenta(deps, RUT_EMPRESA, { codigo: '5210', nombre: 'Materiales de construcción', tipo: 'gasto' });

    asignarCuenta(deps, RUT_EMPRESA, '33.333.333-3', '5210');
    expect(vistaCuentas(deps, RUT_EMPRESA).reglas).toEqual([{ rutContraparte: RUT_PROVEEDOR, cuenta: '5210', nombreCuenta: 'Materiales de construcción' }]);
    asignarCuenta(deps, RUT_EMPRESA, RUT_PROVEEDOR, null);
    expect(vistaCuentas(deps, RUT_EMPRESA).reglas).toEqual([]);
  });

  it('rechaza cuentas inexistentes, códigos raros y tipos que no son de gasto o activo para un proveedor', async () => {
    const { deps } = preparar();
    const falla = (f: () => unknown) => codigoDe(Promise.resolve().then(f));
    expect(await falla(() => asignarCuenta(deps, RUT_EMPRESA, RUT_PROVEEDOR, '9998'))).toBe('PARAMETROS_INVALIDOS');
    expect(await falla(() => asignarCuenta(deps, RUT_EMPRESA, RUT_PROVEEDOR, '2103'))).toBe('PARAMETROS_INVALIDOS');
    expect(await falla(() => crearCuenta(deps, RUT_EMPRESA, { codigo: '52-10', nombre: 'X', tipo: 'gasto' }))).toBe('PARAMETROS_INVALIDOS');
    expect(await falla(() => crearCuenta(deps, RUT_EMPRESA, { codigo: '5211', nombre: '', tipo: 'gasto' }))).toBe('PARAMETROS_INVALIDOS');
  });
});

describe('asientos propuestos con lo guardado', () => {
  it('arma los asientos del período, todos cuadran y se exportan a CSV con el nombre de cada cuenta', async () => {
    const { deps, store, archivos } = preparar();
    sembrarMes(store, '2026-09', {
      documentos: [
        documento({ lado: 'VENTA', rutContraparte: RUT_CLIENTE, folio: 1, razonSocial: 'CLIENTE DEMO SPA', fechaEmision: '2026-09-03', montoNeto: 1_000_000, montoIva: 190_000, montoTotal: 1_190_000 }),
        documento({ folio: 100, fechaEmision: '2026-09-05', montoNeto: 100_000, montoIva: 19_000, montoTotal: 119_000 }),
      ],
      declaraciones: [declaracion({ folio: 555, fechaPresentacion: '2026-10-15', totalAPagar: 171_000 })],
      valores: [valores({ '538': 190_000, '537': 19_000, '89': 171_000, '91': 171_000 }, { folio: 555 })],
    });

    const r = asientos(deps, RUT_EMPRESA, '2026-09', '2026-09');

    expect(r.asientos.map((a) => a.origen)).toEqual([`RCV:VENTA:33:${RUT_CLIENTE}:1`, `RCV:COMPRA:33:${RUT_PROVEEDOR}:100`, 'F29:2026-09:555']);
    expect(r.totales.debe).toBe(r.totales.haber);
    expect(r.totales.porClasificar).toBe(0);
    const ruta = await exportarAsientos(deps, r);
    expect(ruta).toBe('C:/exportaciones/asientos-22222222-2-2026-09-2026-09.csv');
    const csv = archivos.exportados.get(ruta)!;
    expect(csv).toContain('Fecha;Número;Cuenta;Nombre de la cuenta;Glosa;Debe;Haber;Origen');
    expect(csv).toContain(`05-09-2026;2;5101;Costos y gastos del giro;Factura 100 PROVEEDOR DEMO LTDA;100000;0;RCV:COMPRA:33:${RUT_PROVEEDOR}:100`);
  });
});
