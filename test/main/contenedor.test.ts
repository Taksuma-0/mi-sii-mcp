import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cargarConfig } from '../../src/main/config.js';
import { crearContenedor } from '../../src/main/contenedor.js';
import * as sqlite from '../../src/store/sqlite/db.js';
import { SecretosEnMemoria } from '../helpers/secretos.js';

describe('configuración y contenedor', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'impuestocl-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('cargarConfig usa IMPUESTOCL_HOME y valores numéricos seguros', () => {
    const c = cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_TOLERANCIA: '100', IMPUESTOCL_INTERVALO_MS: 'abc' });
    expect(c.home).toBe(home);
    expect(c.rutaDb).toBe(join(home, 'impuestocl.db'));
    expect(c.dirSesiones).toBe(join(home, 'sesiones'));
    expect(c.toleranciaPesos).toBe(100);
    expect(c.intervaloMinMs).toBe(1000);
  });

  it.each(['0', '1'])('cargarConfig exige al menos 1000 ms si IMPUESTOCL_INTERVALO_MS es %s', (intervalo) => {
    const c = cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_INTERVALO_MS: intervalo });
    expect(c.intervaloMinMs).toBeGreaterThanOrEqual(1000);
  });

  it('cargarConfig conserva intervalos mayores a 1000 ms', () => {
    const c = cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_INTERVALO_MS: '2500' });
    expect(c.intervaloMinMs).toBe(2500);
  });

  it('cargarConfig usa 60 s de plazo HTTP por defecto y respeta IMPUESTOCL_PLAZO_HTTP_MS', () => {
    expect(cargarConfig({ IMPUESTOCL_HOME: home }).plazoHttpMs).toBe(60_000);
    expect(cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_PLAZO_HTTP_MS: '90000' }).plazoHttpMs).toBe(90_000);
    expect(cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_PLAZO_HTTP_MS: 'abc' }).plazoHttpMs).toBe(60_000);
  });

  it('cargarConfig acota el plazo HTTP a lo que admite un temporizador (2^31-1 ms)', () => {
    expect(cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_PLAZO_HTTP_MS: '99999999999999' }).plazoHttpMs).toBe(2_147_483_647);
  });

  it.each(['0', '500', '9999'])('cargarConfig exige al menos 10000 ms de plazo HTTP si IMPUESTOCL_PLAZO_HTTP_MS es %s', (plazo) => {
    expect(cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_PLAZO_HTTP_MS: plazo }).plazoHttpMs).toBe(10_000);
  });

  it('crearContenedor arma la base, las sesiones y el diagnóstico sin tocar la red', () => {
    const c = crearContenedor({ config: cargarConfig({ IMPUESTOCL_HOME: home }), secretos: new SecretosEnMemoria() });
    try {
      expect(existsSync(join(home, 'impuestocl.db'))).toBe(true);
      expect(c.deps.store.contribuyentes()).toEqual([]);
      expect(c.sesiones.estado('22222222-2')).toEqual({ tieneSesion: false, guardadaEn: null, bloqueado: false });
      c.deps.diagnostico?.('prueba.json', '{"ok":true}');
      expect(readFileSync(join(home, 'diagnostico', 'prueba.json'), 'utf8')).toBe('{"ok":true}');
    } finally {
      c.cerrar();
    }
  });

  it('crearContenedor conecta las consultas libres a la base local', async () => {
    const c = crearContenedor({ config: cargarConfig({ IMPUESTOCL_HOME: home }), secretos: new SecretosEnMemoria() });
    try {
      const limites = { filas: 200, caracteres: 40_000, caracteresCelda: 1_000, milisegundos: 15_000 };
      const vacia = await c.deps.consultaLibre.consultar('SELECT COUNT(*) AS n FROM contribuyente', { limites, tiposNegativos: [60, 61, 112] });
      expect(vacia).toEqual({ columnas: ['n'], filas: [[0]], truncado: false });

      c.deps.store.guardarContribuyente({ rut: '22222222-2', alias: 'Demo', tipo: 'empresa', representa: [], razonSocial: null });
      const con = await c.deps.consultaLibre.consultar('SELECT rut FROM contribuyente', { limites, tiposNegativos: [60, 61, 112] });
      expect(con.filas).toEqual([['22222222-2']]);
    } finally {
      c.cerrar();
    }
  });

  it('crearContenedor cierra la base y conserva el error si no puede crear el directorio de sesiones', () => {
    const config = cargarConfig({ IMPUESTOCL_HOME: home });
    writeFileSync(config.dirSesiones, 'archivo que impide crear el directorio');
    const db = sqlite.abrirDb(config.rutaDb);
    const abrirDb = vi.spyOn(sqlite, 'abrirDb').mockReturnValue(db);
    try {
      expect(() => crearContenedor({ config, secretos: new SecretosEnMemoria() })).toThrowError(
        expect.objectContaining({ code: 'EEXIST', path: config.dirSesiones }),
      );
      expect(db.open).toBe(false);
    } finally {
      abrirDb.mockRestore();
      if (db.open) db.close();
    }
  });
});
