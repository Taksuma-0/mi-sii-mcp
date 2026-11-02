import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { abrirDb } from '../../src/store/sqlite/db.js';
import { SqliteStore } from '../../src/store/sqlite/store.js';
import { RUT_EMPRESA } from '../helpers/fabricas.js';

const PDF = Buffer.from('%PDF-1.4 ficticio').toString('base64');

function sincronizacionCon(store: SqliteStore, superficie: string, periodo: string, en: string, respuestas: { superficie: string; parametros?: Record<string, unknown>; cuerpo: string }[]): void {
  const id = store.iniciarSincronizacion(RUT_EMPRESA, superficie, periodo, en);
  for (const r of respuestas) store.guardarRespuestaCruda(id, { superficie: r.superficie, parametros: r.parametros ?? {}, cuerpo: r.cuerpo, obtenidoEn: en });
  store.terminarSincronizacion(id, en, 'ok');
}

const crudas = (store: SqliteStore) => {
  const filas: string[] = [];
  store.cadaRespuestaCruda((superficie, cuerpo) => filas.push(`${superficie}:${cuerpo.slice(0, 12)}`));
  return filas;
};

describe('mantenimiento de la base', () => {
  it('la poda deja las respuestas de las 2 sincronizaciones más nuevas de cada superficie y período', () => {
    const store = new SqliteStore(abrirDb(':memory:'));
    for (const [i, en] of ['2026-10-01', '2026-10-02', '2026-10-03'].entries()) {
      sincronizacionCon(store, 'rcv.VENTA', '2026-09', `${en}T10:00:00.000Z`, [
        { superficie: 'rcv.resumen.VENTA.REGISTRO', cuerpo: `{"vuelta":${i}}` },
        { superficie: 'rcv.detalle.VENTA.REGISTRO.33', cuerpo: `{"vuelta":${i}}` },
      ]);
    }
    sincronizacionCon(store, 'rcv.VENTA', '2026-08', '2026-10-01T10:00:00.000Z', [{ superficie: 'rcv.resumen.VENTA.REGISTRO', cuerpo: '{"agosto":1}' }]);

    expect(store.podarRespuestasCrudas()).toBe(2);
    expect(crudas(store)).toEqual([
      'rcv.resumen.VENTA.REGISTRO:{"vuelta":1}',
      'rcv.detalle.VENTA.REGISTRO.33:{"vuelta":1}',
      'rcv.resumen.VENTA.REGISTRO:{"vuelta":2}',
      'rcv.detalle.VENTA.REGISTRO.33:{"vuelta":2}',
      'rcv.resumen.VENTA.REGISTRO:{"agosto":1}',
    ]);
  });

  it('siempre conserva el último PDF de cada folio del F29, aunque su sincronización sea vieja', () => {
    const store = new SqliteStore(abrirDb(':memory:'));
    sincronizacionCon(store, 'f29.valores', '2026-09', '2026-10-01T10:00:00.000Z', [{ superficie: 'f29.formCompacto', parametros: { periodo: '2026-09', folio: 1 }, cuerpo: PDF }]);
    sincronizacionCon(store, 'f29.valores', '2026-09', '2026-10-02T10:00:00.000Z', [{ superficie: 'f29.formCompacto', parametros: { periodo: '2026-09', folio: 2 }, cuerpo: PDF }]);
    sincronizacionCon(store, 'f29.valores', '2026-09', '2026-10-03T10:00:00.000Z', [{ superficie: 'f29.formCompacto', parametros: { periodo: '2026-09', folio: 2 }, cuerpo: PDF }]);

    expect(store.podarRespuestasCrudas()).toBe(0);
    expect(store.pdfsF29Guardados(RUT_EMPRESA).map((p) => p.folio)).toEqual([1, 2]);
  });

  it('revisa la integridad de la base y la respalda en un archivo legible', () => {
    const store = new SqliteStore(abrirDb(':memory:'));
    sincronizacionCon(store, 'rcv.VENTA', '2026-09', '2026-10-01T10:00:00.000Z', [{ superficie: 'rcv.resumen.VENTA.REGISTRO', cuerpo: '{}' }]);
    const destino = join(mkdtempSync(join(tmpdir(), 'mi-sii-mcp-respaldo-')), 'copia.db');

    expect(store.integridad()).toBe('ok');
    store.respaldarEn(destino);

    const copia = new Database(destino, { readonly: true });
    expect((copia.prepare('SELECT COUNT(*) AS n FROM respuesta_cruda').get() as { n: number }).n).toBe(1);
    copia.close();
  });
});
