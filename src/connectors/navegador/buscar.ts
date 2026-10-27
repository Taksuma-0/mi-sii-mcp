import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorMiSiiMcp } from '../../domain/errores.js';

/** Ejecutables relativos a cada carpeta de programas, en orden de preferencia: Edge viene con Windows. */
const EJECUTABLES: readonly (readonly string[])[] = [
  ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
];
/** Carpetas estándar de Windows donde se instalan (Chrome puede instalarse solo para el usuario, en LocalAppData). */
const CARPETAS = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'] as const;

/**
 * Ruta de Microsoft Edge o Google Chrome. `MI_SII_MCP_NAVEGADOR` fuerza una ruta; si no existe es un error (no se busca
 * otro navegador a escondidas).
 */
export function buscarNavegador(
  env: Readonly<Record<string, string | undefined>> = process.env,
  existe: (ruta: string) => boolean = existsSync,
): string {
  const forzado = env['MI_SII_MCP_NAVEGADOR']?.trim();
  if (forzado) {
    if (existe(forzado)) return forzado;
    throw new ErrorMiSiiMcp('NAVEGADOR_NO_DISPONIBLE', `La ruta indicada en MI_SII_MCP_NAVEGADOR no existe: ${forzado}.`, {
      accion: 'Corrige la ruta de MI_SII_MCP_NAVEGADOR (por ejemplo, la de msedge.exe o chrome.exe) o quítala para buscar Edge o Chrome.',
    });
  }
  for (const partes of EJECUTABLES) {
    for (const carpeta of CARPETAS) {
      const base = env[carpeta]?.trim();
      if (!base) continue;
      const ruta = join(base, ...partes);
      if (existe(ruta)) return ruta;
    }
  }
  throw new ErrorMiSiiMcp('NAVEGADOR_NO_DISPONIBLE', 'No se encontró Microsoft Edge ni Google Chrome en las carpetas estándar de Windows.');
}
