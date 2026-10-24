import { CookieJar } from 'tough-cookie';
import { describe, expect, it, vi } from 'vitest';
import { ClienteHttp, decodificar, esMuroLogin, exigirSesion, type RespuestaHttp } from '../../src/connectors/sii/http.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, HTML, sinEsperas, temporizadorFalso, type DefRespuesta } from '../helpers/http-falso.js';

const OK: DefRespuesta = { status: 200, body: '<html>ok</html>', headers: HTML };

describe('ClienteHttp', () => {
  it('envía a www4 las cookies que zeusr dejó para .sii.cl', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({
      'GET https://zeusr.sii.cl/a': { headers: [['set-cookie', 'TOKEN=abc; Domain=.sii.cl; Path=/']] },
      'POST https://www4.sii.cl/b': OK,
    });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    await http.solicitar('https://zeusr.sii.cl/a');
    await http.solicitar('https://www4.sii.cl/b', { method: 'POST', body: '{}' });
    expect(llamadas[1]!.headers['Cookie']).toContain('TOKEN=abc');
    expect(await http.cookie('https://www4.sii.cl/', 'TOKEN')).toBe('abc');
  });

  it('respeta el dominio de las cookies y devuelve null si no existen', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({
      'GET https://zeusr.sii.cl/a': { headers: [['set-cookie', 'LOCAL=abc; Path=/']] },
      'GET https://www4.sii.cl/b': OK,
    });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    await http.solicitar('https://zeusr.sii.cl/a');
    await http.solicitar('https://www4.sii.cl/b');
    expect(llamadas[1]!.headers['Cookie']).toBeUndefined();
    expect(await http.cookie('https://www4.sii.cl/', 'LOCAL')).toBeNull();
  });

  it('sigue redirecciones, pasa a GET tras un 302 y guarda las cookies de cada salto', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({
      'POST https://zeusr.sii.cl/login': {
        status: 302,
        headers: [
          ['location', 'https://misiir.sii.cl/home'],
          ['set-cookie', 'CSESSIONID=x; Domain=.sii.cl; Path=/'],
        ],
      },
      'GET https://misiir.sii.cl/home': OK,
    });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    const r = await http.solicitar('https://zeusr.sii.cl/login', { method: 'POST', body: 'a=1' });
    expect(r.url).toBe('https://misiir.sii.cl/home');
    expect(r.texto).toBe('<html>ok</html>');
    expect(llamadas[1]!.method).toBe('GET');
    expect(llamadas[1]!.body).toBeUndefined();
    expect(llamadas[1]!.headers['Cookie']).toContain('CSESSIONID=x');
  });

  it.each([307, 308])('conserva POST y body ante un %s con ubicación relativa', async (status) => {
    const { fetchFalso, llamadas } = crearFetchFalso({
      'POST https://www4.sii.cl/a': { status, headers: [['location', '/b']] },
      'POST https://www4.sii.cl/b': OK,
    });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    await http.solicitar('https://www4.sii.cl/a', { method: 'POST', body: 'a=1' });
    expect(llamadas[1]!.body).toBe('a=1');
  });

  it.each([
    { caso: 'continuar', location: '/final', codigo: null, saltos: 1 },
    { caso: 'sala de espera', location: 'https://salaespera.sii.cl/', codigo: 'SII_EN_ESPERA', saltos: 1 },
    { caso: 'exceso de saltos', location: '/inicio', codigo: 'PORTAL_CAMBIO', saltos: 10 },
  ])('libera el cuerpo de cada redirección al salir por $caso', async ({ location, codigo, saltos }) => {
    let cancelados = 0;
    let final: Response | undefined;
    const fetchFalso: typeof fetch = async (entrada) => {
      if (String(entrada).endsWith('/final')) {
        final = new Response('respuesta final');
        return final;
      }
      return new Response(new ReadableStream({ cancel: () => { cancelados++; } }), {
        status: 302,
        headers: { location },
      });
    };
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    const solicitud = http.solicitar('https://www4.sii.cl/inicio');
    if (codigo) expect(await codigoDe(solicitud)).toBe(codigo);
    else {
      expect((await solicitud).texto).toBe('respuesta final');
      expect(final?.bodyUsed).toBe(true);
    }
    expect(cancelados).toBe(saltos);
  });

  it('limita los saltos de redirección con PORTAL_CAMBIO', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({
      'GET https://www4.sii.cl/x': { status: 302, headers: [['location', '/x']] },
    });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    expect(await codigoDe(http.solicitar('https://www4.sii.cl/x'))).toBe('PORTAL_CAMBIO');
    expect(llamadas).toHaveLength(10);
  });

  it('la sala de espera del SII es SII_EN_ESPERA', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({
      'GET https://www4.sii.cl/x': { status: 302, headers: [['location', 'https://salaespera.sii.cl/?c=sii']] },
    });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    expect(await codigoDe(http.solicitar('https://www4.sii.cl/x'))).toBe('SII_EN_ESPERA');
    expect(llamadas).toHaveLength(1);
  });

  it('reintenta errores 5xx con espera creciente', async () => {
    const { fetchFalso } = crearFetchFalso({ 'GET https://www4.sii.cl/x': (_l, n) => (n <= 2 ? { status: 503 } : OK) });
    const { esperas, temporizador } = temporizadorFalso();
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador });
    const r = await http.solicitar('https://www4.sii.cl/x');
    expect(r.status).toBe(200);
    expect(esperas).toEqual([2000, 4000]);
  });

  it('tras agotar los reintentos lanza SII_NO_DISPONIBLE', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({ 'GET https://www4.sii.cl/x': { status: 500 } });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    expect(await codigoDe(http.solicitar('https://www4.sii.cl/x'))).toBe('SII_NO_DISPONIBLE');
    expect(llamadas).toHaveLength(3);
  });

  it('reintenta errores de red y luego lanza SII_NO_DISPONIBLE', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({
      'GET https://www4.sii.cl/x': () => {
        throw new TypeError('fetch failed');
      },
    });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    expect(await codigoDe(http.solicitar('https://www4.sii.cl/x'))).toBe('SII_NO_DISPONIBLE');
    expect(llamadas).toHaveLength(3);
  });

  it('no reintenta cuando reintentar es false', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({ 'POST https://zeusr.sii.cl/login': { status: 503 } });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    expect(await codigoDe(http.solicitar('https://zeusr.sii.cl/login', { method: 'POST', reintentar: false }))).toBe('SII_NO_DISPONIBLE');
    expect(llamadas).toHaveLength(1);
  });

  it('no reintenta errores de red cuando reintentar es false', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({
      'POST https://zeusr.sii.cl/login': () => { throw new TypeError('fetch failed'); },
    });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    expect(await codigoDe(http.solicitar('https://zeusr.sii.cl/login', { method: 'POST', reintentar: false }))).toBe('SII_NO_DISPONIBLE');
    expect(llamadas).toHaveLength(1);
  });

  it('devuelve los 4xx sin reintentarlos', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({ 'GET https://www4.sii.cl/x': { status: 403 } });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    expect((await http.solicitar('https://www4.sii.cl/x')).status).toBe(403);
    expect(llamadas).toHaveLength(1);
  });

  it('espera al menos 1 segundo entre requests', async () => {
    const { fetchFalso } = crearFetchFalso({ 'GET https://www4.sii.cl/x': OK });
    const { esperas, temporizador } = temporizadorFalso();
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador });
    await http.solicitar('https://www4.sii.cl/x');
    await http.solicitar('https://www4.sii.cl/x');
    expect(esperas).toEqual([1000]);
  });

  it('separa por 1000 ms los inicios de fetch de tres solicitudes simultáneas', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const inicios: number[] = [];
      const { fetchFalso } = crearFetchFalso({
        'GET https://www4.sii.cl/x': () => { inicios.push(Date.now()); return OK; },
      });
      const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso });
      const solicitudes = Promise.all([
        http.solicitar('https://www4.sii.cl/x'),
        http.solicitar('https://www4.sii.cl/x'),
        http.solicitar('https://www4.sii.cl/x'),
      ]);
      await vi.runAllTimersAsync();
      await solicitudes;
      expect(inicios).toEqual([0, 1000, 2000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('decodifica páginas ISO-8859-1', async () => {
    const latin1 = Uint8Array.from(Buffer.from('código', 'latin1'));
    expect(decodificar(latin1, 'text/html; charset=ISO-8859-1')).toBe('código');
    const { fetchFalso } = crearFetchFalso({ 'GET https://zeusr.sii.cl/x': { body: latin1, headers: [['content-type', 'text/html; charset=ISO-8859-1']] } });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });
    expect((await http.solicitar('https://zeusr.sii.cl/x')).texto).toBe('código');
  });

  it('usa UTF-8 si falta charset o el charset no es reconocido', () => {
    const bytes = new TextEncoder().encode('código');
    expect(decodificar(bytes, null)).toBe('código');
    expect(decodificar(bytes, 'text/html; charset=inexistente')).toBe('código');
  });
});

describe('muro de login', () => {
  const resp = (url: string, texto: string): RespuestaHttp => ({ status: 200, url, contentType: 'text/html', bytes: new Uint8Array(), texto });

  it('detecta la redirección a zeusr y la página stub con location.replace', () => {
    expect(esMuroLogin(resp('https://zeusr.sii.cl/AUT2000/x.html', ''))).toBe(true);
    const stub = "<html><script>location.replace('https://zeusr.sii.cl//AUT2000/InicioAutenticacion/IngresoRutClave.html?https://www4.sii.cl/x')</script></html>";
    expect(esMuroLogin(resp('https://misiir.sii.cl/cgi_misii/siihome.cgi', stub))).toBe(true);
    expect(esMuroLogin(resp('https://www4.sii.cl/x', '{"data":[]}'))).toBe(false);
  });

  it('exigirSesion lanza SESION_REQUERIDA en el muro', async () => {
    expect(await codigoDe(Promise.resolve().then(() => exigirSesion(resp('https://zeusr.sii.cl/x', ''))))).toBe('SESION_REQUERIDA');
  });

  it('exigirSesion devuelve la respuesta cuando hay sesión', () => {
    const r = resp('https://www4.sii.cl/x', '{"data":[]}');
    expect(exigirSesion(r)).toBe(r);
  });
});
