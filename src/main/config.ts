import { homedir } from 'node:os';
import { join } from 'node:path';
import { PLAZO_LOGIN_NAVEGADOR_MS, PLAZO_MAXIMO_LOGIN_NAVEGADOR_MS } from '../connectors/navegador/sesion-navegador.js';
import { PLAZO_MAXIMO_MS } from '../connectors/sii/http.js';

export interface Config {
  readonly home: string;
  readonly rutaDb: string;
  readonly dirSesiones: string;
  readonly dirDiagnostico: string;
  readonly toleranciaPesos: number;
  readonly intervaloMinMs: number;
  /** Plazo de cada consulta HTTP al SII. */
  readonly plazoHttpMs: number;
  /** Plazo para entrar en el navegador con `login-navegador` (por defecto 10 minutos, entre 1 y 30). */
  readonly plazoNavegadorMs: number;
  /** Carpeta de datos con el nombre anterior (`~/.impuestocl`), solo si no se eligió una con MI_SII_MCP_HOME: se muda al abrir. */
  readonly homeAnterior?: string;
}

/** Rutas de la base, sesiones y diagnóstico dentro de una carpeta de datos. */
export const rutasDe = (home: string): Pick<Config, 'home' | 'rutaDb' | 'dirSesiones' | 'dirDiagnostico'> => ({
  home,
  rutaDb: join(home, 'mi-sii-mcp.db'),
  dirSesiones: join(home, 'sesiones'),
  dirDiagnostico: join(home, 'diagnostico'),
});

const numeroNoNegativo = (valor: string | undefined, porDefecto: number): number => {
  if (valor === undefined || valor.trim() === '') return porDefecto;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : porDefecto;
};

export function cargarConfig(env: Readonly<Record<string, string | undefined>> = process.env): Config {
  const elegida = env['MI_SII_MCP_HOME'];
  return {
    ...rutasDe(elegida ?? join(homedir(), '.mi-sii-mcp')),
    ...(elegida === undefined ? { homeAnterior: join(homedir(), '.impuestocl') } : {}),
    toleranciaPesos: numeroNoNegativo(env['MI_SII_MCP_TOLERANCIA'], 0),
    intervaloMinMs: Math.max(1000, numeroNoNegativo(env['MI_SII_MCP_INTERVALO_MS'], 1000)),
    plazoHttpMs: Math.min(PLAZO_MAXIMO_MS, Math.max(10_000, numeroNoNegativo(env['MI_SII_MCP_PLAZO_HTTP_MS'], 60_000))),
    plazoNavegadorMs: Math.min(PLAZO_MAXIMO_LOGIN_NAVEGADOR_MS, Math.max(60_000, numeroNoNegativo(env['MI_SII_MCP_PLAZO_NAVEGADOR_MS'], PLAZO_LOGIN_NAVEGADOR_MS))),
  };
}
