import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CODIGO_CLAVE_INCORRECTA, CODIGO_SESIONES_MAXIMAS } from '../../src/connectors/sii/login.js';
import { GestorSesiones } from '../../src/connectors/sii/sesiones.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, HTML, sinEsperas, type DefRespuesta, type RutaFalsa } from '../helpers/http-falso.js';
import { SecretosEnMemoria } from '../helpers/secretos.js';
import { PAGINA_STUB, paginaDatosCntr, paginaErrorClave, paginaErrorLogin, RUTA_LOGOUT, RUTA_MI_SII, RUTA_POST, rutasLoginOk } from '../helpers/sii-login.js';

const RUT = '22222222-2';
const DATOS_OK: DefRespuesta = { headers: HTML, body: paginaDatosCntr('22222222', '2', 'EMPRESA DEMO SPA') };
const STUB: DefRespuesta = { headers: HTML, body: PAGINA_STUB };
const dirTemporal = () => join(mkdtempSync(join(tmpdir(), 'impuestocl-')), 'sesiones');

function gestor(dir: string, secretos: SecretosEnMemoria, rutas: Record<string, RutaFalsa>) {
  const { fetchFalso, llamadas } = crearFetchFalso(rutas);
  return { g: new GestorSesiones(dir, secretos, { fetch: fetchFalso, temporizador: sinEsperas }), llamadas };
}

function pausa() {
  let liberar!: () => void;
  const promesa = new Promise<void>((resolve) => { liberar = resolve; });
  return { promesa, liberar };
}

describe('GestorSesiones', () => {
  it('loginInteractivo guarda la sesión y, si se pide, la clave en el llavero', async () => {
    const secretos = new SecretosEnMemoria();
    const { g } = gestor(dirTemporal(), secretos, rutasLoginOk());
    const r = await g.loginInteractivo('22.222.222-2', 'secreta', true);
    expect(r.identidad.rut).toBe(RUT);
    expect(r.claveGuardada).toBe(true);
    expect(secretos.mapa.get(RUT)).toBe('secreta');
    expect(g.estado(RUT)).toMatchObject({ tieneSesion: true, bloqueado: false });
  });

  it('reutiliza la sesión guardada sin volver a enviar la clave', async () => {
    const dir = dirTemporal();
    const secretos = new SecretosEnMemoria();
    await gestor(dir, secretos, rutasLoginOk()).g.loginInteractivo(RUT, 'secreta', false);
    const { g, llamadas } = gestor(dir, secretos, { [RUTA_MI_SII]: DATOS_OK });
    await g.sesionActiva(RUT);
    expect(llamadas.some((l) => l.method === 'POST')).toBe(false);
    expect(llamadas[0]!.headers['Cookie']).toContain('TOKEN=tok123');
    expect(secretos.mapa.size).toBe(0);
  });

  it('sin sesión ni clave guardada exige login', async () => {
    const { g } = gestor(dirTemporal(), new SecretosEnMemoria(), { [RUTA_MI_SII]: STUB });
    expect(await codigoDe(g.sesionActiva(RUT))).toBe('SESION_REQUERIDA');
  });

  it('rechaza otra identidad sin memorizarla ni intentar login con la clave guardada', async () => {
    const secretos = new SecretosEnMemoria();
    secretos.mapa.set(RUT, 'secreta');
    let sesionExpirada = false;
    const { g, llamadas } = gestor(dirTemporal(), secretos, {
      ...rutasLoginOk(),
      [RUTA_MI_SII]: () => sesionExpirada ? STUB : { headers: HTML, body: paginaDatosCntr('33333333', '3', null) },
    });
    expect(await codigoDe(g.sesionActiva('22.222.222-2'))).toBe('PORTAL_CAMBIO');
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(0);
    expect(g.estado(RUT).tieneSesion).toBe(false);
    g.persistir(RUT);
    expect(g.estado(RUT).tieneSesion).toBe(false);
    sesionExpirada = true;
    secretos.mapa.clear();
    expect(await codigoDe(g.sesionActiva(RUT))).toBe('SESION_REQUERIDA');
  });

  it('con la sesión expirada y la clave guardada vuelve a entrar solo', async () => {
    const dir = dirTemporal();
    const secretos = new SecretosEnMemoria();
    await gestor(dir, secretos, rutasLoginOk()).g.loginInteractivo(RUT, 'secreta', true);
    const { g, llamadas } = gestor(dir, secretos, { ...rutasLoginOk(), [RUTA_MI_SII]: (_l, n) => (n === 1 ? STUB : DATOS_OK) });
    await g.sesionActiva(RUT);
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(1);
    expect(g.estado(RUT).tieneSesion).toBe(true);
  });

  describe('cookie TOKEN', () => {
    const TOKEN_VENCIDO: DefRespuesta = { headers: [...HTML, ['set-cookie', 'TOKEN=expirado; Max-Age=0; Domain=.sii.cl; Path=/']], body: paginaDatosCntr('22222222', '2', 'EMPRESA DEMO SPA') };

    it('una sesión guardada cuyo TOKEN venció entra de nuevo con la clave del llavero', async () => {
      const dir = dirTemporal();
      const secretos = new SecretosEnMemoria();
      secretos.mapa.set(RUT, 'secreta');
      await gestor(dir, secretos, rutasLoginOk()).g.loginInteractivo(RUT, 'secreta', false);
      const { g, llamadas } = gestor(dir, secretos, { ...rutasLoginOk(), [RUTA_MI_SII]: (_l, n) => (n === 1 ? TOKEN_VENCIDO : DATOS_OK) });
      const http = await g.sesionActiva(RUT);
      expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(1);
      expect(await http.cookie('https://www4.sii.cl/', 'TOKEN')).toBe('tok123');
    });

    it('una sesión guardada cuyo TOKEN venció, sin clave en el llavero, exige login', async () => {
      const dir = dirTemporal();
      await gestor(dir, new SecretosEnMemoria(), rutasLoginOk()).g.loginInteractivo(RUT, 'secreta', false);
      const { g, llamadas } = gestor(dir, new SecretosEnMemoria(), { ...rutasLoginOk(), [RUTA_MI_SII]: TOKEN_VENCIDO });
      expect(await codigoDe(g.sesionActiva(RUT))).toBe('SESION_REQUERIDA');
      expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(0);
    });
  });

  it('una clave guardada rechazada bloquea el RUT, borra la clave y no reintenta', async () => {
    const secretos = new SecretosEnMemoria();
    secretos.mapa.set(RUT, 'mala');
    const ok = rutasLoginOk();
    const { g, llamadas } = gestor(dirTemporal(), secretos, {
      ...ok,
      [RUTA_POST]: (_l, n) => (n === 1 ? paginaErrorClave() : ok[RUTA_POST]!),
      [RUTA_MI_SII]: (_l, n) => (n === 1 ? STUB : DATOS_OK),
    });
    expect(await codigoDe(g.sesionActiva(RUT))).toBe('CLAVE_RECHAZADA');
    expect(g.estado(RUT).bloqueado).toBe(true);
    expect(secretos.mapa.has(RUT)).toBe(false);
    expect(await codigoDe(g.sesionActiva(RUT))).toBe('RUT_BLOQUEADO_LOCAL');
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(1);
    await g.loginInteractivo(RUT, 'buena', false);
    expect(g.estado(RUT).bloqueado).toBe(false);
  });

  describe('códigos de error del login', () => {
    const SESIONES_MAXIMAS = paginaErrorLogin(CODIGO_SESIONES_MAXIMAS, 'Ha superado el máximo de sesiones simultáneas permitidas.');

    it('sesiones máximas no bloquea el RUT ni borra la clave, y la llamada siguiente intenta una vez más', async () => {
      const secretos = new SecretosEnMemoria();
      secretos.mapa.set(RUT, 'buena');
      const ok = rutasLoginOk();
      let agotadas = true;
      const { g, llamadas } = gestor(dirTemporal(), secretos, {
        ...ok,
        [RUTA_POST]: () => (agotadas ? SESIONES_MAXIMAS : ok[RUTA_POST]!),
        [RUTA_MI_SII]: (l) => (l.headers['Cookie']?.includes('TOKEN=') ? DATOS_OK : STUB),
      });
      const posts = () => llamadas.filter((l) => l.method === 'POST').length;
      expect(await codigoDe(g.sesionActiva(RUT))).toBe('SII_SESIONES_MAXIMAS');
      expect(posts()).toBe(1);
      expect(g.estado(RUT).bloqueado).toBe(false);
      expect(secretos.mapa.get(RUT)).toBe('buena');
      expect(await codigoDe(g.sesionActiva(RUT))).toBe('SII_SESIONES_MAXIMAS');
      expect(posts()).toBe(2);
      agotadas = false;
      await g.sesionActiva(RUT);
      expect(posts()).toBe(3);
      expect(g.estado(RUT).tieneSesion).toBe(true);
    });

    it('sesiones máximas en un login interactivo no bloquea', async () => {
      const { g } = gestor(dirTemporal(), new SecretosEnMemoria(), { ...rutasLoginOk(), [RUTA_POST]: SESIONES_MAXIMAS });
      expect(await codigoDe(g.loginInteractivo(RUT, 'buena', true))).toBe('SII_SESIONES_MAXIMAS');
      expect(g.estado(RUT).bloqueado).toBe(false);
    });

    it('un código desconocido bloquea, borra la clave y guarda el código SII en el bloqueo', async () => {
      const dir = dirTemporal();
      const secretos = new SecretosEnMemoria();
      secretos.mapa.set(RUT, 'mala');
      const { g } = gestor(dir, secretos, { ...rutasLoginOk(), [RUTA_MI_SII]: STUB, [RUTA_POST]: paginaErrorLogin('99.99.999.999.999.99', 'Algo falló.') });
      expect(await codigoDe(g.sesionActiva(RUT))).toBe('CLAVE_RECHAZADA');
      expect(g.estado(RUT).bloqueado).toBe(true);
      expect(secretos.mapa.has(RUT)).toBe(false);
      expect(JSON.parse(readFileSync(join(dir, `${RUT}.bloqueo`), 'utf8'))).toMatchObject({ codigo: '99.99.999.999.999.99' });
    });

    it('la clave incorrecta guarda su código en el bloqueo', async () => {
      const dir = dirTemporal();
      const { g } = gestor(dir, new SecretosEnMemoria(), { ...rutasLoginOk(), [RUTA_POST]: paginaErrorClave() });
      expect(await codigoDe(g.loginInteractivo(RUT, 'mala', false))).toBe('CLAVE_RECHAZADA');
      expect(JSON.parse(readFileSync(join(dir, `${RUT}.bloqueo`), 'utf8'))).toMatchObject({ codigo: CODIGO_CLAVE_INCORRECTA });
    });
  });

  it('si el llavero falla, el login funciona igual e informa que la clave no se guardó', async () => {
    const secretos = new SecretosEnMemoria();
    secretos.fallarAlGuardar = true;
    const { g } = gestor(dirTemporal(), secretos, rutasLoginOk());
    const r = await g.loginInteractivo(RUT, 'secreta', true);
    expect(r.claveGuardada).toBe(false);
    expect(g.estado(RUT).tieneSesion).toBe(true);
  });

  it('logout borra la sesión local y opcionalmente la clave', async () => {
    const secretos = new SecretosEnMemoria();
    const { g } = gestor(dirTemporal(), secretos, rutasLoginOk());
    await g.loginInteractivo(RUT, 'secreta', true);
    await g.logout(RUT, true);
    expect(g.estado(RUT).tieneSesion).toBe(false);
    expect(secretos.mapa.has(RUT)).toBe(false);
  });

  it.each(['renovación', 'interactivo'])('logout impide resucitar una sesión con %s pendiente', async (tipo) => {
    const secretos = new SecretosEnMemoria();
    secretos.mapa.set(RUT, 'secreta');
    const postIniciado = pausa();
    const continuarPost = pausa();
    const { fetchFalso, llamadas } = crearFetchFalso({
      ...rutasLoginOk(),
      [RUTA_MI_SII]: (l) => l.headers['Cookie']?.includes('TOKEN=') ? DATOS_OK : STUB,
    });
    const fetchRetenido: typeof fetch = async (entrada, init) => {
      if (init?.method === 'POST') {
        postIniciado.liberar();
        await continuarPost.promesa;
      }
      return fetchFalso(entrada, init);
    };
    const g = new GestorSesiones(dirTemporal(), secretos, { fetch: fetchRetenido, temporizador: sinEsperas });
    const operacion = tipo === 'renovación' ? g.sesionActiva(RUT) : g.loginInteractivo(RUT, 'secreta', true);
    await postIniciado.promesa;
    const logout = g.logout('22.222.222-2', true);
    // Cede un turno para que logout avance mientras el POST sigue retenido.
    await new Promise<void>((resolve) => setImmediate(resolve));
    continuarPost.liberar();
    await Promise.all([operacion, logout]);
    expect(g.estado(RUT).tieneSesion).toBe(false);
    expect(secretos.mapa.has(RUT)).toBe(false);
    g.persistir(RUT);
    expect(g.estado(RUT).tieneSesion).toBe(false);
    expect(await codigoDe(g.sesionActiva(RUT))).toBe('SESION_REQUERIDA');
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(1);
    await g.loginInteractivo(RUT, 'posterior', false);
    expect(g.estado(RUT).tieneSesion).toBe(true);
  });

  it('logout espera el guardado de clave pendiente sin bloquear otros RUT', async () => {
    const guardadoIniciado = pausa();
    const continuarGuardado = pausa();
    class SecretosRetenidos extends SecretosEnMemoria {
      override async guardar(rut: string, clave: string): Promise<void> {
        guardadoIniciado.liberar();
        await continuarGuardado.promesa;
        await super.guardar(rut, clave);
      }
    }
    const secretos = new SecretosRetenidos();
    const { g, llamadas } = gestor(dirTemporal(), secretos, rutasLoginOk());
    const login = g.loginInteractivo(RUT, 'secreta', true);
    await guardadoIniciado.promesa;
    const logout = g.logout(RUT, true);
    await g.logout('11111111-1', true);
    expect(llamadas.some((l) => `${l.method} ${l.url}` === RUTA_LOGOUT)).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    continuarGuardado.liberar();
    await Promise.all([login, logout]);
    expect(secretos.mapa.has(RUT)).toBe(false);
    expect(g.estado(RUT).tieneSesion).toBe(false);
    g.persistir(RUT);
    expect(g.estado(RUT).tieneSesion).toBe(false);
  });

  it('el bloqueo por una clave rechazada prevalece sobre una sesión memorizada', async () => {
    const ok = rutasLoginOk();
    const { g, llamadas } = gestor(dirTemporal(), new SecretosEnMemoria(), {
      ...ok,
      [RUTA_POST]: (_l, n) => (n === 1 ? ok[RUTA_POST]! : paginaErrorClave()),
    });
    await g.loginInteractivo(RUT, 'buena', false);
    expect(await codigoDe(g.loginInteractivo(RUT, 'mala', false))).toBe('CLAVE_RECHAZADA');
    const solicitudesAntes = llamadas.length;
    expect(await codigoDe(g.sesionActiva(RUT))).toBe('RUT_BLOQUEADO_LOCAL');
    expect(llamadas).toHaveLength(solicitudesAntes);
  });

  it('renueva una sesión memorizada expirada una vez y reutiliza la nueva mientras sea válida', async () => {
    const { g, llamadas } = gestor(dirTemporal(), new SecretosEnMemoria(), {
      ...rutasLoginOk(),
      [RUTA_MI_SII]: (_l, n) => (n === 2 ? STUB : DATOS_OK),
    });
    await g.loginInteractivo(RUT, 'secreta', true);
    const renovada = await g.sesionActiva(RUT);
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(2);
    expect(await g.sesionActiva(RUT)).toBe(renovada);
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(2);
  });

  it('persistir conserva las cookies actualizadas sin escribir la clave en disco', async () => {
    const dir = dirTemporal();
    const secretos = new SecretosEnMemoria();
    const { g } = gestor(dir, secretos, rutasLoginOk());
    await g.loginInteractivo(RUT, 'clave-solo-en-memoria', true);
    const http = await g.sesionActiva(RUT);
    await http.jar.setCookie('TOKEN=renovado; Domain=.sii.cl; Path=/', 'https://www4.sii.cl/');
    g.persistir(RUT);
    const { g: siguiente, llamadas } = gestor(dir, secretos, { [RUTA_MI_SII]: DATOS_OK });
    await siguiente.sesionActiva(RUT);
    expect(llamadas[0]!.headers['Cookie']).toContain('TOKEN=renovado');
    expect(readdirSync(dir)).toEqual([`${RUT}.json`]);
    expect(readFileSync(join(dir, `${RUT}.json`), 'utf8')).not.toContain('clave-solo-en-memoria');
  });

  it('mantiene el bloqueo entre gestores aunque el llavero no pueda borrar la clave', async () => {
    class SecretosSinBorrado extends SecretosEnMemoria {
      override async borrar(): Promise<void> {
        throw new Error('llavero no disponible');
      }
    }
    const dir = dirTemporal();
    const secretos = new SecretosSinBorrado();
    secretos.mapa.set(RUT, 'mala');
    const { g, llamadas } = gestor(dir, secretos, { ...rutasLoginOk(), [RUTA_MI_SII]: STUB, [RUTA_POST]: paginaErrorClave() });
    expect(await codigoDe(g.sesionActiva(RUT))).toBe('CLAVE_RECHAZADA');
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(1);
    expect(secretos.mapa.has(RUT)).toBe(true);
    const { g: siguiente, llamadas: siguientes } = gestor(dir, secretos, rutasLoginOk());
    expect(await codigoDe(siguiente.sesionActiva(RUT))).toBe('RUT_BLOQUEADO_LOCAL');
    expect(siguientes).toHaveLength(0);
  });

  it('comparte el intento concurrente por RUT y no envía otra clave después del rechazo', async () => {
    const secretos = new SecretosEnMemoria();
    secretos.mapa.set(RUT, 'mala');
    const ok = rutasLoginOk();
    let aceptarClave = false;
    let g: GestorSesiones;
    const bloqueoEnPosts: boolean[] = [];
    const { fetchFalso, llamadas } = crearFetchFalso({
      ...ok,
      [RUTA_MI_SII]: (l) => (l.headers['Cookie']?.includes('TOKEN=') ? DATOS_OK : STUB),
      [RUTA_POST]: () => {
        bloqueoEnPosts.push(g.estado(RUT).bloqueado);
        return aceptarClave ? ok[RUTA_POST]! : paginaErrorClave();
      },
    });
    let liberarSegundoGet!: () => void;
    const segundoGetRetenido = new Promise<void>((resolve) => { liberarSegundoGet = resolve; });
    let paginasLogin = 0;
    const fetchConEspera: typeof fetch = async (entrada, init) => {
      if (String(entrada).includes('/InicioAutenticacion/IngresoRutClave.html')) {
        paginasLogin++;
        if (paginasLogin === 2) await segundoGetRetenido;
      }
      return fetchFalso(entrada, init);
    };
    g = new GestorSesiones(dirTemporal(), secretos, { fetch: fetchConEspera, temporizador: sinEsperas });
    const primera = codigoDe(g.sesionActiva(RUT));
    const segunda = codigoDe(g.sesionActiva('22.222.222-2'));
    const primerCodigo = await primera;
    liberarSegundoGet();
    expect([primerCodigo, await segunda]).toEqual(['CLAVE_RECHAZADA', 'CLAVE_RECHAZADA']);
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(1);
    expect(bloqueoEnPosts).toEqual([false]);
    expect(secretos.mapa.has(RUT)).toBe(false);
    const solicitudesAntes = llamadas.length;
    expect(await codigoDe(g.sesionActiva(RUT))).toBe('RUT_BLOQUEADO_LOCAL');
    expect(llamadas).toHaveLength(solicitudesAntes);

    aceptarClave = true;
    await g.loginInteractivo(RUT, 'buena', false);
    await g.sesionActiva(RUT);
    expect(g.estado(RUT).bloqueado).toBe(false);
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(2);
  });

  it('comparte la renovación concurrente exitosa y permite renovar otra vez si expira después', async () => {
    const secretos = new SecretosEnMemoria();
    secretos.mapa.set(RUT, 'secreta');
    const ok = rutasLoginOk();
    let expirada = false;
    const { g, llamadas } = gestor(dirTemporal(), secretos, {
      ...ok,
      [RUTA_MI_SII]: (l) => (!expirada && l.headers['Cookie']?.includes('TOKEN=') ? DATOS_OK : STUB),
      [RUTA_POST]: () => {
        expirada = false;
        return ok[RUTA_POST]!;
      },
    });
    const [primera, segunda] = await Promise.all([g.sesionActiva(RUT), g.sesionActiva('22.222.222-2')]);
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(1);
    expect(segunda).toBe(primera);

    expirada = true;
    await g.sesionActiva(RUT);
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(2);
  });

  it('toma la sesión nueva que otro proceso dejó en disco cuando la suya vence, sin llavero', async () => {
    // Fecha controlada: las dos sesiones deben distinguirse por `guardadaEn`, no por el reloj de la prueba.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const dir = dirTemporal();
      const secretosA = new SecretosEnMemoria();
      let vencida = false;
      const { g: a, llamadas } = gestor(dir, secretosA, {
        ...rutasLoginOk(),
        [RUTA_MI_SII]: (l) => {
          const cookie = l.headers['Cookie'] ?? '';
          return cookie.includes('TOKEN=tok456') || (!vencida && cookie.includes('TOKEN=')) ? DATOS_OK : STUB;
        },
      });
      vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
      await a.loginInteractivo(RUT, 'secreta', false);
      await a.sesionActiva(RUT);
      expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(1);

      // La sesión de A vence y otro proceso (terminal o interfaz web) entra de nuevo sobre la misma carpeta.
      vencida = true;
      vi.setSystemTime(new Date('2026-10-26T10:05:00Z'));
      const { g: b } = gestor(dir, new SecretosEnMemoria(), rutasLoginOk('22222222', '2', 'EMPRESA DEMO SPA', 'tok456'));
      await b.loginInteractivo(RUT, 'secreta', false);

      const renovada = await a.sesionActiva(RUT);
      expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(1);
      expect(secretosA.mapa.size).toBe(0);
      expect(llamadas.at(-1)!.headers['Cookie']).toContain('TOKEN=tok456');
      expect(await a.sesionActiva(RUT)).toBe(renovada);
    } finally {
      vi.useRealTimers();
    }
  });

  it('con su sesión y la de otro proceso vencidas, entra con la clave del llavero y no vuelve a probar la ajena', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const dir = dirTemporal();
      const secretosA = new SecretosEnMemoria();
      secretosA.mapa.set(RUT, 'secreta');
      const ok = rutasLoginOk();
      // Cada login de A recibe un token propio (tokA1, tokA2…) y solo vale el que `vigente` indique; el de B (tokB) nunca vale.
      let vigente = 'tokA1';
      const { g: a, llamadas } = gestor(dir, secretosA, {
        ...ok,
        [RUTA_POST]: (_l, n) => ({ ...ok[RUTA_POST]!, headers: [...HTML, ['set-cookie', `TOKEN=tokA${n}; Domain=.sii.cl; Path=/`]] }),
        [RUTA_MI_SII]: (l) => (l.headers['Cookie']?.includes(`TOKEN=${vigente}`) ? DATOS_OK : STUB),
      });
      const posts = () => llamadas.filter((l) => l.method === 'POST').length;
      const consultasMiSii = () => llamadas.filter((l) => `${l.method} ${l.url.split('?')[0]}` === RUTA_MI_SII).length;
      const pruebasDeB = () => llamadas.filter((l) => l.headers['Cookie']?.includes('TOKEN=tokB')).length;

      vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
      await a.loginInteractivo(RUT, 'secreta', false);
      expect(posts()).toBe(1);

      // La sesión de A vence y otro proceso entra de nuevo sobre la misma carpeta, con una sesión que también está vencida.
      vigente = 'tokA2';
      vi.setSystemTime(new Date('2026-10-26T10:05:00Z'));
      const { g: b } = gestor(dir, new SecretosEnMemoria(), rutasLoginOk('22222222', '2', 'EMPRESA DEMO SPA', 'tokB'));
      await b.loginInteractivo(RUT, 'secreta', false);

      vi.setSystemTime(new Date('2026-10-26T10:10:00Z'));
      const antes = consultasMiSii();
      await a.sesionActiva(RUT);
      // Prueba la suya, prueba la de B una vez y, como ninguna sirve, entra con la clave del llavero (un solo POST).
      expect(posts()).toBe(2);
      expect(pruebasDeB()).toBe(1);
      expect(consultasMiSii() - antes).toBe(3);
      expect(llamadas.at(-1)!.headers['Cookie']).toContain('TOKEN=tokA2');
      expect(secretosA.mapa.get(RUT)).toBe('secreta');

      // La sesión nueva también vence: la llamada siguiente prueba solo la de memoria; el archivo de B ya no existe ni se reprueba.
      vigente = 'tokA3';
      vi.setSystemTime(new Date('2026-10-26T10:15:00Z'));
      const antesSiguiente = consultasMiSii();
      await a.sesionActiva(RUT);
      expect(posts()).toBe(3);
      expect(pruebasDeB()).toBe(1);
      expect(consultasMiSii() - antesSiguiente).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('si el archivo en disco es el mismo que venció, exige login sin reintentarlo', async () => {
    let vencida = false;
    const { g, llamadas } = gestor(dirTemporal(), new SecretosEnMemoria(), {
      ...rutasLoginOk(),
      [RUTA_MI_SII]: () => (vencida ? STUB : DATOS_OK),
    });
    await g.loginInteractivo(RUT, 'secreta', false);
    vencida = true;
    const consultasMiSii = () => llamadas.filter((l) => `${l.method} ${l.url.split('?')[0]}` === RUTA_MI_SII).length;
    const antes = consultasMiSii();
    expect(await codigoDe(g.sesionActiva(RUT))).toBe('SESION_REQUERIDA');
    expect(consultasMiSii() - antes).toBe(1);
    // Una segunda consulta vuelve a probar solo la sesión en memoria, no el archivo ya descartado.
    expect(await codigoDe(g.sesionActiva(RUT))).toBe('SESION_REQUERIDA');
    expect(consultasMiSii() - antes).toBe(2);
  });
});
