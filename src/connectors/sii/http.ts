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
}

export interface SolicitudHttp {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: string;
  /** false para el login: nunca se reintenta. */
  readonly reintentar?: boolean;
  /** false para el login: una redirección no puede volver a enviar su POST. */
  readonly reenviarPostEnRedireccion?: boolean;
}

export interface RespuestaHttp {
  readonly status: number;
  /** URL final, después de seguir redirecciones. */
  readonly url: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly texto: string;
}

export function decodificar(bytes: Uint8Array, contentType: string | null): string {
  const charset = /charset=([^;]+)/i.exec(contentType ?? '')?.[1]?.trim().replace(/["']/g, '').toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export class ClienteHttp {
  private ultimoMs = Number.NEGATIVE_INFINITY;
  private colaTurnos: Promise<void> = Promise.resolve();
  private readonly fetchFn: typeof fetch;
  private readonly temporizador: Temporizador;
  private readonly intervaloMinMs: number;
  private readonly reintentos: number;

  constructor(
    readonly jar: CookieJar = new CookieJar(),
    opciones: OpcionesHttp = {},
  ) {
    this.fetchFn = opciones.fetch ?? globalThis.fetch;
    this.temporizador = opciones.temporizador ?? temporizadorReal;
    this.intervaloMinMs = opciones.intervaloMinMs ?? 1000;
    this.reintentos = opciones.reintentos ?? 2;
  }

  async cookie(url: string, nombre: string): Promise<string | null> {
    const cookies = await this.jar.getCookies(url);
    return cookies.find((c) => c.key === nombre)?.value ?? null;
  }

  async solicitar(url: string, solicitud: SolicitudHttp = {}): Promise<RespuestaHttp> {
    const intentos = solicitud.reintentar === false ? 1 : this.reintentos + 1;
    let ultimoError: unknown;
    for (let intento = 1; intento <= intentos; intento++) {
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
        if (e instanceof ErrorImpuestocl) throw e;
        ultimoError = e;
        if (intento < intentos) await this.temporizador.dormir(2000 * intento);
      }
    }
    throw new ErrorImpuestocl('SII_NO_DISPONIBLE', `No se pudo conectar con el SII (${new URL(url).hostname}).`, { cause: ultimoError });
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
      const res = await this.fetchFn(actual, { method, headers, body, redirect: 'manual' });
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
