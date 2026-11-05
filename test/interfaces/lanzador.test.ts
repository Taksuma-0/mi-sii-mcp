import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { abrirPagina, comandoArchivo, comandoNavegador } from '../../src/interfaces/web/lanzador.js';
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

describe('comando para abrir un informe', () => {
  const carpeta = join(tmpdir(), 'mi-sii-mcp', 'informes');
  const ruta = join(carpeta, 'iva-11111111-1-2026-09.html');

  it('en win32 lo abre con PowerShell y le pasa la ruta por el entorno, nunca dentro del comando', () => {
    expect(comandoArchivo('win32', ruta, carpeta)).toEqual({
      comando: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', 'Invoke-Item -LiteralPath $env:MI_SII_MCP_INFORME'],
      entorno: { MI_SII_MCP_INFORME: ruta },
    });
  });

  it.each([
    ['darwin', 'open'],
    ['linux', 'xdg-open'],
  ] as const)('en %s usa %s con la ruta como argumento aparte', (plataforma, comando) => {
    expect(comandoArchivo(plataforma, ruta, carpeta)).toEqual({ comando, args: [ruta] });
  });

  // Windows admite estos caracteres en el nombre de usuario, y la carpeta de datos vive dentro del perfil.
  it.each(["D'Arcy", 'Ana (casa)', 'Pérez & Cía', 'Rojas, Juan', 'caja $x; calc'])('lo abre aunque la carpeta de la persona se llame «%s»', (usuario) => {
    const propia = join(tmpdir(), usuario, '.mi-sii-mcp', 'informes');
    const informe = join(propia, 'iva-11111111-1-2026-09.html');
    const { args, entorno } = comandoArchivo('win32', informe, propia);
    expect(entorno).toEqual({ MI_SII_MCP_INFORME: informe });
    expect(args.some((a) => a.includes(usuario))).toBe(false);
  });

  it.each([
    ['fuera de la carpeta', join(tmpdir(), 'otra', 'x.html')],
    ['con ..', `${carpeta}${sep}..${sep}informes${sep}x.html`],
    ['que no es .html', join(carpeta, 'x.exe')],
    ['con .html en medio', join(carpeta, 'x.html.exe')],
    ['con un salto de línea', join(carpeta, 'x\n.html')],
    ['la carpeta misma', carpeta],
  ])('rechaza una ruta %s', (_, otra) => {
    expect(() => comandoArchivo('win32', otra, carpeta)).toThrow('Ruta de informe inválida');
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
