import { describe, expect, it } from 'vitest';
import { adaptacionPortal } from '../../src/main/adaptacion.js';
import { abrirDb } from '../../src/store/sqlite/db.js';
import { SqliteStore } from '../../src/store/sqlite/store.js';
import { RUT_EMPRESA } from '../helpers/fabricas.js';

const alias = { superficie: 'rcv.detalle', campo: 'montoNeto', alias: 'detMntNetoNuevo', aprendidoEn: '2026-11-02T03:00:00.000Z', evidencia: 'suma de detMntNetoNuevo = neto del resumen (tipo 33, 2026-09, 2 documentos)' };

describe('adaptación del lector a los cambios del portal', () => {
  it('el mapa de campos incluye los nombres ya aprendidos', () => {
    const store = new SqliteStore(abrirDb(':memory:'));
    store.guardarAlias(alias);

    expect(adaptacionPortal(store, RUT_EMPRESA).mapa?.alias('rcv.detalle', 'montoNeto')).toEqual(['detMntNetoNuevo', 'detMntNeto', 'mntNeto']);
  });

  it('un nombre aprendido se guarda, queda como cambio «reparado» y avisa una sola vez', () => {
    const store = new SqliteStore(abrirDb(':memory:'));
    const { alAprender } = adaptacionPortal(store, RUT_EMPRESA);

    alAprender?.(alias);
    alAprender?.(alias);

    expect(store.aliasAprendidos()).toEqual([alias]);
    expect(store.cambiosPortal().map((c) => [c.superficie, c.tipo, c.detalle])).toEqual([
      ['rcv.detalle', 'reparado', { campo: 'montoNeto', alias: 'detMntNetoNuevo', evidencia: alias.evidencia }],
      ['rcv.detalle', 'reparado', { campo: 'montoNeto', alias: 'detMntNetoNuevo', evidencia: alias.evidencia }],
    ]);
    const avisos = store.avisos();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ rut: RUT_EMPRESA, tipo: 'portal', severidad: 'advertencia', clave: 'PA:rcv.detalle:montoNeto:detMntNetoNuevo' });
    expect(avisos[0]!.detalle).toContain('detMntNetoNuevo');
  });
});
