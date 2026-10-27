import { CookieJar } from 'tough-cookie';
import { ErrorImpuestocl } from '../../domain/errores.js';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
export const HOST_LOGIN = 'zeusr.sii.cl';
const HOST_SALA_ESPERA = 'salaespera.sii.cl';

export interface Temporizador {
  dormir(ms: number): Promise<void>;
  ahoraMs(): number;
}

export const temporizadorReal: Temporizador = {
  dormir: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ahoraMs: () => Date.now(),
};

export interface OpcionesHttp {
  readonly fetch?: typeof fetch;
  readonly temporizador?: Temporizador;
  /** Separación mínima entre requests (por defecto 1000 ms). */
  readonly intervaloMinMs?: number;
  /** Reintentos ante 5xx o error de red (por defecto 2). */
  readonly reintentos?: number;
  /** Plazo de cada fetch (por defecto 60000 ms); vencido cuenta como error de red. */
  readonly plazoMs?: number;
}

export interface SolicitudHttp {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: string;
  /** false para el login: nunca se reintenta. */
  readonly reintentar?: boolean;
  /** false para el login: una redirección no puede volver a enviar su POST. */
  readonly reenviarPostEnRedireccion?: boolean;
  /** Cancelación de quien pidió la consulta: corta el fetch en curso y nunca se reintenta. */
  readonly signal?: AbortSignal;
}

export interface RespuestaHttp {
  readonly status: number;
  /** URL final, después de seguir redirecciones. */
  readonly url: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly texto: string;
}

/** Lo que usan los conectores de una sesión: consultar y leer sus cookies. */
export interface Http {
  solicitar(url: string, solicitud?: SolicitudHttp): Promise<RespuestaHttp>;
  cookie(url: string, nombre: string): Promise<string | null>;
}

/** Agrega `signal` a cada consulta de `http`, junto a la señal propia de la consulta si la trae. */
export function conSenal(http: Http, signal: AbortSignal | undefined): Http {
  if (!signal) return http;
  return {
    solicitar: (url, solicitud = {}) =>
      http.solicitar(url, { ...solicitud, signal: solicitud.signal ? AbortSignal.any([solicitud.signal, signal]) : signal }),
    cookie: (url, nombre) => http.cookie(url, nombre),
  };
}

/** El mayor plazo que admite un temporizador (2^31-1 ms); `AbortSignal.timeout` lanza RangeError sobre 2^32-1. */
export const PLAZO_MAXIMO_MS = 2_147_483_647;

/** Bytes que se revisan buscando un `<meta>` con charset cuando el encabezado no lo trae. */
const BYTES_BUSQUEDA_META = 2048;

/**
 * `<meta charset="…">` o `<meta http-equiv="Content-Type" content="…; charset=…">`. Un `utf-16*` declarado en un meta
 * es imposible (el propio meta se leyó como ASCII) y los navegadores lo tratan como UTF-8.
 */
function charsetDeMeta(bytes: Uint8Array): string | undefined {
  const inicio = new TextDecoder('latin1').decode(bytes.subarray(0, BYTES_BUSQUEDA_META));
  const charset = /<meta\b[^>]*?charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(inicio)?.[1];
  return charset && /^utf-?16/i.test(charset) ? 'utf-8' : charset;
}

/** Un `<meta>` solo vale en HTML (o sin content-type): no en JSON, PDF ni otros cuerpos. */
const admiteMeta = (contentType: string | null): boolean => !contentType?.trim() || /html/i.test(contentType);

export function decodificar(bytes: Uint8Array, contentType: string | null): string {
  const delEncabezado = /charset=([^;]+)/i.exec(contentType ?? '')?.[1]?.trim().replace(/["']/g, '');
  const delMeta = delEncabezado || !admiteMeta(contentType) ? undefined : charsetDeMeta(bytes);
  const charset = (delEncabezado || delMeta || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const esPlazoVencido = (e: unknown): boolean => e instanceof DOMException && e.name === 'TimeoutError';

export class ClienteHttp implements Http {
  private ultimoMs = Number.NEGATIVE_INFINITY;
  private colaTurnos: Promise<void> = Promise.resolve();
  private readonly fetchFn: typeof fetch;
  private readonly temporizador: Temporizador;
  private readonly intervaloMinMs: number;
  private readonly reintentos: number;
  private readonly plazoMs: number;

  constructor(
    readonly jar: CookieJar = new CookieJar(),
    opciones: OpcionesHttp = {},
  ) {
    this.fetchFn = opciones.fetch ?? globalThis.fetch;
    this.temporizador = opciones.temporizador ?? temporizadorReal;
    this.intervaloMinMs = opciones.intervaloMinMs ?? 1000;
    this.reintentos = opciones.reintentos ?? 2;
    this.plazoMs = Math.min(PLAZO_MAXIMO_MS, opciones.plazoMs ?? 60_000);
  }

  async cookie(url: string, nombre: string): Promise<string | null> {
    const cookies = await this.jar.getCookies(url);
    return cookies.find((c) => c.key === nombre)?.value ?? null;
  }

  async solicitar(url: string, solicitud: SolicitudHttp = {}): Promise<RespuestaHttp> {
    const intentos = solicitud.reintentar === false ? 1 : this.reintentos + 1;
    let ultimoError: unknown;
    for (let intento = 1; intento <= intentos; intento++) {
      solicitud.signal?.throwIfAborted();
      try {
        const r = await this.unaVez(url, solicitud);
        if (r.status >= 500) {
          if (intento < intentos) {
            await this.temporizador.dormir(2000 * intento);
            continue;
          }
          throw new ErrorImpuestocl('SII_NO_DISPONIBLE', `El SII respondió ${r.status} en ${new URL(url).pathname}.`);
        }
        return r;
      } catch (e) {
        // La cancelación de quien pidió la consulta no es un error de red: se relanza tal cual, sin reintentar.
        solicitud.signal?.throwIfAborted();
        if (e instanceof ErrorImpuestocl) throw e;
        ultimoError = e;
        if (intento < intentos) await this.temporizador.dormir(2000 * intento);
      }
    }
    const host = new URL(url).hostname;
    const mensaje = esPlazoVencido(ultimoError)
      ? `El SII no respondió en ${this.plazoMs / 1000} s (${host}).`
      : `No se pudo conectar con el SII (${host}).`;
    throw new ErrorImpuestocl('SII_NO_DISPONIBLE', mensaje, { cause: ultimoError });
  }

  private esperarTurno(): Promise<void> {
    const turno = this.colaTurnos.then(async () => {
      const espera = this.ultimoMs + this.intervaloMinMs - this.temporizador.ahoraMs();
      if (espera > 0) await this.temporizador.dormir(espera);
      this.ultimoMs = this.temporizador.ahoraMs();
    });
    // Una espera fallida no bloquea la reserva de los siguientes turnos.
    this.colaTurnos = turno.catch(() => {});
    return turno;
  }

  private async unaVez(url: string, solicitud: SolicitudHttp): Promise<RespuestaHttp> {
    let actual = url;
    let method: 'GET' | 'POST' = solicitud.method ?? 'GET';
    let body = solicitud.body;
    for (let salto = 0; salto < 10; salto++) {
      const headers: Record<string, string> = { 'User-Agent': UA, 'Accept-Language': 'es-CL,es;q=0.9', ...(solicitud.headers ?? {}) };
      const cookies = await this.jar.getCookieString(actual);
      if (cookies) headers['Cookie'] = cookies;
      await this.esperarTurno();
      const plazo = AbortSignal.timeout(this.plazoMs);
      const signal = solicitud.signal ? AbortSignal.any([plazo, solicitud.signal]) : plazo;
      const res = await this.fetchFn(actual, { method, headers, body, redirect: 'manual', signal });
      for (const setCookie of res.headers.getSetCookie()) {
        await this.jar.setCookie(setCookie, actual, { ignoreError: true });
      }
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (method === 'POST' && solicitud.reenviarPostEnRedireccion === false && ![301, 302, 303].includes(res.status)) {
          throw new ErrorImpuestocl('PORTAL_CAMBIO', 'El SII pidió reenviar el formulario de inicio de sesión.');
        }
        actual = new URL(location, actual).toString();
        if (new URL(actual).hostname === HOST_SALA_ESPERA) {
          throw new ErrorImpuestocl('SII_EN_ESPERA', 'El SII tiene sala de espera por alta demanda.');
        }
        if (res.status === 301 || res.status === 302 || res.status === 303) {
          method = 'GET';
          body = undefined;
        }
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') ?? '';
      return { status: res.status, url: actual, contentType, bytes, texto: decodificar(bytes, contentType) };
    }
    throw new ErrorImpuestocl('PORTAL_CAMBIO', 'Demasiadas redirecciones del SII.');
  }
}

/** El muro de login: terminamos en zeusr, o el portal devolvió la página mínima que solo navega a zeusr. */
export function esMuroLogin(r: RespuestaHttp): boolean {
  if (new URL(r.url).hostname === HOST_LOGIN) return true;
  return r.texto.length < 2000 && /location\.replace\(\s*['"]https:\/\/zeusr\.sii\.cl/i.test(r.texto);
}

export function exigirSesion(r: RespuestaHttp): RespuestaHttp {
  if (esMuroLogin(r)) throw new ErrorImpuestocl('SESION_REQUERIDA', 'La sesión del SII expiró o no existe.');
  return r;
}
