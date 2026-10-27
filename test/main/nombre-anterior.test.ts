import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rutasDe, type Config } from '../../src/main/config.js';
import { conNombreAnterior, type SistemaArchivos } from '../../src/main/nombre-anterior.js';

const NUEVO = join('C:', 'u', '.mi-sii-mcp');
const ANTERIOR = join('C:', 'u', '.impuestocl');
const config = (homeAnterior?: string): Config => ({
  ...rutasDe(NUEVO),
  toleranciaPesos: 0,
  intervaloMinMs: 1000,
  plazoHttpMs: 60_000,
  plazoNavegadorMs: 600_000,
  ...(homeAnterior ? { homeAnterior } : {}),
});

/** Archivos en memoria; `bloqueadas` simula lo que otro proceso tiene abierto. */
function fsFalso(rutas: string[], bloqueadas: string[] = []) {
  const hay = new Set(rutas);
  const movidos: [string, string][] = [];
  const fs: SistemaArchivos = {
    existe: (r) => hay.has(r),
    renombrar: (desde, hacia) => {
      if (bloqueadas.includes(desde)) throw new Error('EBUSY');
      for (const r of [...hay]) if (r === desde || r.startsWith(desde + sep)) { hay.delete(r); hay.add(hacia + r.slice(desde.length)); }
      movidos.push([desde, hacia]);
    },
  };
  return { fs, movidos, hay };
}

describe('mudanza desde el nombre anterior (impuestocl)', () => {
  it('mueve la carpeta ~/.impuestocl y la base impuestocl.db a los nombres nuevos', () => {
    const { fs, movidos } = fsFalso([ANTERIOR, join(ANTERIOR, 'impuestocl.db')]);
    const c = conNombreAnterior(config(ANTERIOR), fs);
    expect(movidos).toEqual([[ANTERIOR, NUEVO], [join(NUEVO, 'impuestocl.db'), join(NUEVO, 'mi-sii-mcp.db')]]);
    expect(c.home).toBe(NUEVO);
    expect(c.rutaDb).toBe(join(NUEVO, 'mi-sii-mcp.db'));
  });

  it('si la carpeta no se puede mover, sigue usando la anterior sin perder datos', () => {
    const { fs, movidos } = fsFalso([ANTERIOR, join(ANTERIOR, 'impuestocl.db')], [ANTERIOR]);
    const c = conNombreAnterior(config(ANTERIOR), fs);
    expect(movidos).toEqual([[join(ANTERIOR, 'impuestocl.db'), join(ANTERIOR, 'mi-sii-mcp.db')]]);
    expect(c.home).toBe(ANTERIOR);
    expect(c.dirSesiones).toBe(join(ANTERIOR, 'sesiones'));
    expect(c.rutaDb).toBe(join(ANTERIOR, 'mi-sii-mcp.db'));
  });

  it('una base abierta (con -wal o -shm) o bloqueada no se mueve: se usa con su nombre anterior', () => {
    for (const extra of [[join(NUEVO, 'impuestocl.db-wal')], [join(NUEVO, 'impuestocl.db-shm')]]) {
      const { fs, movidos } = fsFalso([NUEVO, join(NUEVO, 'impuestocl.db'), ...extra]);
      const c = conNombreAnterior(config(ANTERIOR), fs);
      expect(movidos).toEqual([]);
      expect(c.rutaDb).toBe(join(NUEVO, 'impuestocl.db'));
    }
    const { fs } = fsFalso([NUEVO, join(NUEVO, 'impuestocl.db')], [join(NUEVO, 'impuestocl.db')]);
    expect(conNombreAnterior(config(ANTERIOR), fs).rutaDb).toBe(join(NUEVO, 'impuestocl.db'));
  });

  it('no toca nada si ya existe la carpeta nueva o si se eligió otra con MI_SII_MCP_HOME', () => {
    const conAmbas = fsFalso([NUEVO, ANTERIOR, join(NUEVO, 'mi-sii-mcp.db'), join(ANTERIOR, 'impuestocl.db')]);
    expect(conNombreAnterior(config(ANTERIOR), conAmbas.fs)).toEqual(config(ANTERIOR));
    expect(conAmbas.movidos).toEqual([]);
    const elegida = fsFalso([ANTERIOR, join(ANTERIOR, 'impuestocl.db')]);
    expect(conNombreAnterior(config(), elegida.fs)).toEqual(config());
    expect(elegida.movidos).toEqual([]);
  });
});
