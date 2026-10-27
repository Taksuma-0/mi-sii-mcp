import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buscarNavegador } from '../../src/connectors/navegador/buscar.js';
import type { TransporteCdp } from '../../src/connectors/navegador/cdp.js';
import { capturarCookiesSii, esCookieTokenSii, limpiarPerfilesViejos, type ProcesoNavegador } from '../../src/connectors/navegador/sesion-navegador.js';
import { codigoDe } from '../helpers/errores.js';
import { temporizadorFalso } from '../helpers/http-falso.js';

describe('buscarNavegador', () => {
  const env = { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\Usuario\\AppData\\Local' };

  it('usa la ruta de MI_SII_MCP_NAVEGADOR si existe', () => {
    const ruta = 'D:\\Portables\\chrome.exe';
    expect(buscarNavegador({ ...env, MI_SII_MCP_NAVEGADOR: ruta }, (r) => r === ruta)).toBe(ruta);
  });

  it('falla claro si MI_SII_MCP_NAVEGADOR apunta a una ruta que no existe, sin buscar otro', () => {
    const edge = join(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    expect(() => buscarNavegador({ ...env, MI_SII_MCP_NAVEGADOR: 'D:\\no\\esta.exe' }, (r) => r === edge)).toThrowError(
      expect.objectContaining({ codigo: 'NAVEGADOR_NO_DISPONIBLE', message: expect.stringContaining('MI_SII_MCP_NAVEGADOR') }),
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
function navegadorFalso(o: { respuestas?: CookieCdp[][]; noCierra?: boolean; noResponde?: boolean; fallaEn?: number } = {}) {
  const registro: { ejecutable?: string; argumentos?: readonly string[]; metodos: string[]; terminado: number; transporteCerrado: number; preferencias?: unknown } = {
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
  let lecturas = 0;
  const transporte: TransporteCdp = {
    enviar: async (metodo) => {
      registro.metodos.push(metodo);
      if (o.noResponde) {
        morir();
        throw new Error('la tubería del navegador se cerró');
      }
      if (metodo === 'Browser.close') {
        if (!o.noCierra) morir();
        return {};
      }
      if (metodo === 'Storage.getCookies') {
        lecturas++;
        if (o.fallaEn === lecturas) throw new Error('la tubería del navegador se cerró');
        const respuestas = o.respuestas ?? [SIN_LOGIN, CON_LOGIN];
        return { cookies: respuestas[Math.min(lecturas, respuestas.length) - 1] };
      }
      throw new Error(`método inesperado ${metodo}`);
    },
    cerrar: () => {
      registro.transporteCerrado++;
    },
  };
  const lanzar = (ejecutable: string, argumentos: readonly string[]) => {
    registro.ejecutable = ejecutable;
    registro.argumentos = argumentos;
    const carpeta = argumentos.find((a) => a.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
    registro.preferencias = JSON.parse(readFileSync(join(carpeta, 'Default', 'Preferences'), 'utf8'));
    return { proceso, transporte };
  };
  return { registro, lanzar, proceso: () => vivo };
}

describe('capturarCookiesSii', () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'mi-sii-mcp-prueba-navegador-'));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const opciones = (n: ReturnType<typeof navegadorFalso>, extra: Record<string, unknown> = {}) => ({
    ejecutable: 'C:\\falso\\msedge.exe',
    carpetaBase: base,
    lanzar: n.lanzar,
    temporizador: temporizadorFalso().temporizador,
    procesoNode: new EventEmitter(),
    ...extra,
  });

  it('lanza el navegador con un perfil temporal, depuración por tubería (sin puerto), sin gestor de contraseñas, y devuelve solo cookies del SII', async () => {
    const n = navegadorFalso();
    const { temporizador, esperas } = temporizadorFalso();
    const cookies = await capturarCookiesSii(opciones(n, { temporizador }));

    expect(n.registro.ejecutable).toBe('C:\\falso\\msedge.exe');
    const args = n.registro.argumentos!;
    const carpeta = args[0]!.slice('--user-data-dir='.length);
    expect(carpeta.startsWith(join(base, 'mi-sii-mcp-navegador-'))).toBe(true);
    expect(args).toEqual([
      `--user-data-dir=${carpeta}`,
      '--remote-debugging-pipe',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html?https://misiir.sii.cl/cgi_misii/siihome.cgi',
    ]);
    expect(args.some((a) => a.startsWith('--remote-debugging-port') || a.startsWith('--remote-debugging-address'))).toBe(false);
    expect(n.registro.preferencias).toEqual({ credentials_enable_service: false, profile: { password_manager_enabled: false } });
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

  it('una cookie TOKEN de otro host del SII (o vacía) no cuenta como sesión iniciada', async () => {
    const n = navegadorFalso({ respuestas: [[cookie('TOKEN', 'zeusr.sii.cl')], [cookie('TOKEN', '.sii.cl', '')], [cookie('TOKEN', 'www4.sii.cl', 'tok-www4')]] });
    const { temporizador, esperas } = temporizadorFalso();
    const cookies = await capturarCookiesSii(opciones(n, { temporizador }));
    expect(esperas.filter((ms) => ms === 2000)).toHaveLength(2);
    expect(cookies.find((c) => c.valor === 'tok-www4')).toBeDefined();
  });

  it('sin TOKEN dentro del plazo cierra todo, borra el perfil y pide entrar de nuevo', async () => {
    const n = navegadorFalso({ respuestas: [SIN_LOGIN], noCierra: true });
    const { temporizador, esperas } = temporizadorFalso();
    const error = await capturarCookiesSii(opciones(n, { temporizador, plazoMs: 60_000 })).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'SESION_REQUERIDA', message: expect.stringContaining('(1 min)') });
    expect(esperas.filter((ms) => ms === 2000).length).toBe(30);
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
    expect(esperas.filter((ms) => ms === 2000).length).toBe((10 * 60 * 1000) / 2000);
  });

  it('si la persona cierra el navegador antes de entrar, limpia y lo explica', async () => {
    const n = navegadorFalso({ respuestas: [SIN_LOGIN], fallaEn: 2 });
    const error = await capturarCookiesSii(opciones(n)).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'SESION_REQUERIDA', message: expect.stringContaining('cerr') });
    expect(n.registro.transporteCerrado).toBe(1);
    expect(n.proceso()).toBe(false);
    expect(readdirSync(base)).toEqual([]);
  });

  it('si el navegador nunca responde por la tubería, dice que no se pudo abrir y borra el perfil', async () => {
    const n = navegadorFalso({ noResponde: true });
    expect(await codigoDe(capturarCookiesSii(opciones(n)))).toBe('NAVEGADOR_NO_DISPONIBLE');
    expect(n.registro.transporteCerrado).toBe(1);
    expect(readdirSync(base)).toEqual([]);
  });

  it('sin navegador instalado no crea el perfil temporal', async () => {
    const n = navegadorFalso();
    expect(await codigoDe(capturarCookiesSii({ ...opciones(n), ejecutable: undefined }))).toBe('NAVEGADOR_NO_DISPONIBLE');
    expect(n.registro.ejecutable).toBeUndefined();
    expect(readdirSync(base)).toEqual([]);
  });

  it('el lanzador real se niega a correr dentro de las pruebas, y el perfil se borra igual', async () => {
    const error = await capturarCookiesSii({ ejecutable: 'C:\\falso\\msedge.exe', carpetaBase: base, procesoNode: new EventEmitter() }).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'NAVEGADOR_NO_DISPONIBLE', message: expect.stringContaining('pruebas') });
    expect(readdirSync(base)).toEqual([]);
  });

  it('si lanzar falla, borra el perfil', async () => {
    const lanzar = () => {
      throw new Error('spawn falló');
    };
    await expect(capturarCookiesSii(opciones(navegadorFalso(), { lanzar }))).rejects.toThrow('spawn falló');
    expect(readdirSync(base)).toEqual([]);
  });

  it.each(['SIGINT', 'SIGHUP', 'SIGBREAK'])('%s cancela la espera, cierra el navegador, borra el perfil y quita sus oyentes', async (senal) => {
    const n = navegadorFalso({ respuestas: [SIN_LOGIN] });
    const procesoNode = new EventEmitter();
    let vueltas = 0;
    const temporizador = {
      ahoraMs: () => 0,
      dormir: async () => {
        if (++vueltas === 3) procesoNode.emit(senal);
        await new Promise((resolve) => setImmediate(resolve));
      },
    };
    const error = await capturarCookiesSii(opciones(n, { temporizador, procesoNode })).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'SESION_REQUERIDA', message: expect.stringContaining('cancel') });
    expect(n.registro.metodos).toContain('Browser.close');
    expect(n.proceso()).toBe(false);
    expect(readdirSync(base)).toEqual([]);
    for (const evento of ['SIGINT', 'SIGHUP', 'SIGBREAK', 'exit']) expect(procesoNode.listenerCount(evento)).toBe(0);
  });

  it('una señal abortada también cancela', async () => {
    const n = navegadorFalso({ respuestas: [SIN_LOGIN] });
    const control = new AbortController();
    control.abort();
    expect(await codigoDe(capturarCookiesSii(opciones(n, { signal: control.signal })))).toBe('SESION_REQUERIDA');
    expect(readdirSync(base)).toEqual([]);
  });

  it('al empezar borra perfiles temporales viejos de intentos anteriores, sin tocar otras carpetas', async () => {
    const viejo = join(base, 'mi-sii-mcp-navegador-viejo1');
    mkdirSync(join(viejo, 'Default'), { recursive: true });
    writeFileSync(join(viejo, 'Default', 'Cookies'), 'x');
    const horasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(viejo, horasAtras, horasAtras);
    mkdirSync(join(base, 'otra-carpeta'));
    await capturarCookiesSii(opciones(navegadorFalso()));
    expect(readdirSync(base)).toEqual(['otra-carpeta']);
  });
});

describe('limpiarPerfilesViejos', () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'mi-sii-mcp-prueba-limpieza-'));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const crear = (nombre: string, edadMs: number) => {
    const ruta = join(base, nombre);
    mkdirSync(ruta);
    const fecha = new Date(Date.now() - edadMs);
    utimesSync(ruta, fecha, fecha);
    return ruta;
  };

  it('borra solo los perfiles mi-sii-mcp-navegador-* de más de una hora (uno reciente puede estar en uso) e ignora los que no se pueden borrar', () => {
    const viejo = crear('mi-sii-mcp-navegador-aaa', 2 * 60 * 60 * 1000);
    const tomado = crear('mi-sii-mcp-navegador-bbb', 3 * 60 * 60 * 1000);
    crear('mi-sii-mcp-navegador-reciente', 5 * 60 * 1000);
    crear('otra-viejisima', 10 * 60 * 60 * 1000);
    writeFileSync(join(base, 'mi-sii-mcp-navegador-archivo'), 'no es carpeta');
    const intentos: string[] = [];
    limpiarPerfilesViejos(base, (ruta) => {
      intentos.push(ruta);
      if (ruta === tomado) throw new Error('EBUSY');
      rmSync(ruta, { recursive: true, force: true });
    });
    expect(intentos.sort()).toEqual([viejo, tomado].sort());
    expect(readdirSync(base).sort()).toEqual(['mi-sii-mcp-navegador-archivo', 'mi-sii-mcp-navegador-bbb', 'mi-sii-mcp-navegador-reciente', 'otra-viejisima']);
  });

  it('también borra los perfiles viejos con el nombre anterior (impuestocl-navegador-*)', () => {
    const anterior = crear('impuestocl-navegador-ccc', 2 * 60 * 60 * 1000);
    const intentos: string[] = [];
    limpiarPerfilesViejos(base, (ruta) => void intentos.push(ruta));
    expect(intentos).toEqual([anterior]);
  });

  it('una carpeta base inexistente no es un error', () => {
    expect(() => limpiarPerfilesViejos(join(base, 'no-existe'))).not.toThrow();
  });
});

describe('esCookieTokenSii', () => {
  const token = (dominio: string, valor = 't') => ({ nombre: 'TOKEN', valor, dominio, ruta: '/', expira: null, httpOnly: true, seguro: true });

  it.each(['sii.cl', '.sii.cl', 'www4.sii.cl', '.www4.sii.cl', 'WWW4.SII.CL'])('acepta TOKEN de %s', (dominio) => {
    expect(esCookieTokenSii(token(dominio))).toBe(true);
  });

  it.each(['zeusr.sii.cl', 'misiir.sii.cl', '.evilsii.cl', 'sii.cl.example.com'])('rechaza TOKEN de %s', (dominio) => {
    expect(esCookieTokenSii(token(dominio))).toBe(false);
  });

  it('rechaza un TOKEN vacío u otra cookie', () => {
    expect(esCookieTokenSii(token('.sii.cl', ''))).toBe(false);
    expect(esCookieTokenSii({ ...token('.sii.cl'), nombre: 'CSESSIONID' })).toBe(false);
  });
});
