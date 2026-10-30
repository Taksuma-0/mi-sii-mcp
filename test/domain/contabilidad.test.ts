import { describe, expect, it } from 'vitest';
import { CUENTAS, cuentaDeCompra, PLAN_CUENTAS_BASE } from '../../src/domain/contabilidad.js';
import { documento, RUT_PROVEEDOR } from '../helpers/fabricas.js';

describe('plan de cuentas base', () => {
  it('trae cada cuenta una sola vez, con su tipo, y todas las que usan los asientos', () => {
    const codigos = PLAN_CUENTAS_BASE.map((c) => c.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const codigo of Object.values(CUENTAS)) expect(codigos).toContain(codigo);
    expect(PLAN_CUENTAS_BASE.find((c) => c.codigo === CUENTAS.IVA_DF)).toMatchObject({ nombre: 'IVA débito fiscal', tipo: 'pasivo' });
  });
});

describe('cuentaDeCompra', () => {
  it.each([
    ['1', CUENTAS.COSTOS, 'recuperable'],
    ['2', CUENTAS.GASTOS_GENERALES, 'recuperable'],
    ['3', CUENTAS.BIENES_RAICES, 'recuperable'],
    ['4', CUENTAS.ACTIVO_FIJO, 'recuperable'],
    ['5', CUENTAS.COSTOS, 'uso_comun'],
    ['6', CUENTAS.GASTOS_GENERALES, 'gasto'],
    ['7', CUENTAS.POR_CLASIFICAR, 'gasto'],
    [null, CUENTAS.COSTOS, 'recuperable'],
  ] as const)('tipo de compra %s → cuenta %s con IVA %s', (tipoCompra, cuenta, iva) => {
    expect(cuentaDeCompra(documento({ tipoCompra }), new Map())).toEqual({ cuenta, iva });
  });

  it('una regla por proveedor cambia la cuenta, pero no cómo se trata el IVA', () => {
    const reglas = new Map([[RUT_PROVEEDOR, '5210']]);
    expect(cuentaDeCompra(documento({ tipoCompra: '1' }), reglas)).toEqual({ cuenta: '5210', iva: 'recuperable' });
    expect(cuentaDeCompra(documento({ tipoCompra: '6' }), reglas)).toEqual({ cuenta: '5210', iva: 'gasto' });
  });
});
