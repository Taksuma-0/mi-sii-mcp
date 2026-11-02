import { spawn } from 'node:child_process';
import { crearServidorLocal, type ServidorLocal } from './servidor.js';

/** Puerto fijo de la página local: así una segunda apertura encuentra la que ya está corriendo. */
export const PUERTO_PAGINA = 47529;
/** Solo la dirección de la página propia, sin ruta ni caracteres que puedan colarse en el comando del sistema. */
const URL_LOCAL = /^http:\/\/127\.0\.0\.1:\d+$/;

export interface ComandoNavegador {
  readonly comando: string;
  readonly args: readonly string[];
}

/** El comando del sistema que abre `url` en el navegador predeterminado. */
export function comandoNavegador(plataforma: NodeJS.Platform, url: string): ComandoNavegador {
  // La crea el servidor local; nunca lleva entradas de la persona ni credenciales.
  if (!URL_LOCAL.test(url)) throw new Error('URL local inválida.');
  if (plataforma === 'win32') return { comando: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `Start-Process -FilePath '${url}'`] };
  if (plataforma === 'darwin') return { comando: 'open', args: [url] };
  return { comando: 'xdg-open', args: [url] };
}

export async function abrirEnNavegador(url: string, plataforma: NodeJS.Platform = process.platform): Promise<void> {
  const { comando, args } = comandoNavegador(plataforma, url);
  await new Promise<void>((resolver, rechazar) => {
    const proceso = spawn(comando, [...args], { windowsHide: true, stdio: 'ignore' });
    proceso.once('error', rechazar);
    proceso.once('exit', (codigo) => (codigo === 0 ? resolver() : rechazar(new Error('No se pudo abrir el navegador.'))));
  });
}

export interface OpcionesPagina {
  readonly puerto?: number;
  /** Muestra la dirección en el navegador; por defecto, el navegador predeterminado del sistema. */
  readonly abrir?: (url: string) => Promise<void>;
}

export interface PaginaLocal {
  readonly url: string;
  /** La instancia que se levantó ahora, o `null` si ya había una abierta en ese puerto. */
  readonly servidor: ServidorLocal | null;
  readonly enNavegador: boolean;
}

async function esPaginaPropia(url: string): Promise<boolean> {
  try {
    const respuesta = await fetch(`${url}/estado`, { signal: AbortSignal.timeout(1000), redirect: 'error' });
    const estado: unknown = await respuesta.json();
    return respuesta.ok && !!estado && typeof estado === 'object' && 'aplicacion' in estado && estado.aplicacion === 'mi-sii-mcp-local-v1';
  } catch {
    return false;
  }
}

/** Reutiliza la página que ya corre en el puerto o levanta una; si el puerto lo ocupa otra aplicación, usa uno libre. */
async function levantar(puerto: number): Promise<{ url: string; servidor: ServidorLocal | null }> {
  const url = `http://127.0.0.1:${puerto}`;
  if (await esPaginaPropia(url)) return { url, servidor: null };
  let servidor: ServidorLocal;
  try {
    servidor = await crearServidorLocal({ puerto });
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EADDRINUSE') throw error;
    servidor = await crearServidorLocal({ puerto: 0 });
  }
  return { url: servidor.url, servidor };
}

/**
 * Levanta la página local (o reutiliza la abierta) y la muestra en el navegador. Si el navegador no se abre, la deja
 * disponible y lo informa, para que quien llama entregue la dirección.
 */
export async function abrirPagina(opciones: OpcionesPagina = {}): Promise<PaginaLocal> {
  const { url, servidor } = await levantar(opciones.puerto ?? PUERTO_PAGINA);
  try {
    await (opciones.abrir ?? abrirEnNavegador)(url);
    return { url, servidor, enNavegador: true };
  } catch {
    return { url, servidor, enNavegador: false };
  }
}

/**
 * Para el lanzador «Abrir mi-sii-mcp.cmd», que corre sin ventana: si el navegador no se abre no hay dónde mostrar la
 * dirección, así que cierra la instancia nueva y falla.
 */
export async function iniciarLocal(opciones: OpcionesPagina & { readonly sinAbrir?: boolean } = {}): Promise<{ url: string; servidor: ServidorLocal | null }> {
  const { url, servidor } = await levantar(opciones.puerto ?? PUERTO_PAGINA);
  try {
    if (!opciones.sinAbrir) await (opciones.abrir ?? abrirEnNavegador)(url);
  } catch (error) {
    await servidor?.cerrar();
    throw error;
  }
  return { url, servidor };
}
