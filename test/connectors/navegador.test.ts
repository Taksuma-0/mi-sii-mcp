import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buscarNavegador } from '../../src/connectors/navegador/buscar.js';
import type { TransporteCdp } from '../../src/connectors/navegador/cdp.js';
import { capturarCookiesSii, type ProcesoNavegador } from '../../src/connectors/navegador/sesion-navegador.js';
import { codigoDe } from '../helpers/errores.js';
import { temporizadorFalso } from '../helpers/http-falso.js';

describe('buscarNavegador', () => {
  const env = { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\Usuario\\AppData\\Local' };

  it('usa la ruta de IMPUESTOCL_NAVEGADOR si existe', () => {
    const ruta = 'D:\\Portables\\chrome.exe';
    expect(buscarNavegador({ ...env, IMPUESTOCL_NAVEGADOR: ruta }, (r) => r === ruta)).toBe(ruta);
  });

  it('falla claro si IMPUESTOCL_NAVEGADOR apunta a una ruta que no existe, sin buscar otro', () => {
    const edge = join(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    expect(() => buscarNavegador({ ...env, IMPUESTOCL_NAVEGADOR: 'D:\\no\\esta.exe' }, (r) => r === edge)).toThrowError(
      expect.objectContaining({ codigo: 'NAVEGADOR_NO_DISPONIBLE', message: expect.stringContaining('IMPUESTOCL_NAVEGADOR') }),
    );
  });

  it('encuentra Edge en Program Files (x86)', () => {
    const edge = join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    expect(buscarNavegador(env, (r) => r === edge)).toBe(edge);
  });

  it('encuentra Chrome instalado solo para el usuario (LocalAppData)', () => {
    const chrome = join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe');
    expect(buscarNavegador(env, (r) => r === chrome)).toBe(chrome);
  });

  it('prefiere Edge si están los dos', () => {
    const edge = join(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    const chrome = join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe');
    expect(buscarNavegador(env, (r) => r === edge || r === chrome)).toBe(edge);
  });

  it('la suite nunca encuentra un navegador real (vitest fuerza una ruta inexistente)', () => {
    expect(() => buscarNavegador()).toThrowError(expect.objectContaining({ codigo: 'NAVEGADOR_NO_DISPONIBLE' }));
  });

  it('sin navegador da un error claro', () => {
    expect(() => buscarNavegador(env, () => false)).toThrowError(expect.objectContaining({ codigo: 'NAVEGADOR_NO_DISPONIBLE' }));
  });
});

interface CookieCdp {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
}

const cookie = (name: string, domain: string, value = `v-${name}`): CookieCdp => ({ name, value, domain, path: '/', expires: -1, httpOnly: true, secure: true, session: true });

const SIN_LOGIN = [cookie('TS01', '.sii.cl'), cookie('NID', '.google.com')];
const CON_LOGIN = [
  cookie('TOKEN', '.sii.cl', 'tok-navegador'),
  cookie('CSESSIONID', '.sii.cl'),
  cookie('NETSCAPE_LIVEWIRE.rut', 'www4.sii.cl'),
  cookie('ajeno', '.evilsii.cl'),
  cookie('NID', '.google.com'),
  cookie('sesion_cu', 'accounts.claveunica.gob.cl'),
];

/** Navegador y transporte CDP falsos: nunca se lanza un navegador real. */
function navegadorFalso(o: { respuestas?: CookieCdp[][]; noCierra?: boolean; sinPuerto?: boolean; fallaEn?: number } = {}) {
  const registro: { ejecutable?: string; argumentos?: readonly string[]; metodos: string[]; terminado: number; transporteCerrado: number; urlWs?: string } = {
    metodos: [],
    terminado: 0,
    transporteCerrado: 0,
  };
  let vivo = true;
  let salir!: () => void;
  const salida = new Promise<void>((resolve) => {
    salir = resolve;
  });
  const morir = () => {
    vivo = false;
    salir();
  };
  const proceso: ProcesoNavegador = {
    vivo: () => vivo,
    terminar: () => {
      registro.terminado++;
      morir();
    },
    salida,
  };
  const lanzar = (ejecutable: string, argumentos: readonly string[]): ProcesoNavegador => {
    registro.ejecutable = ejecutable;
    registro.argumentos = argumentos;
    const carpeta = argumentos.find((a) => a.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
    if (o.sinPuerto) morir();
    else writeFileSync(join(carpeta, 'DevToolsActivePort'), '54321\n/devtools/browser/abc-123\n');
    return proceso;
  };
  let lecturas = 0;
  const transporte: TransporteCdp = {
    enviar: async (metodo) => {
      registro.metodos.push(metodo);
      if (metodo === 'Browser.close') {
        if (!o.noCierra) morir();
        return {};
      }
      if (metodo === 'Storage.getCookies') {
        lecturas++;
        if (o.fallaEn === lecturas) throw new Error('conexión CDP cerrada');
        const respuestas = o.respuestas ?? [SIN_LOGIN, CON_LOGIN];
        return { cookies: respuestas[Math.min(lecturas, respuestas.length) - 1] };
      }
      throw new Error(`método inesperado ${metodo}`);
    },
    cerrar: () => {
      registro.transporteCerrado++;
    },
  };
  const conectar = async (urlWs: string) => {
    registro.urlWs = urlWs;
    return transporte;
  };
  return { registro, lanzar, conectar, proceso: () => vivo };
}

describe('capturarCookiesSii', () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'impuestocl-prueba-navegador-'));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const opciones = (n: ReturnType<typeof navegadorFalso>, extra: Record<string, unknown> = {}) => ({
    ejecutable: 'C:\\falso\\msedge.exe',
    carpetaBase: base,
    lanzar: n.lanzar,
    conectar: n.conectar,
    temporizador: temporizadorFalso().temporizador,
    procesoNode: new EventEmitter(),
    ...extra,
  });

  it('lanza el navegador con un perfil temporal y depuración solo local, espera TOKEN y devuelve solo cookies del SII', async () => {
    const n = navegadorFalso();
    const { temporizador, esperas } = temporizadorFalso();
    const cookies = await capturarCookiesSii(opciones(n, { temporizador }));

    expect(n.registro.ejecutable).toBe('C:\\falso\\msedge.exe');
    const args = n.registro.argumentos!;
    const carpeta = args[0]!.slice('--user-data-dir='.length);
    expect(carpeta.startsWith(join(base, 'impuestocl-navegador-'))).toBe(true);
    expect(args).toEqual([
      `--user-data-dir=${carpeta}`,
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html?https://misiir.sii.cl/cgi_misii/siihome.cgi',
    ]);
    expect(n.registro.urlWs).toBe('ws://127.0.0.1:54321/devtools/browser/abc-123');
    expect(esperas.filter((ms) => ms === 2000)).toHaveLength(1);

    expect(cookies.map((c) => `${c.nombre}@${c.dominio}`)).toEqual(['TOKEN@.sii.cl', 'CSESSIONID@.sii.cl', 'NETSCAPE_LIVEWIRE.rut@www4.sii.cl']);
    expect(cookies[0]).toEqual({ nombre: 'TOKEN', valor: 'tok-navegador', dominio: '.sii.cl', ruta: '/', expira: null, httpOnly: true, seguro: true });

    expect(n.registro.metodos.at(-1)).toBe('Browser.close');
    expect(n.registro.transporteCerrado).toBe(1);
    expect(n.proceso()).toBe(false);
    expect(existsSync(carpeta)).toBe(false);
    expect(readdirSync(base)).toEqual([]);
  });

  it('una cookie con vencimiento conserva su fecha en segundos', async () => {
    const conVencimiento = { ...cookie('TOKEN', '.sii.cl'), expires: 1_900_000_000.5, session: false };
    const n = navegadorFalso({ respuestas: [[conVencimiento]] });
    const [token] = await capturarCookiesSii(opciones(n));
    expect(token!.expira).toBe(1_900_000_000.5);
  });

  it('sin TOKEN dentro del plazo cierra todo, borra el perfil y pide entrar de nuevo', async () => {
    const n = navegadorFalso({ respuestas: [SIN_LOGIN], noCierra: true });
    const { temporizador, esperas } = temporizadorFalso();
    const error = await capturarCookiesSii(opciones(n, { temporizador, plazoMs: 10_000 })).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'SESION_REQUERIDA', message: expect.stringContaining('plazo') });
    expect(esperas.filter((ms) => ms === 2000).length).toBeGreaterThanOrEqual(4);
    expect(n.registro.metodos).toContain('Browser.close');
    // El navegador no se cerró con Browser.close: se termina el proceso.
    expect(n.registro.terminado).toBe(1);
    expect(n.proceso()).toBe(false);
    expect(readdirSync(base)).toEqual([]);
  });

  it('el plazo por defecto es de 10 minutos', async () => {
    const n = navegadorFalso({ respuestas: [SIN_LOGIN] });
    const { temporizador, esperas } = temporizadorFalso();
    expect(await codigoDe(capturarCookiesSii(opciones(n, { temporizador })))).toBe('SESION_REQUERIDA');
    const esperado = (10 * 60 * 1000) / 2000;
    expect(esperas.filter((ms) => ms === 2000).length).toBeGreaterThanOrEqual(esperado - 1);
    expect(esperas.filter((ms) => ms === 2000).length).toBeLessThanOrEqual(esperado + 1);
  });

  it('si la persona cierra el navegador antes de entrar, limpia y lo explica', async () => {
    const n = navegadorFalso({ respuestas: [SIN_LOGIN], fallaEn: 2 });
    const error = await capturarCookiesSii(opciones(n)).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'SESION_REQUERIDA', message: expect.stringContaining('cerr') });
    expect(n.registro.transporteCerrado).toBe(1);
    expect(n.proceso()).toBe(false);
    expect(readdirSync(base)).toEqual([]);
  });

  it('si el navegador no abre la depuración, borra el perfil temporal', async () => {
    const n = navegadorFalso({ sinPuerto: true });
    expect(await codigoDe(capturarCookiesSii(opciones(n)))).toBe('NAVEGADOR_NO_DISPONIBLE');
    expect(n.registro.urlWs).toBeUndefined();
    expect(readdirSync(base)).toEqual([]);
  });

  it('sin navegador instalado no crea el perfil temporal', async () => {
    const n = navegadorFalso();
    expect(await codigoDe(capturarCookiesSii({ ...opciones(n), ejecutable: undefined }))).toBe('NAVEGADOR_NO_DISPONIBLE');
    expect(n.registro.ejecutable).toBeUndefined();
    expect(readdirSync(base)).toEqual([]);
  });

  it('si falla la conexión CDP, termina el navegador y borra el perfil', async () => {
    const n = navegadorFalso();
    const conectar = async () => {
      throw new Error('conexión rechazada');
    };
    await expect(capturarCookiesSii(opciones(n, { conectar }))).rejects.toThrow();
    expect(n.registro.terminado).toBe(1);
    expect(readdirSync(base)).toEqual([]);
  });

  it('Ctrl+C cancela la espera, cierra el navegador y borra el perfil', async () => {
    const n = navegadorFalso({ respuestas: [SIN_LOGIN] });
    const procesoNode = new EventEmitter();
    let vueltas = 0;
    const temporizador = {
      ahoraMs: () => 0,
      dormir: async () => {
        if (++vueltas === 3) procesoNode.emit('SIGINT');
        await new Promise((resolve) => setImmediate(resolve));
      },
    };
    const error = await capturarCookiesSii(opciones(n, { temporizador, procesoNode })).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'SESION_REQUERIDA', message: expect.stringContaining('cancel') });
    expect(n.registro.metodos).toContain('Browser.close');
    expect(n.proceso()).toBe(false);
    expect(readdirSync(base)).toEqual([]);
    expect(procesoNode.listenerCount('SIGINT')).toBe(0);
    expect(procesoNode.listenerCount('exit')).toBe(0);
  });

  it('una señal abortada también cancela', async () => {
    const n = navegadorFalso({ respuestas: [SIN_LOGIN] });
    const control = new AbortController();
    control.abort();
    expect(await codigoDe(capturarCookiesSii(opciones(n, { signal: control.signal })))).toBe('SESION_REQUERIDA');
    expect(readdirSync(base)).toEqual([]);
  });

  it('rechaza un DevToolsActivePort que no apunta a un navegador local', async () => {
    const n = navegadorFalso();
    const lanzar = (ejecutable: string, argumentos: readonly string[]) => {
      const proceso = n.lanzar(ejecutable, argumentos);
      const carpeta = argumentos[0]!.slice('--user-data-dir='.length);
      writeFileSync(join(carpeta, 'DevToolsActivePort'), '54321\n@evil.example/devtools\n');
      return proceso;
    };
    expect(await codigoDe(capturarCookiesSii(opciones(n, { lanzar })))).toBe('NAVEGADOR_NO_DISPONIBLE');
    expect(n.registro.urlWs).toBeUndefined();
    expect(readdirSync(base)).toEqual([]);
  });
});
