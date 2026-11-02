import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HERRAMIENTAS } from '../src/interfaces/mcp/servidor.js';

const RAIZ = resolve(import.meta.dirname, '..');

interface ServidorMcp { command: string; args: string[]; startup_timeout_sec?: number; tool_timeout_sec?: number }
interface Manifiesto { name: string; version: string; icon?: string; mcpServers: Record<string, ServidorMcp> }
interface Marketplace { name: string; plugins: { name: string; source: string }[] }

const leer = <T>(ruta: string): T => JSON.parse(readFileSync(resolve(RAIZ, ruta), 'utf8')) as T;

// El plugin y la extensión lanzan con npx una versión exacta ya publicada en npm (el directorio de Anthropic rechaza `@latest`).
const versionLanzada = (m: Manifiesto): string | undefined =>
  m.mcpServers['mi-sii-mcp']?.args.find((a) => a.startsWith('mi-sii-mcp@'))?.slice('mi-sii-mcp@'.length);

describe('manifiestos de distribución (plugin de Claude Code, extensión de Gemini CLI y mcp.json)', () => {
  const plugin = leer<Manifiesto>('.claude-plugin/plugin.json');
  const marketplace = leer<Marketplace>('.claude-plugin/marketplace.json');
  const gemini = leer<Manifiesto>('gemini-extension.json');
  // cursor.directory detecta el servidor en el mcp.json de la raíz y copia esa configuración a quien lo instala.
  const mcpRaiz = leer<Pick<Manifiesto, 'mcpServers'>>('mcp.json');

  it('cada uno lanza con npx la misma versión que declara, y todos la misma', () => {
    expect(versionLanzada(plugin)).toBe(plugin.version);
    expect(versionLanzada(gemini)).toBe(gemini.version);
    expect(gemini.version).toBe(plugin.version);
    expect(versionLanzada({ ...plugin, mcpServers: mcpRaiz.mcpServers })).toBe(plugin.version);
  });

  // Una versión sale de una vez (scripts/fijar-version.mjs y un tag): ninguna pieza puede quedar con la anterior.
  it('el servidor, el plugin, la extensión, mcp.json y el sitio declaran la versión de package.json', () => {
    const paquete = leer<{ version: string }>('package.json').version;
    const registro = leer<{ version: string; packages: { version: string }[] }>('server.json');
    const sitio = /"softwareVersion": "([^"]+)"/.exec(readFileSync(resolve(RAIZ, 'docs', 'index.html'), 'utf8'))?.[1];
    expect({
      registro: registro.version,
      paqueteDelRegistro: registro.packages[0]?.version,
      plugin: plugin.version,
      extension: gemini.version,
      mcpRaiz: versionLanzada({ ...plugin, mcpServers: mcpRaiz.mcpServers }),
      sitio,
    }).toEqual({ registro: paquete, paqueteDelRegistro: paquete, plugin: paquete, extension: paquete, mcpRaiz: paquete, sitio: paquete });
  });

  it('la versión es exacta, no un rango ni latest', () => {
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('el marketplace publica el plugin de la raíz con el mismo nombre', () => {
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: plugin.name, source: './' })]);
    expect(gemini.name).toBe(plugin.name);
  });

  // Codex instala este mismo plugin y por defecto espera 10 s el arranque (npx descarga el paquete la primera vez)
  // y 60 s cada herramienta (sincronizar 12 meses con el SII tarda más). Claude Code ignora estos campos.
  it('el plugin amplía los plazos de Codex para arrancar y para cada herramienta', () => {
    const servidor = plugin.mcpServers['mi-sii-mcp'];
    expect(servidor?.startup_timeout_sec).toBeGreaterThanOrEqual(60);
    expect(servidor?.tool_timeout_sec).toBeGreaterThanOrEqual(600);
  });

  it('el plugin trae la skill y su ícono', () => {
    expect(existsSync(resolve(RAIZ, 'skills', 'mi-sii-mcp', 'SKILL.md'))).toBe(true);
    expect(plugin.icon && existsSync(resolve(RAIZ, plugin.icon))).toBe(true);
  });
});

describe('servidor simulado de las evals', () => {
  const CARPETA = resolve(RAIZ, 'evals', 'mocks', 'mi-sii-mcp');

  it('_tools.json trae exactamente las herramientas del servidor, para que las simulaciones no queden desfasadas', () => {
    const guardado = leer<{ tools: { name: string; inputSchema: unknown }[] }>('evals/mocks/mi-sii-mcp/_tools.json');
    expect(guardado.tools.map((t) => t.name).sort()).toEqual([...HERRAMIENTAS].sort());
    expect(guardado.tools.every((t) => typeof t.inputSchema === 'object')).toBe(true);
  });

  it('cada simulación responde una herramienta que existe y solo usa RUT ficticios', () => {
    const simulaciones = readdirSync(CARPETA).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
    expect(simulaciones.length).toBeGreaterThanOrEqual(10);
    for (const archivo of simulaciones) {
      expect(HERRAMIENTAS as readonly string[], archivo).toContain(archivo.slice(0, -'.md'.length));
      const ruts = readFileSync(resolve(CARPETA, archivo), 'utf8').match(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g) ?? [];
      for (const rut of ruts) expect(['11111111-1', '22222222-2', '33333333-3'], `${archivo}: ${rut}`).toContain(rut.replace(/\./g, ''));
    }
  });
});
