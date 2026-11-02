import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RespaldosLocales } from '../../src/main/respaldos.js';

function preparar() {
  const dir = join(mkdtempSync(join(tmpdir(), 'mi-sii-mcp-')), 'respaldos');
  const copias: string[] = [];
  // Como VACUUM INTO: la copia aparece en el destino.
  const respaldos = new RespaldosLocales(dir, {
    respaldarEn: (ruta) => {
      copias.push(ruta);
      writeFileSync(ruta, 'copia');
    },
  });
  return { dir, copias, respaldos };
}

describe('respaldos diarios de la base', () => {
  it('crea un respaldo por día con la fecha de Chile, y no lo repite el mismo día', async () => {
    const { dir, copias, respaldos } = preparar();

    const primero = await respaldos.crear(new Date('2026-11-02T02:30:00.000Z'));
    const segundo = await respaldos.crear(new Date('2026-11-02T02:50:00.000Z'));

    expect(primero).toEqual({ ruta: join(dir, 'mi-sii-mcp-2026-11-01.db'), creado: true, borrados: 0 });
    expect(segundo).toEqual({ ruta: join(dir, 'mi-sii-mcp-2026-11-01.db'), creado: false, borrados: 0 });
    expect(copias).toEqual([join(dir, 'mi-sii-mcp-2026-11-01.db')]);
  });

  it('conserva solo los 3 más nuevos y sabe cuál es el último', async () => {
    const { dir, respaldos } = preparar();

    for (const dia of ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']) await respaldos.crear(new Date(`${dia}T15:00:00.000Z`));

    expect(readdirSync(dir).sort()).toEqual(['mi-sii-mcp-2026-10-29.db', 'mi-sii-mcp-2026-10-30.db', 'mi-sii-mcp-2026-10-31.db']);
    expect(respaldos.ultimo()).toBe(join(dir, 'mi-sii-mcp-2026-10-31.db'));
    expect(existsSync(join(dir, 'mi-sii-mcp-2026-10-28.db'))).toBe(false);
  });

  it('sin respaldos, el último es null', () => {
    expect(preparar().respaldos.ultimo()).toBeNull();
  });
});
