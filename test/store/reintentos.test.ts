import { describe, expect, it } from 'vitest';
import { abrirDb } from '../../src/store/sqlite/db.js';
import { SqliteStore } from '../../src/store/sqlite/store.js';
import { RUT_EMPRESA, RUT_PERSONA } from '../helpers/fabricas.js';

function intento(store: SqliteStore, superficie: string, periodo: string, en: string, error?: string, rut = RUT_EMPRESA): void {
  const id = store.iniciarSincronizacion(rut, superficie, periodo, en);
  store.terminarSincronizacion(id, en, error ? 'error' : 'ok', error ? { codigo: error, detalle: 'detalle' } : undefined);
}

describe('pendientes de reintento', () => {
  it('trae el último intento fallido por el SII de cada superficie y período, con sus intentos desde el último que salió bien', () => {
    const store = new SqliteStore(abrirDb(':memory:'));
    intento(store, 'rcv.VENTA', '2026-05', '2026-10-01T10:00:00.000Z');
    intento(store, 'rcv.VENTA', '2026-05', '2026-10-28T10:00:00.000Z', 'SII_NO_DISPONIBLE');
    intento(store, 'rcv.VENTA', '2026-05', '2026-10-29T10:00:00.000Z', 'SII_LIMITE');
    intento(store, 'f22', 'AT2026', '2026-10-29T10:00:00.000Z', 'RESPUESTA_VACIA');
    intento(store, 'rcv.VENTA', '2026-05', '2026-10-29T10:00:00.000Z', 'SII_NO_DISPONIBLE', RUT_PERSONA);

    expect(store.pendientesDeReintento(RUT_EMPRESA, '2026-10-01T00:00:00.000Z')).toEqual([
      { superficie: 'rcv.VENTA', periodo: '2026-05', codigo: 'SII_LIMITE', intentos: 2 },
      { superficie: 'f22', periodo: 'AT2026', codigo: 'RESPUESTA_VACIA', intentos: 1 },
    ]);
  });

  it('no trae lo que ya salió bien, lo que el SII no resolvería esperando, lo viejo ni lo que ya falló 5 veces', () => {
    const store = new SqliteStore(abrirDb(':memory:'));
    intento(store, 'rcv.VENTA', '2026-06', '2026-10-28T10:00:00.000Z', 'SII_NO_DISPONIBLE');
    intento(store, 'rcv.VENTA', '2026-06', '2026-10-29T10:00:00.000Z');
    intento(store, 'rcv.COMPRA', '2026-06', '2026-10-29T10:00:00.000Z', 'PORTAL_CAMBIO');
    intento(store, 'f29', '2026-06', '2026-08-01T10:00:00.000Z', 'SII_NO_DISPONIBLE');
    for (let i = 0; i < 5; i++) intento(store, 'f29', '2026-07', `2026-10-2${i}T10:00:00.000Z`, 'SII_NO_DISPONIBLE');

    expect(store.pendientesDeReintento(RUT_EMPRESA, '2026-10-01T00:00:00.000Z')).toEqual([]);
  });
});
