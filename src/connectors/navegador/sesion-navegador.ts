import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorImpuestocl } from '../../domain/errores.js';
import { temporizadorReal, type Temporizador } from '../sii/http.js';
import { URL_LOGIN_PAGINA } from '../sii/login.js';
import { buscarNavegador } from './buscar.js';
import { conectarCdp, type TransporteCdp } from './cdp.js';

/** Cookie del SII tomada del navegador. Nunca se muestra ni se devuelve fuera del gestor de sesiones. */
export interface CookieNavegador {
  readonly nombre: string;
  readonly valor: string;
  /** Como la informa el navegador: con punto inicial si vale para los subdominios. */
  readonly dominio: string;
  readonly ruta: string;
  /** Vencimiento en segundos desde 1970; null si es de sesión. */
  readonly expira: number | null;
  readonly httpOnly: boolean;
  readonly seguro: boolean;
}

/** El navegador lanzado: solo hace falta saber si sigue vivo, terminarlo y esperar su salida. */
export interface ProcesoNavegador {
  vivo(): boolean;
  terminar(): void;
  readonly salida: Promise<void>;
}

/** Lo que se usa de `process`: Ctrl+C y la salida de Node, para limpiar siempre. */
export interface EmisorProceso {
  once(evento: 'SIGINT' | 'exit', oyente: () => void): unknown;
  off(evento: 'SIGINT' | 'exit', oyente: () => void): unknown;
}

export interface OpcionesNavegador {
  /** Ruta del navegador; por defecto `buscarNavegador()`. */
  readonly ejecutable?: string;
  /** Plazo total para que la persona entre (por defecto 10 minutos). */
  readonly plazoMs?: number;
  /** Cada cuánto se revisan las cookies (por defecto 2 s). */
  readonly intervaloMs?: number;
  /** Plazo para que el navegador abra la depuración local (por defecto 30 s). */
  readonly plazoArranqueMs?: number;
  /** Cancela la espera: se cierra el navegador y se borra el perfil igual. */
  readonly signal?: AbortSignal;
  /** Carpeta donde se crea el perfil temporal (por defecto la carpeta temporal del sistema). */
  readonly carpetaBase?: string;
  readonly temporizador?: Temporizador;
  readonly lanzar?: (ejecutable: string, argumentos: readonly string[]) => ProcesoNavegador;
  readonly conectar?: (urlWs: string) => Promise<TransporteCdp>;
  readonly procesoNode?: EmisorProceso;
}

export const PLAZO_LOGIN_NAVEGADOR_MS = 10 * 60 * 1000;
const INTERVALO_MS = 2000;
const PLAZO_ARRANQUE_MS = 30_000;
const ESPERA_ARRANQUE_MS = 100;
const PLAZO_CIERRE_MS = 5000;
const ARCHIVO_PUERTO = 'DevToolsActivePort';
const ACCION_REINTENTO = 'Vuelve a ejecutar `impuestocl login-navegador` e inicia sesión en la ventana que se abre (ClaveÚnica o clave tributaria).';

/** `sii.cl` o un subdominio suyo (no basta con terminar en "sii.cl": `evilsii.cl` no lo es). */
export function esDominioSii(dominio: string): boolean {
  const d = dominio.trim().toLowerCase().replace(/^\./, '');
  return d === 'sii.cl' || d.endsWith('.sii.cl');
}

/** Esperas de la limpieza: no retienen a Node si el navegador ya cerró. */
const temporizadorCierre: Temporizador = {
  dormir: (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()),
  ahoraMs: () => Date.now(),
};

function lanzarNavegador(ejecutable: string, argumentos: readonly string[]): ProcesoNavegador {
  const hijo = spawn(ejecutable, argumentos, { stdio: 'ignore' });
  let vivo = true;
  const salida = new Promise<void>((resolve) => {
    const fin = () => {
      vivo = false;
      resolve();
    };
    hijo.once('exit', fin);
    hijo.once('error', fin);
  });
  return { vivo: () => vivo, terminar: () => void (vivo && hijo.kill()), salida };
}

function borrarCarpeta(carpeta: string): boolean {
  try {
    rmSync(carpeta, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    return true;
  } catch {
    return false;
  }
}

const sinTerminar = (texto: string, cause?: unknown) => new ErrorImpuestocl('SESION_REQUERIDA', texto, { accion: ACCION_REINTENTO, cause });

/**
 * Abre el navegador instalado en la página de login del SII con un perfil temporal y la depuración solo en 127.0.0.1
 * (puerto al azar). La persona entra ahí (ClaveÚnica o clave): impuestocl no ve ni guarda la clave ni lo escrito en los
 * formularios; solo lee las cookies con `Storage.getCookies` hasta ver la cookie TOKEN del SII y devuelve únicamente las
 * de `sii.cl`. Pase lo que pase (éxito, error, plazo o Ctrl+C) cierra el navegador y borra el perfil temporal.
 */
export async function capturarCookiesSii(o: OpcionesNavegador = {}): Promise<CookieNavegador[]> {
  const temporizador = o.temporizador ?? temporizadorReal;
  const procesoNode = o.procesoNode ?? process;
  const ejecutable = o.ejecutable ?? buscarNavegador();
  const control = new AbortController();
  const senal = o.signal ? AbortSignal.any([o.signal, control.signal]) : control.signal;
  const cancelacion = new Promise<never>((_resolve, reject) => {
    const cancelar = () => reject(sinTerminar('Se canceló el inicio de sesión en el navegador.'));
    if (senal.aborted) cancelar();
    else senal.addEventListener('abort', cancelar, { once: true });
  });
  cancelacion.catch(() => {});
  const conCancelacion = <T>(p: Promise<T>): Promise<T> => Promise.race([p, cancelacion]);

  const carpeta = mkdtempSync(join(o.carpetaBase ?? tmpdir(), 'impuestocl-navegador-'));
  let proceso: ProcesoNavegador | null = null;
  let transporte: TransporteCdp | null = null;
  const alCtrlC = () => control.abort();
  // Si Node termina de golpe, al menos se termina el navegador y se borra el perfil (todo síncrono).
  const alSalir = () => {
    if (proceso?.vivo()) proceso.terminar();
    borrarCarpeta(carpeta);
  };
  procesoNode.once('SIGINT', alCtrlC);
  procesoNode.once('exit', alSalir);
  try {
    if (senal.aborted) await cancelacion;
    proceso = (o.lanzar ?? lanzarNavegador)(ejecutable, [
      `--user-data-dir=${carpeta}`,
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      URL_LOGIN_PAGINA,
    ]);
    const urlWs = await esperarDepuracion(carpeta, proceso, temporizador, o.plazoArranqueMs ?? PLAZO_ARRANQUE_MS, conCancelacion);
    transporte = await conCancelacion((o.conectar ?? conectarCdp)(urlWs));
    return await esperarToken(transporte, temporizador, o.plazoMs ?? PLAZO_LOGIN_NAVEGADOR_MS, o.intervaloMs ?? INTERVALO_MS, conCancelacion, senal);
  } finally {
    await cerrarNavegador(transporte, proceso, o.temporizador ?? temporizadorCierre);
    procesoNode.off('SIGINT', alCtrlC);
    // Si no se pudo borrar ahora (archivos tomados), se reintenta al salir de Node.
    if (borrarCarpeta(carpeta)) procesoNode.off('exit', alSalir);
  }
}

async function esperarDepuracion(
  carpeta: string,
  proceso: ProcesoNavegador,
  temporizador: Temporizador,
  plazoMs: number,
  conCancelacion: <T>(p: Promise<T>) => Promise<T>,
): Promise<string> {
  const ruta = join(carpeta, ARCHIVO_PUERTO);
  const limite = temporizador.ahoraMs() + plazoMs;
  for (;;) {
    if (existsSync(ruta)) {
      const [puerto = '', camino = ''] = readFileSync(ruta, 'utf8').split(/\r?\n/).map((l) => l.trim());
      if (puerto !== '' && camino !== '') {
        const numero = Number(puerto);
        if (!/^\d{1,5}$/.test(puerto) || numero < 1 || numero > 65_535 || !/^\/devtools\/browser\/[\w-]+$/.test(camino)) {
          throw new ErrorImpuestocl('NAVEGADOR_NO_DISPONIBLE', 'El navegador informó una dirección de depuración inválida.');
        }
        return `ws://127.0.0.1:${numero}${camino}`;
      }
    }
    if (!proceso.vivo()) throw new ErrorImpuestocl('NAVEGADOR_NO_DISPONIBLE', 'El navegador se cerró antes de abrir la depuración local.');
    if (temporizador.ahoraMs() >= limite) throw new ErrorImpuestocl('NAVEGADOR_NO_DISPONIBLE', 'El navegador no abrió la depuración local a tiempo.');
    await conCancelacion(temporizador.dormir(ESPERA_ARRANQUE_MS));
  }
}

interface CookieCdp {
  readonly name?: unknown;
  readonly value?: unknown;
  readonly domain?: unknown;
  readonly path?: unknown;
  readonly expires?: unknown;
  readonly httpOnly?: unknown;
  readonly secure?: unknown;
  readonly session?: unknown;
}

function cookiesDe(resultado: unknown): CookieNavegador[] {
  const lista = (resultado as { cookies?: unknown } | null)?.cookies;
  if (!Array.isArray(lista)) return [];
  return (lista as CookieCdp[]).flatMap((c) => {
    if (typeof c.name !== 'string' || typeof c.value !== 'string' || typeof c.domain !== 'string' || !esDominioSii(c.domain)) return [];
    const expira = c.session === true || typeof c.expires !== 'number' || c.expires <= 0 ? null : c.expires;
    return [{ nombre: c.name, valor: c.value, dominio: c.domain, ruta: typeof c.path === 'string' && c.path !== '' ? c.path : '/', expira, httpOnly: c.httpOnly === true, seguro: c.secure === true }];
  });
}

async function esperarToken(
  transporte: TransporteCdp,
  temporizador: Temporizador,
  plazoMs: number,
  intervaloMs: number,
  conCancelacion: <T>(p: Promise<T>) => Promise<T>,
  senal: AbortSignal,
): Promise<CookieNavegador[]> {
  const limite = temporizador.ahoraMs() + plazoMs;
  for (;;) {
    let resultado: unknown;
    try {
      resultado = await conCancelacion(transporte.enviar('Storage.getCookies'));
    } catch (e) {
      if (senal.aborted || e instanceof ErrorImpuestocl) throw e;
      throw sinTerminar('Se cerró el navegador antes de terminar el inicio de sesión en el SII.', e);
    }
    const cookies = cookiesDe(resultado);
    if (cookies.some((c) => c.nombre === 'TOKEN' && c.valor !== '')) return cookies;
    if (temporizador.ahoraMs() >= limite) throw sinTerminar(`No se completó el inicio de sesión en el SII dentro del plazo (${Math.round(plazoMs / 60_000)} min).`);
    await conCancelacion(temporizador.dormir(intervaloMs));
  }
}

async function conPlazo(p: Promise<unknown>, temporizador: Temporizador, ms: number): Promise<void> {
  await Promise.race([p.then(() => {}, () => {}), temporizador.dormir(ms)]);
}

/** Pide al navegador que se cierre; si no lo hace a tiempo, termina el proceso. */
async function cerrarNavegador(transporte: TransporteCdp | null, proceso: ProcesoNavegador | null, temporizador: Temporizador): Promise<void> {
  if (transporte) {
    await conPlazo(transporte.enviar('Browser.close'), temporizador, PLAZO_CIERRE_MS);
    transporte.cerrar();
  }
  if (!proceso) return;
  await conPlazo(proceso.salida, temporizador, PLAZO_CIERRE_MS);
  if (proceso.vivo()) {
    proceso.terminar();
    await conPlazo(proceso.salida, temporizador, PLAZO_CIERRE_MS);
  }
}
