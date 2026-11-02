import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { URL_VERSION_NPM, VersionNpm } from '../../src/connectors/sistema/version-npm.js';

function preparar(respuesta: () => Promise<Response>, ahora = { ms: Date.parse('2026-11-02T03:00:00.000Z') }) {
  const cache = join(mkdtempSync(join(tmpdir(), 'mi-sii-mcp-version-')), 'version-npm.json');
  const pedidos: string[] = [];
  const fuente = new VersionNpm(cache, {
    fetch: (async (url: string | URL) => {
      pedidos.push(String(url));
      return respuesta();
    }) as typeof fetch,
    ahoraMs: () => ahora.ms,
    plazoMs: 50,
  });
  return { cache, pedidos, fuente, ahora };
}

const json = (v: unknown) => async () => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });

describe('versión publicada en npm', () => {
  it('consulta la última versión de npm, la guarda y la reutiliza durante un día', async () => {
    const { cache, pedidos, fuente, ahora } = preparar(json({ name: 'mi-sii-mcp', version: '0.3.1' }));

    expect(await fuente.ultima()).toBe('0.3.1');
    ahora.ms += 23 * 3_600_000;
    expect(await fuente.ultima()).toBe('0.3.1');
    expect(pedidos).toEqual([URL_VERSION_NPM]);
    expect(JSON.parse(readFileSync(cache, 'utf8'))).toMatchObject({ version: '0.3.1' });
    ahora.ms += 2 * 3_600_000;
    await fuente.ultima();
    expect(pedidos).toHaveLength(2);
  });

  it('sin red usa la última versión guardada; sin nada guardado devuelve null', async () => {
    const sinRed = async (): Promise<Response> => {
      throw new Error('sin conexión');
    };
    const vacio = preparar(sinRed);
    expect(await vacio.fuente.ultima()).toBeNull();
    expect(existsSync(vacio.cache)).toBe(false);

    const conCache = preparar(sinRed);
    writeFileSync(conCache.cache, JSON.stringify({ version: '0.3.0', consultadoEn: '2026-10-01T00:00:00.000Z' }));
    expect(await conCache.fuente.ultima()).toBe('0.3.0');
  });

  it('no espera más del plazo ni acepta respuestas raras', async () => {
    const colgada = preparar(() => new Promise<Response>(() => {}));
    expect(await colgada.fuente.ultima()).toBeNull();

    const rara = preparar(json({ version: '<script>' }));
    expect(await rara.fuente.ultima()).toBeNull();
  });

  it('conocida() lee lo guardado sin ir a la red', () => {
    const { cache, pedidos, fuente } = preparar(json({ version: '9.9.9' }));
    writeFileSync(cache, JSON.stringify({ version: '0.3.2', consultadoEn: '2026-11-01T00:00:00.000Z' }));

    expect(fuente.conocida()).toBe('0.3.2');
    expect(pedidos).toEqual([]);
  });
});
