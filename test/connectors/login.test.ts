import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { extraerDatosCntrNow, extraerErrorLogin, iniciarSesion, leerIdentidad } from '../../src/connectors/sii/login.js';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { parseRut } from '../../src/domain/rut.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, HTML, sinEsperas } from '../helpers/http-falso.js';
import { PAGINA_STUB, paginaDatosCntr, paginaErrorClave, RUTA_MI_SII, RUTA_POST, rutasLoginOk } from '../helpers/sii-login.js';

const cliente = (fetchFalso: typeof fetch) => new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });

describe('iniciarSesion', () => {
  it('envía el formulario del SII y devuelve la identidad de la empresa', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso(rutasLoginOk());
    const identidad = await iniciarSesion(cliente(fetchFalso), parseRut('22.222.222-2'), 'secreta');
    expect(identidad).toEqual({ rut: '22222222-2', nombre: 'EMPRESA DEMO SPA', razonSocial: 'EMPRESA DEMO SPA', tipo: 'empresa' });
    const post = llamadas.find((l) => l.method === 'POST')!;
    const form = new URLSearchParams(post.body);
    expect(form.get('rut')).toBe('22222222');
    expect(form.get('dv')).toBe('2');
    expect(form.get('rutcntr')).toBe('22.222.222-2');
    expect(form.get('clave')).toBe('secreta');
    expect(form.get('411')).toBe('');
    expect(post.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('reconoce a una persona natural', async () => {
    const { fetchFalso } = crearFetchFalso(rutasLoginOk('11111111', '1', null));
    const identidad = await iniciarSesion(cliente(fetchFalso), parseRut('11111111-1'), 'x');
    expect(identidad).toEqual({ rut: '11111111-1', nombre: 'JUANA PÉREZ', razonSocial: null, tipo: 'persona' });
  });

  it('una clave incorrecta (página ISO-8859-1) es CLAVE_RECHAZADA con su código, sin reintento', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({ ...rutasLoginOk(), [RUTA_POST]: paginaErrorClave() });
    let error: unknown;
    try {
      await iniciarSesion(cliente(fetchFalso), parseRut('22222222-2'), 'mala');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorImpuestocl);
    expect((error as ErrorImpuestocl).codigo).toBe('CLAVE_RECHAZADA');
    expect((error as ErrorImpuestocl).message).toContain('no es correcta');
    expect((error as ErrorImpuestocl).detalle).toEqual({ codigo: '01.01.203.500.720.20' });
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(1);
  });

  it('sin cookie TOKEN tras el login es PORTAL_CAMBIO', async () => {
    const { fetchFalso } = crearFetchFalso({ ...rutasLoginOk(), [RUTA_POST]: { headers: HTML, body: '<html></html>' } });
    expect(await codigoDe(iniciarSesion(cliente(fetchFalso), parseRut('22222222-2'), 'x'))).toBe('PORTAL_CAMBIO');
  });

  it.each([307, 308])('no reenvía la clave tras un %s y libera el cuerpo rechazado', async (status) => {
    const { fetchFalso, llamadas } = crearFetchFalso(rutasLoginOk());
    let posts = 0;
    let cancelados = 0;
    const fetchConRedireccion: typeof fetch = async (entrada, init) => {
      if (init?.method === 'POST' && ++posts === 1) {
        return new Response(new ReadableStream({ cancel: () => { cancelados++; } }), {
          status,
          headers: { location: '/cgi_AUT2000/CAutInicio.cgi' },
        });
      }
      return fetchFalso(entrada, init);
    };
    let error: unknown;
    try {
      await iniciarSesion(cliente(fetchConRedireccion), parseRut('22222222-2'), 'clave-sintetica-no-reenviar');
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ codigo: 'PORTAL_CAMBIO' });
    expect(String(error)).not.toContain('clave-sintetica-no-reenviar');
    expect(posts).toBe(1);
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(0);
    expect(cancelados).toBe(1);
  });

  it.each([302, 303])('permite continuar por GET tras un %s del login', async (status) => {
    const ok = rutasLoginOk();
    const { fetchFalso, llamadas } = crearFetchFalso({
      ...ok,
      [RUTA_POST]: { ...ok[RUTA_POST], status, headers: [...ok[RUTA_POST]!.headers!, ['location', '/continuar']] },
      'GET https://zeusr.sii.cl/continuar': { headers: HTML },
    });
    expect((await iniciarSesion(cliente(fetchFalso), parseRut('22222222-2'), 'x')).rut).toBe('22222222-2');
    expect(llamadas.filter((l) => l.method === 'POST')).toHaveLength(1);
    expect(llamadas.find((l) => l.url.endsWith('/continuar'))?.body).toBeUndefined();
  });

  it('si el SII devuelve otra identidad es PORTAL_CAMBIO', async () => {
    const { fetchFalso } = crearFetchFalso({ ...rutasLoginOk(), [RUTA_MI_SII]: { headers: HTML, body: paginaDatosCntr('11111111', '1', null) } });
    expect(await codigoDe(iniciarSesion(cliente(fetchFalso), parseRut('22222222-2'), 'x'))).toBe('PORTAL_CAMBIO');
  });
});

describe('leerIdentidad y extractores', () => {
  it('la página stub de sesión muerta es SESION_REQUERIDA', async () => {
    const { fetchFalso } = crearFetchFalso({ [RUTA_MI_SII]: { headers: HTML, body: PAGINA_STUB } });
    expect(await codigoDe(leerIdentidad(cliente(fetchFalso)))).toBe('SESION_REQUERIDA');
  });

  it('DatosCntrNow sin contribuyente es PORTAL_CAMBIO', async () => {
    const { fetchFalso } = crearFetchFalso({
      [RUTA_MI_SII]: { headers: HTML, body: '<script>var DatosCntrNow = {"codigoError":1};</script>' },
    });
    await expect(leerIdentidad(cliente(fetchFalso))).rejects.toMatchObject({ name: 'ErrorImpuestocl', codigo: 'PORTAL_CAMBIO' });
  });

  it.each([
    { etiqueta: 'null', contribuyente: null },
    { etiqueta: 'string', contribuyente: 'texto' },
    { etiqueta: 'array', contribuyente: [] },
  ])('contribuyente mal formado ($etiqueta) es PORTAL_CAMBIO', async ({ contribuyente }) => {
    const { fetchFalso } = crearFetchFalso({
      [RUTA_MI_SII]: { headers: HTML, body: `<script>var DatosCntrNow = ${JSON.stringify({ contribuyente })};</script>` },
    });
    await expect(leerIdentidad(cliente(fetchFalso))).rejects.toMatchObject({ name: 'ErrorImpuestocl', codigo: 'PORTAL_CAMBIO' });
  });

  it.each([
    ['22222222', '1'],
    ['22222222', ''],
    ['', '2'],
  ])('RUT/DV inválido del portal (%s, %s) es PORTAL_CAMBIO', async (rut, dv) => {
    const { fetchFalso } = crearFetchFalso({
      [RUTA_MI_SII]: { headers: HTML, body: paginaDatosCntr(rut, dv, 'EMPRESA DEMO SPA') },
    });
    await expect(leerIdentidad(cliente(fetchFalso))).rejects.toMatchObject({ name: 'ErrorImpuestocl', codigo: 'PORTAL_CAMBIO' });
  });

  it('extrae DatosCntrNow aunque haya llaves dentro de strings', () => {
    const datos = extraerDatosCntrNow(paginaDatosCntr('22222222', '2', 'EMPRESA DEMO SPA'));
    expect((datos?.['contribuyente'] as Record<string, unknown>)['glosaActividad']).toBe('texto con } llave');
    expect(extraerDatosCntrNow('<html>nada</html>')).toBeNull();
  });

  it('extraerErrorLogin devuelve null en páginas sin error', () => {
    expect(extraerErrorLogin('<html>Bienvenido</html>')).toBeNull();
  });
});
