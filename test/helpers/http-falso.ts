import type { Temporizador } from '../../src/connectors/sii/http.js';

export interface LlamadaFalsa {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  readonly signal: AbortSignal | undefined;
}

export interface DefRespuesta {
  readonly status?: number;
  readonly body?: string | Uint8Array;
  readonly headers?: readonly (readonly [string, string])[];
  /** Nunca responde: la promesa solo termina, con el motivo de la señal, cuando la señal se aborta. */
  readonly colgada?: boolean;
}

export type RutaFalsa = DefRespuesta | ((llamada: LlamadaFalsa, n: number) => DefRespuesta);

export function crearFetchFalso(rutas: Record<string, RutaFalsa>) {
  const llamadas: LlamadaFalsa[] = [];
  const conteo = new Map<string, number>();
  const fetchFalso = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    const llamada: LlamadaFalsa = {
      method: init?.method ?? 'GET',
      url,
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal: init?.signal ?? undefined,
    };
    llamadas.push(llamada);
    if (llamada.signal?.aborted) throw llamada.signal.reason;
    const clave = `${llamada.method} ${url.split('?')[0]}`;
    const ruta = rutas[clave];
    if (ruta === undefined) throw new Error(`fetch falso: ruta no definida "${clave}"`);
    const n = (conteo.get(clave) ?? 0) + 1;
    conteo.set(clave, n);
    const def = typeof ruta === 'function' ? ruta(llamada, n) : ruta;
    if (def.colgada) await colgar(llamada.signal, clave);
    const cuerpo = typeof def.body === 'string' ? new TextEncoder().encode(def.body) : (def.body ?? new Uint8Array());
    const headers = new Headers();
    for (const [k, v] of def.headers ?? []) headers.append(k, v);
    return {
      status: def.status ?? 200,
      headers,
      arrayBuffer: async () => cuerpo.slice().buffer,
    } as unknown as Response;
  }) as typeof fetch;
  return { fetchFalso, llamadas };
}

/** Como fetch ante una señal: rechaza con su motivo cuando se aborta. Sin señal fallaría la prueba en vez de colgarla. */
function colgar(signal: AbortSignal | undefined, clave: string): Promise<never> {
  if (!signal) return Promise.reject(new Error(`fetch falso: ruta colgada "${clave}" sin señal`));
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

export function temporizadorFalso(): { esperas: number[]; temporizador: Temporizador } {
  let ms = 0;
  const esperas: number[] = [];
  return {
    esperas,
    temporizador: {
      dormir: async (x: number) => {
        esperas.push(x);
        ms += x;
      },
      ahoraMs: () => ms,
    },
  };
}

export const sinEsperas: Temporizador = { dormir: async () => {}, ahoraMs: () => 0 };

export const HTML: readonly (readonly [string, string])[] = [['content-type', 'text/html; charset=utf-8']];
export const JSON_CT: readonly (readonly [string, string])[] = [['content-type', 'application/json;charset=UTF-8']];
