import { describe, expect, it } from 'vitest';
import type { MovimientoLeido, ParConciliado } from '../../src/domain/banco.js';
import { abrirDb } from '../../src/store/sqlite/db.js';
import { SqliteStore } from '../../src/store/sqlite/store.js';
import { RUT_EMPRESA } from '../helpers/fabricas.js';

const T = '2026-10-30T12:00:00.000Z';
const mov = (huella: string, fecha: string, monto: number, o: Partial<MovimientoLeido> = {}): MovimientoLeido => ({
  huella,
  fecha,
  descripcion: `Movimiento ${huella}`,
  documento: null,
  monto,
  saldo: null,
  ...o,
});
const archivo = (nombre: string, filas: number) => ({ archivo: nombre, sha256: `sha-${nombre}`, filas });
const par = (huella: string, clave: string, o: Partial<ParConciliado> = {}): ParConciliado => ({ huella, tipo: 'venta', clave, criterio: 'monto_fecha', dias: 1, ...o });

function preparar() {
  const store = new SqliteStore(abrirDb(':memory:'));
  return store;
}

describe('cartolas bancarias en la base', () => {
  it('guarda una importación y no repite los movimientos que ya estaban (cartolas que se solapan)', () => {
    const store = preparar();
    const primera = store.guardarImportacionBanco(RUT_EMPRESA, 'corriente', archivo('octubre.csv', 3), [mov('a', '2026-10-01', 100_000), mov('b', '2026-10-02', -40_000), mov('c', '2026-10-05', 15_000)], T);
    const segunda = store.guardarImportacionBanco(RUT_EMPRESA, 'corriente', archivo('octubre-2.csv', 3), [mov('b', '2026-10-02', -40_000), mov('c', '2026-10-05', 15_000), mov('d', '2026-10-07', -5_000)], T);

    expect(primera).toEqual({ nuevos: 3, repetidos: 0 });
    expect(segunda).toEqual({ nuevos: 1, repetidos: 2 });
    const movimientos = store.movimientosBanco(RUT_EMPRESA);
    expect(movimientos.map((m) => m.huella)).toEqual(['a', 'b', 'c', 'd']);
    expect(movimientos[1]).toMatchObject({ rut: RUT_EMPRESA, cuenta: 'corriente', fecha: '2026-10-02', monto: -40_000, descripcion: 'Movimiento b' });
    expect(store.cuentasBanco(RUT_EMPRESA)).toEqual(['corriente']);
  });

  it('filtra los movimientos por cuenta y por fechas', () => {
    const store = preparar();
    store.guardarImportacionBanco(RUT_EMPRESA, 'corriente', archivo('a.csv', 2), [mov('a', '2026-09-30', 1), mov('b', '2026-10-02', 2)], T);
    store.guardarImportacionBanco(RUT_EMPRESA, 'vista', archivo('b.csv', 1), [mov('x', '2026-10-03', 3)], T);

    expect(store.movimientosBanco(RUT_EMPRESA, { cuenta: 'vista' }).map((m) => m.huella)).toEqual(['x']);
    expect(store.movimientosBanco(RUT_EMPRESA, { desde: '2026-10-01', hasta: '2026-10-31' }).map((m) => m.huella)).toEqual(['b', 'x']);
    expect(store.cuentasBanco(RUT_EMPRESA)).toEqual(['corriente', 'vista']);
  });

  it('reemplaza la conciliación automática del rango y conserva lo fijado a mano', () => {
    const store = preparar();
    store.guardarImportacionBanco(RUT_EMPRESA, 'corriente', archivo('a.csv', 3), [mov('a', '2026-10-01', 100), mov('b', '2026-10-02', 200), mov('c', '2026-10-03', 300)], T);
    store.reemplazarConciliacionAutomatica(RUT_EMPRESA, '2026-10-01', '2026-10-31', [par('a', 'VENTA:33:1:1'), par('b', 'VENTA:33:1:2')], T);
    store.fijarConciliacionManual(RUT_EMPRESA, 'b', { tipo: 'compra', clave: 'COMPRA:33:2:9' }, T);
    store.fijarConciliacionManual(RUT_EMPRESA, 'c', null, T);

    store.reemplazarConciliacionAutomatica(RUT_EMPRESA, '2026-10-01', '2026-10-31', [par('a', 'VENTA:33:1:5'), par('b', 'VENTA:33:1:2'), par('c', 'VENTA:33:1:3')], T);

    expect(store.conciliaciones(RUT_EMPRESA).map((c) => [c.huella, c.tipo, c.clave, c.criterio])).toEqual([
      ['a', 'venta', 'VENTA:33:1:5', 'monto_fecha'],
      ['b', 'compra', 'COMPRA:33:2:9', 'manual'],
      ['c', null, null, 'manual'],
    ]);
  });

  it('una partida asignada a mano a un movimiento no queda también en otro automático', () => {
    const store = preparar();
    store.guardarImportacionBanco(RUT_EMPRESA, 'corriente', archivo('a.csv', 2), [mov('a', '2026-10-01', 100), mov('b', '2026-10-02', 100)], T);
    store.fijarConciliacionManual(RUT_EMPRESA, 'a', { tipo: 'venta', clave: 'VENTA:33:1:1' }, T);

    store.reemplazarConciliacionAutomatica(RUT_EMPRESA, '2026-10-01', '2026-10-31', [par('b', 'VENTA:33:1:1')], T);

    expect(store.conciliaciones(RUT_EMPRESA).map((c) => c.huella)).toEqual(['a']);
  });

  it('la conciliación de otro rango no se toca', () => {
    const store = preparar();
    store.guardarImportacionBanco(RUT_EMPRESA, 'corriente', archivo('a.csv', 2), [mov('a', '2026-09-15', 100), mov('b', '2026-10-02', 200)], T);
    store.reemplazarConciliacionAutomatica(RUT_EMPRESA, '2026-09-01', '2026-10-31', [par('a', 'VENTA:33:1:1'), par('b', 'VENTA:33:1:2')], T);

    store.reemplazarConciliacionAutomatica(RUT_EMPRESA, '2026-10-01', '2026-10-31', [], T);

    expect(store.conciliaciones(RUT_EMPRESA).map((c) => c.huella)).toEqual(['a']);
    expect(store.conciliaciones(RUT_EMPRESA, '2026-10-01', '2026-10-31')).toEqual([]);
  });
});
