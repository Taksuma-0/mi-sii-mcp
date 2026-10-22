import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cargarConfig } from '../../src/main/config.js';
import { crearContenedor } from '../../src/main/contenedor.js';
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
});
