import { describe, expect, it } from 'vitest';
import { asignarCuenta, crearCuenta, vistaCuentas } from '../../src/app/contabilidad.js';
import { depsDePrueba } from '../helpers/deps.js';
import { codigoDe } from '../helpers/errores.js';
import { perfilEmpresa, RUT_EMPRESA, RUT_PROVEEDOR } from '../helpers/fabricas.js';

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
