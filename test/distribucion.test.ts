import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = resolve(import.meta.dirname, '..');

interface ServidorMcp { command: string; args: string[]; startup_timeout_sec?: number; tool_timeout_sec?: number }
interface Manifiesto { name: string; version: string; icon?: string; mcpServers: Record<string, ServidorMcp> }
interface Marketplace { name: string; plugins: { name: string; source: string }[] }

const leer = <T>(ruta: string): T => JSON.parse(readFileSync(resolve(RAIZ, ruta), 'utf8')) as T;

// El plugin y la extensión lanzan con npx una versión exacta ya publicada en npm (el directorio de Anthropic rechaza `@latest`).
const versionLanzada = (m: Manifiesto): string | undefined =>
  m.mcpServers['mi-sii-mcp']?.args.find((a) => a.startsWith('mi-sii-mcp@'))?.slice('mi-sii-mcp@'.length);

describe('manifiestos de distribución (plugin de Claude Code y extensión de Gemini CLI)', () => {
  const plugin = leer<Manifiesto>('.claude-plugin/plugin.json');
  const marketplace = leer<Marketplace>('.claude-plugin/marketplace.json');
  const gemini = leer<Manifiesto>('gemini-extension.json');

  it('cada uno lanza con npx la misma versión que declara, y ambos la misma', () => {
    expect(versionLanzada(plugin)).toBe(plugin.version);
    expect(versionLanzada(gemini)).toBe(gemini.version);
    expect(gemini.version).toBe(plugin.version);
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
