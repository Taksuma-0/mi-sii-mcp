import { homedir } from 'node:os';
import { join } from 'node:path';
import { PLAZO_LOGIN_NAVEGADOR_MS } from '../connectors/navegador/sesion-navegador.js';
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
  /** Plazo para entrar en el navegador con `login-navegador` (por defecto 10 minutos, mínimo 1). */
  readonly plazoNavegadorMs: number;
}

const numeroNoNegativo = (valor: string | undefined, porDefecto: number): number => {
  if (valor === undefined || valor.trim() === '') return porDefecto;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : porDefecto;
};

export function cargarConfig(env: Readonly<Record<string, string | undefined>> = process.env): Config {
  const home = env['IMPUESTOCL_HOME'] ?? join(homedir(), '.impuestocl');
  return {
    home,
    rutaDb: join(home, 'impuestocl.db'),
    dirSesiones: join(home, 'sesiones'),
    dirDiagnostico: join(home, 'diagnostico'),
    toleranciaPesos: numeroNoNegativo(env['IMPUESTOCL_TOLERANCIA'], 0),
    intervaloMinMs: Math.max(1000, numeroNoNegativo(env['IMPUESTOCL_INTERVALO_MS'], 1000)),
    plazoHttpMs: Math.min(PLAZO_MAXIMO_MS, Math.max(10_000, numeroNoNegativo(env['IMPUESTOCL_PLAZO_HTTP_MS'], 60_000))),
    plazoNavegadorMs: Math.min(PLAZO_MAXIMO_MS, Math.max(60_000, numeroNoNegativo(env['IMPUESTOCL_PLAZO_NAVEGADOR_MS'], PLAZO_LOGIN_NAVEGADOR_MS))),
  };
}
