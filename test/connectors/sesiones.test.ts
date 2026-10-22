import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GestorSesiones } from '../../src/connectors/sii/sesiones.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, HTML, sinEsperas, type DefRespuesta, type RutaFalsa } from '../helpers/http-falso.js';
import { SecretosEnMemoria } from '../helpers/secretos.js';
import { PAGINA_STUB, paginaDatosCntr, paginaErrorClave, RUTA_MI_SII, RUTA_POST, rutasLoginOk } from '../helpers/sii-login.js';

const RUT = '22222222-2';
const DATOS_OK: DefRespuesta = { headers: HTML, body: paginaDatosCntr('22222222', '2', 'EMPRESA DEMO SPA') };
const STUB: DefRespuesta = { headers: HTML, body: PAGINA_STUB };
const dirTemporal = () => join(mkdtempSync(join(tmpdir(), 'impuestocl-')), 'sesiones');

function gestor(dir: string, secretos: SecretosEnMemoria, rutas: Record<string, RutaFalsa>) {
  const { fetchFalso, llamadas } = crearFetchFalso(rutas);
  return { g: new GestorSesiones(dir, secretos, { fetch: fetchFalso, temporizador: sinEsperas }), llamadas };
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

  it('con la sesión expirada y la clave guardada vuelve a entrar solo', async () => {
    const dir = dirTemporal();
    const secretos = new SecretosEnMemoria();
    await gestor(dir, secretos, rutasLoginOk()).g.loginInteractivo(RUT, 'secreta', true);
    const { g, llamadas } = gestor(dir, secretos, { ...rutasLoginOk(), [RUTA_MI_SII]: (_l, n) => (n === 1 ? STUB : DATOS_OK) });
    await g.sesionActiva(RUT);
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(1);
    expect(g.estado(RUT).tieneSesion).toBe(true);
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
});
