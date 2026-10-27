import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { ErrorImpuestocl } from '../../domain/errores.js';
import { temporizadorReal, type Temporizador } from '../sii/http.js';
import { URL_LOGIN_PAGINA } from '../sii/login.js';
import { buscarNavegador } from './buscar.js';
import { transportePipe, type TransporteCdp } from './cdp.js';

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

/** El navegador lanzado y su CDP por tubería. */
export interface NavegadorLanzado {
  readonly proceso: ProcesoNavegador;
  readonly transporte: TransporteCdp;
}

/** Señales con que se interrumpe Node (Ctrl+C, cerrar la consola, Ctrl+Break) y su salida: siempre se limpia. */
export type EventoProceso = 'SIGINT' | 'SIGHUP' | 'SIGBREAK' | 'exit';
const SENALES: readonly EventoProceso[] = ['SIGINT', 'SIGHUP', 'SIGBREAK'];

/** Lo que se usa de `process` para limpiar siempre. */
export interface EmisorProceso {
  once(evento: EventoProceso, oyente: () => void): unknown;
  off(evento: EventoProceso, oyente: () => void): unknown;
}

export interface OpcionesNavegador {
  /** Ruta del navegador; por defecto `buscarNavegador()`. */
  readonly ejecutable?: string;
  /** Plazo total para que la persona entre (por defecto 10 minutos). */
  readonly plazoMs?: number;
  /** Cada cuánto se revisan las cookies (por defecto 2 s). */
  readonly intervaloMs?: number;
  /** Cancela la espera: se cierra el navegador y se borra el perfil igual. */
  readonly signal?: AbortSignal;
  /** Carpeta donde se crea el perfil temporal (por defecto la carpeta temporal del sistema). */
  readonly carpetaBase?: string;
  readonly temporizador?: Temporizador;
  readonly lanzar?: (ejecutable: string, argumentos: readonly string[]) => NavegadorLanzado;
  readonly procesoNode?: EmisorProceso;
}

export const PLAZO_LOGIN_NAVEGADOR_MS = 10 * 60 * 1000;
/** Tope del plazo configurable; los perfiles temporales más antiguos que el doble se dan por abandonados. */
export const PLAZO_MAXIMO_LOGIN_NAVEGADOR_MS = 30 * 60 * 1000;
const INTERVALO_MS = 2000;
const PLAZO_CIERRE_MS = 5000;
const PREFIJO_PERFIL = 'impuestocl-navegador-';
/** Un perfil temporal más antiguo que esto ya no está en uso: el plazo de login tiene un máximo de 30 minutos. */
const ANTIGUEDAD_PERFIL_VIEJO_MS = 2 * PLAZO_MAXIMO_LOGIN_NAVEGADOR_MS;
/** El perfil temporal no ofrece guardar contraseñas. */
const PREFERENCIAS = { credentials_enable_service: false, profile: { password_manager_enabled: false } };
const ACCION_REINTENTO = 'Vuelve a ejecutar `mi-sii-mcp login-navegador` e inicia sesión en la ventana que se abre (ClaveÚnica o clave tributaria).';

const sinPunto = (dominio: string): string => dominio.trim().toLowerCase().replace(/^\./, '');

/** `sii.cl` o un subdominio suyo (no basta con terminar en "sii.cl": `evilsii.cl` no lo es). */
export function esDominioSii(dominio: string): boolean {
  const d = sinPunto(dominio);
  return d === 'sii.cl' || d.endsWith('.sii.cl');
}

/**
 * La cookie TOKEN que usan las consultas de www4 (la misma regla al capturar y al importar): no vacía y de `sii.cl` o de
 * `www4.sii.cl`, con o sin punto inicial.
 */
export function esCookieTokenSii(c: CookieNavegador): boolean {
  const d = sinPunto(c.dominio);
  return c.nombre === 'TOKEN' && c.valor !== '' && (d === 'sii.cl' || d === 'www4.sii.cl');
}

/** Esperas de la limpieza: no retienen a Node si el navegador ya cerró. */
const temporizadorCierre: Temporizador = {
  dormir: (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()),
  ahoraMs: () => Date.now(),
};

/** Lanza el navegador con el CDP por los descriptores 3 (órdenes) y 4 (respuestas). Nunca durante las pruebas. */
function lanzarNavegador(ejecutable: string, argumentos: readonly string[]): NavegadorLanzado {
  if (process.env['VITEST']) {
    throw new ErrorImpuestocl('NAVEGADOR_NO_DISPONIBLE', 'mi-sii-mcp no lanza un navegador real durante las pruebas.');
  }
  const hijo = spawn(ejecutable, argumentos, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let vivo = true;
  const salida = new Promise<void>((resolve) => {
    const fin = () => {
      vivo = false;
      resolve();
    };
    hijo.once('exit', fin);
    hijo.once('error', fin);
  });
  const proceso: ProcesoNavegador = { vivo: () => vivo, terminar: () => void (vivo && hijo.kill()), salida };
  const escritura = hijo.stdio[3] as Writable | null | undefined;
  const lectura = hijo.stdio[4] as Readable | null | undefined;
  if (!escritura || !lectura) {
    proceso.terminar();
    throw new ErrorImpuestocl('NAVEGADOR_NO_DISPONIBLE', 'No se pudo abrir la tubería de depuración del navegador.');
  }
  return { proceso, transporte: transportePipe(escritura, lectura) };
}

function borrarCarpeta(carpeta: string): boolean {
  try {
    rmSync(carpeta, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Borra los perfiles temporales que dejó un intento anterior interrumpido (más de una hora: uno reciente puede ser de otro
 * login en curso). Lo que no se pueda borrar (archivos tomados) se deja.
 */
export function limpiarPerfilesViejos(
  base: string,
  borrar: (ruta: string) => void = (ruta) => rmSync(ruta, { recursive: true, force: true }),
  ahoraMs: number = Date.now(),
): void {
  let entradas;
  try {
    entradas = readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entrada of entradas) {
    if (!entrada.isDirectory() || !entrada.name.startsWith(PREFIJO_PERFIL)) continue;
    const ruta = join(base, entrada.name);
    try {
      if (ahoraMs - statSync(ruta).mtimeMs < ANTIGUEDAD_PERFIL_VIEJO_MS) continue;
      borrar(ruta);
    } catch {
      // tomado por otro proceso o ya no existe: se deja
    }
  }
}

const sinTerminar = (texto: string, cause?: unknown) => new ErrorImpuestocl('SESION_REQUERIDA', texto, { accion: ACCION_REINTENTO, cause });

/**
 * Abre el navegador instalado en la página de login del SII con un perfil temporal (sin gestor de contraseñas ni
 * sincronización) y el CDP por tubería, sin puerto de depuración. La persona entra ahí (ClaveÚnica o clave): mi-sii-mcp no
 * ve ni guarda la clave ni lo escrito en los formularios; solo lee las cookies con `Storage.getCookies` hasta ver la cookie
 * TOKEN del SII y devuelve únicamente las de `sii.cl`. Pase lo que pase (éxito, error, plazo, Ctrl+C o cierre de la
 * consola) cierra el navegador y borra el perfil temporal.
 */
export async function capturarCookiesSii(o: OpcionesNavegador = {}): Promise<CookieNavegador[]> {
  const temporizador = o.temporizador ?? temporizadorReal;
  const procesoNode = o.procesoNode ?? process;
  const ejecutable = o.ejecutable ?? buscarNavegador();
  const base = o.carpetaBase ?? tmpdir();
  const control = new AbortController();
  const senal = o.signal ? AbortSignal.any([o.signal, control.signal]) : control.signal;
  const cancelacion = new Promise<never>((_resolve, reject) => {
    const cancelar = () => reject(sinTerminar('Se canceló el inicio de sesión en el navegador.'));
    if (senal.aborted) cancelar();
    else senal.addEventListener('abort', cancelar, { once: true });
  });
  cancelacion.catch(() => {});
  const conCancelacion = <T>(p: Promise<T>): Promise<T> => Promise.race([p, cancelacion]);

  limpiarPerfilesViejos(base);
  const carpeta = mkdtempSync(join(base, PREFIJO_PERFIL));
  let lanzado: NavegadorLanzado | null = null;
  const alInterrumpir = () => control.abort();
  // Si Node termina de golpe, al menos se termina el navegador y se borra el perfil (todo síncrono).
  const alSalir = () => {
    if (lanzado?.proceso.vivo()) lanzado.proceso.terminar();
    borrarCarpeta(carpeta);
  };
  for (const s of SENALES) procesoNode.once(s, alInterrumpir);
  procesoNode.once('exit', alSalir);
  try {
    if (senal.aborted) await cancelacion;
    mkdirSync(join(carpeta, 'Default'), { recursive: true });
    writeFileSync(join(carpeta, 'Default', 'Preferences'), JSON.stringify(PREFERENCIAS));
    lanzado = (o.lanzar ?? lanzarNavegador)(ejecutable, [
      `--user-data-dir=${carpeta}`,
      '--remote-debugging-pipe',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      URL_LOGIN_PAGINA,
    ]);
    return await esperarToken(lanzado, temporizador, o.plazoMs ?? PLAZO_LOGIN_NAVEGADOR_MS, o.intervaloMs ?? INTERVALO_MS, conCancelacion, senal);
  } finally {
    await cerrarNavegador(lanzado, o.temporizador ?? temporizadorCierre);
    for (const s of SENALES) procesoNode.off(s, alInterrumpir);
    // Si no se pudo borrar ahora (archivos tomados), se reintenta al salir de Node y en el próximo login.
    if (borrarCarpeta(carpeta)) procesoNode.off('exit', alSalir);
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
  { proceso, transporte }: NavegadorLanzado,
  temporizador: Temporizador,
  plazoMs: number,
  intervaloMs: number,
  conCancelacion: <T>(p: Promise<T>) => Promise<T>,
  senal: AbortSignal,
): Promise<CookieNavegador[]> {
  const limite = temporizador.ahoraMs() + plazoMs;
  let respondio = false;
  for (;;) {
    let resultado: unknown;
    try {
      resultado = await conCancelacion(transporte.enviar('Storage.getCookies'));
    } catch (e) {
      if (senal.aborted || e instanceof ErrorImpuestocl) throw e;
      if (!respondio && !proceso.vivo()) {
        throw new ErrorImpuestocl('NAVEGADOR_NO_DISPONIBLE', 'El navegador no se abrió o no respondió por la tubería de depuración.', { cause: e });
      }
      throw sinTerminar('Se cerró el navegador antes de terminar el inicio de sesión en el SII.', e);
    }
    respondio = true;
    const cookies = cookiesDe(resultado);
    if (cookies.some(esCookieTokenSii)) return cookies;
    if (temporizador.ahoraMs() >= limite) throw sinTerminar(`No se completó el inicio de sesión en el SII dentro del plazo (${Math.round(plazoMs / 60_000)} min).`);
    await conCancelacion(temporizador.dormir(intervaloMs));
  }
}

async function conPlazo(p: Promise<unknown>, temporizador: Temporizador, ms: number): Promise<void> {
  await Promise.race([p.then(() => {}, () => {}), temporizador.dormir(ms)]);
}

/** Pide al navegador que se cierre; si no lo hace a tiempo, termina el proceso. */
async function cerrarNavegador(lanzado: NavegadorLanzado | null, temporizador: Temporizador): Promise<void> {
  if (!lanzado) return;
  const { proceso, transporte } = lanzado;
  await conPlazo(transporte.enviar('Browser.close'), temporizador, PLAZO_CIERRE_MS);
  transporte.cerrar();
  await conPlazo(proceso.salida, temporizador, PLAZO_CIERRE_MS);
  if (proceso.vivo()) {
    proceso.terminar();
    await conPlazo(proceso.salida, temporizador, PLAZO_CIERRE_MS);
  }
}
