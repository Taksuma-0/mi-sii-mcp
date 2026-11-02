import { existsSync, readFileSync } from 'node:fs';
import { ES_VERSION } from '../../domain/version.js';
import type { FuenteVersiones } from '../../ports/index.js';
import { escribirAtomico } from './escritura.js';

/** La única consulta que hace mi-sii-mcp fuera del SII: qué versión es la última publicada (decisión 0010). */
export const URL_VERSION_NPM = 'https://registry.npmjs.org/mi-sii-mcp/latest';
const UN_DIA_MS = 86_400_000;

interface Cache {
  readonly version: string;
  readonly consultadoEn: string;
}

export interface OpcionesVersionNpm {
  readonly fetch?: typeof fetch;
  readonly ahoraMs?: () => number;
  readonly plazoMs?: number;
}

/**
 * Última versión publicada de mi-sii-mcp en npm, consultada a lo más una vez al día y guardada en `cache`. No envía
 * datos de nadie: solo pide la ficha pública del paquete. Ante cualquier falla devuelve lo guardado (o null) sin lanzar.
 */
export class VersionNpm implements FuenteVersiones {
  private readonly fetchFn: typeof fetch;
  private readonly ahoraMs: () => number;
  private readonly plazoMs: number;

  constructor(
    private readonly cache: string,
    opciones: OpcionesVersionNpm = {},
  ) {
    this.fetchFn = opciones.fetch ?? globalThis.fetch;
    this.ahoraMs = opciones.ahoraMs ?? Date.now;
    this.plazoMs = opciones.plazoMs ?? 3_000;
  }

  conocida(): string | null {
    return this.leer()?.version ?? null;
  }

  async ultima(): Promise<string | null> {
    const guardada = this.leer();
    if (guardada && this.ahoraMs() - Date.parse(guardada.consultadoEn) < UN_DIA_MS) return guardada.version;
    try {
      const r = await Promise.race([
        this.fetchFn(URL_VERSION_NPM, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(this.plazoMs) }),
        new Promise<never>((_, rechazar) => setTimeout(() => rechazar(new Error('plazo vencido')), this.plazoMs).unref()),
      ]);
      if (!r.ok) return guardada?.version ?? null;
      const version = ((await r.json()) as { version?: unknown }).version;
      if (typeof version !== 'string' || !ES_VERSION.test(version)) return guardada?.version ?? null;
      escribirAtomico(this.cache, JSON.stringify({ version, consultadoEn: new Date(this.ahoraMs()).toISOString() } satisfies Cache));
      return version;
    } catch {
      return guardada?.version ?? null;
    }
  }

  private leer(): Cache | null {
    if (!existsSync(this.cache)) return null;
    try {
      const c = JSON.parse(readFileSync(this.cache, 'utf8')) as Partial<Cache>;
      return typeof c.version === 'string' && ES_VERSION.test(c.version) && typeof c.consultadoEn === 'string' ? { version: c.version, consultadoEn: c.consultadoEn } : null;
    } catch {
      return null;
    }
  }
}
