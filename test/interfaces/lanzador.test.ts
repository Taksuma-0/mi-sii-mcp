import { afterEach, describe, expect, it, vi } from 'vitest';
import { abrirPagina, comandoNavegador } from '../../src/interfaces/web/lanzador.js';
import { crearServidorLocal } from '../../src/interfaces/web/servidor.js';

const cierres: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cerrar of cierres.splice(0)) await cerrar(); });

const estadoDe = async (url: string): Promise<unknown> => (await fetch(`${url}/estado`)).json();

describe('comando para abrir el navegador', () => {
  it.each([
    ['win32', 'powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', "Start-Process -FilePath 'http://127.0.0.1:47529'"]],
    ['darwin', 'open', ['http://127.0.0.1:47529']],
    ['linux', 'xdg-open', ['http://127.0.0.1:47529']],
  ] as const)('en %s usa %s', (plataforma, comando, args) => {
    expect(comandoNavegador(plataforma, 'http://127.0.0.1:47529')).toEqual({ comando, args });
  });

  it.each(['http://ejemplo.cl', 'https://127.0.0.1:47529', "http://127.0.0.1:47529';calc'", 'http://127.0.0.1:47529/estado'])('rechaza %s: solo abre la página local', (url) => {
    expect(() => comandoNavegador('win32', url)).toThrow('URL local inválida');
  });
});

describe('abrir la página local', () => {
  it('la levanta y la muestra en el navegador', async () => {
    const abiertas: string[] = [];
    const pagina = await abrirPagina({ puerto: 0, abrir: async (url) => { abiertas.push(url); } });
    if (pagina.servidor) cierres.push(pagina.servidor.cerrar);

    expect(pagina.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(pagina.enNavegador).toBe(true);
    expect(abiertas).toEqual([pagina.url]);
    expect(await estadoDe(pagina.url)).toMatchObject({ aplicacion: 'mi-sii-mcp-local-v1' });
  });

  it('si el navegador no se abre, la deja disponible para abrirla a mano', async () => {
    const pagina = await abrirPagina({ puerto: 0, abrir: async () => { throw new Error('sin navegador'); } });
    if (pagina.servidor) cierres.push(pagina.servidor.cerrar);

    expect(pagina.enNavegador).toBe(false);
    expect(pagina.servidor).not.toBeNull();
    expect(await estadoDe(pagina.url)).toMatchObject({ aplicacion: 'mi-sii-mcp-local-v1' });
  });

  it('reutiliza la página que ya estaba abierta en ese puerto', async () => {
    const existente = await crearServidorLocal({ puerto: 0 });
    cierres.push(existente.cerrar);
    const abrir = vi.fn(async (_url: string) => {});

    const pagina = await abrirPagina({ puerto: Number(new URL(existente.url).port), abrir });

    expect(pagina.servidor).toBeNull();
    expect(pagina.url).toBe(existente.url);
    expect(abrir).toHaveBeenCalledExactlyOnceWith(existente.url);
  });
});
