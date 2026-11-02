import { describe, expect, it } from 'vitest';
import { abrirDb } from '../../src/store/sqlite/db.js';
import { SqliteStore } from '../../src/store/sqlite/store.js';
import { RUT_EMPRESA } from '../helpers/fabricas.js';

const T1 = '2026-11-02T03:00:00.000Z';
const T2 = '2026-11-03T03:00:00.000Z';
const nuevo = () => new SqliteStore(abrirDb(':memory:'));

describe('huellas del portal', () => {
  it('la primera vez guarda la base sin rutas nuevas; después devuelve solo las nuevas y las une', () => {
    const store = nuevo();

    expect(store.registrarHuella('rcv.detalle.COMPRA.REGISTRO.N', ['data[].detMntNeto:n', 'data[].detNroDoc:n'], T1)).toEqual([]);
    expect(store.registrarHuella('rcv.detalle.COMPRA.REGISTRO.N', ['data[].detMntNeto:n'], T2)).toEqual([]);
    expect(store.registrarHuella('rcv.detalle.COMPRA.REGISTRO.N', ['data[].detMntNeto:n', 'data[].detMntNuevo:n'], T2)).toEqual(['data[].detMntNuevo:n']);

    expect(store.huellasPortal()).toEqual([
      { superficie: 'rcv.detalle.COMPRA.REGISTRO.N', rutas: ['data[].detMntNeto:n', 'data[].detMntNuevo:n', 'data[].detNroDoc:n'], primeraVez: T1, ultimaVez: T2 },
    ]);
  });
});

describe('cambios del portal y alias aprendidos', () => {
  it('registra cambios con su detalle y los filtra por fecha', () => {
    const store = nuevo();
    store.registrarCambioPortal('rcv.detalle', 'aditivo', { rutas: ['data[].x:n'] }, T1);
    store.registrarCambioPortal('rcv.detalle', 'reparado', { campo: 'montoNeto', alias: 'detMntNetoNuevo' }, T2);

    expect(store.cambiosPortal().map((c) => [c.superficie, c.tipo, c.detectadoEn])).toEqual([
      ['rcv.detalle', 'aditivo', T1],
      ['rcv.detalle', 'reparado', T2],
    ]);
    expect(store.cambiosPortal(T2)).toEqual([{ id: 2, superficie: 'rcv.detalle', tipo: 'reparado', detalle: { campo: 'montoNeto', alias: 'detMntNetoNuevo' }, detectadoEn: T2 }]);
  });

  it('guarda cada alias una sola vez y los devuelve', () => {
    const store = nuevo();
    const alias = { superficie: 'rcv.detalle', campo: 'montoNeto', alias: 'detMntNetoNuevo', aprendidoEn: T1, evidencia: 'suma 100.000 = resumen 33 2026-09' };
    store.guardarAlias(alias);
    store.guardarAlias({ ...alias, aprendidoEn: T2 });

    expect(store.aliasAprendidos()).toEqual([alias]);
  });

  it('acepta avisos del portal y de versión', () => {
    const store = nuevo();
    const nuevos = store.registrarAvisos(
      [
        { rut: RUT_EMPRESA, clave: 'PA:rcv.detalle:montoNeto:x', tipo: 'portal', severidad: 'advertencia', titulo: 'El SII cambió un campo', detalle: 'd' },
        { rut: RUT_EMPRESA, clave: 'V:0.3.1', tipo: 'version', severidad: 'info', titulo: 'Hay una versión nueva', detalle: 'd' },
      ],
      T1,
    );
    expect(nuevos.map((a) => a.tipo)).toEqual(['portal', 'version']);
  });
});
