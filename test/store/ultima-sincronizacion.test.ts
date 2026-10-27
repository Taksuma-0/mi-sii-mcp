import { describe, expect, it } from 'vitest';
import { abrirDb } from '../../src/store/sqlite/db.js';
import { SqliteStore } from '../../src/store/sqlite/store.js';
import { RUT_EMPRESA } from '../helpers/fabricas.js';

const T = '2026-10-21T10:00:00.000Z';

describe('SqliteStore.ultimaSincronizacion', () => {
  it('devuelve el estado y el código del intento más reciente de la superficie y el mes, o null si no hubo', () => {
    const store = new SqliteStore(abrirDb(':memory:'));
    expect(store.ultimaSincronizacion(RUT_EMPRESA, 'bhe.recibidas', '2026-09')).toBeNull();

    const ok = store.iniciarSincronizacion(RUT_EMPRESA, 'bhe.recibidas', '2026-09', T);
    store.terminarSincronizacion(ok, T, 'ok');
    const error = store.iniciarSincronizacion(RUT_EMPRESA, 'bhe.recibidas', '2026-09', T);
    store.terminarSincronizacion(error, T, 'error', { codigo: 'RESPUESTA_VACIA', detalle: 'x' });
    const otroMes = store.iniciarSincronizacion(RUT_EMPRESA, 'bhe.recibidas', '2026-10', T);
    store.terminarSincronizacion(otroMes, T, 'ok');
    store.iniciarSincronizacion(RUT_EMPRESA, 'f29', '2026-09', T);

    expect(store.ultimaSincronizacion(RUT_EMPRESA, 'bhe.recibidas', '2026-09')).toEqual({ estado: 'error', errorCodigo: 'RESPUESTA_VACIA' });
    expect(store.ultimaSincronizacion(RUT_EMPRESA, 'bhe.recibidas', '2026-10')).toEqual({ estado: 'ok', errorCodigo: null });
    expect(store.ultimaSincronizacion(RUT_EMPRESA, 'f29', '2026-09')).toEqual({ estado: 'en_curso', errorCodigo: null });
  });
});
