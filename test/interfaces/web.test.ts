import { request, createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { crearServidorLocal, type ServidorLocal } from '../../src/interfaces/web/servidor.js';
import type { ResultadoVerificacion } from '../../src/interfaces/web/verificar.js';
import { iniciarLocal } from '../../scripts/abrir-local.js';

const entrada = { rut: '22222222-2', clave: 'clave ficticia', mes: '2026-09' };
const resultado: ResultadoVerificacion = { estado: 'completo', sincronizacion: 'Sincronización de prueba', resumen: 'Resumen de prueba', plazos: 'Sin plazos próximos.', codigosF29: { '538': 19000 } };
const cierres: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cerrar of cierres.splice(0)) await cerrar(); });

async function entorno(opciones: Parameters<typeof crearServidorLocal>[0] = {}) {
  const verificar = vi.fn(async () => resultado);
  const s = await crearServidorLocal({ puerto: 0, verificar, ...opciones });
  cierres.push(s.cerrar);
  const pagina = await fetch(s.url);
  const html = await pagina.text();
  const token = /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? '';
  const headers = { origin: s.url, 'x-csrf-token': token, 'content-type': 'application/json' };
  const post = (ruta = '/verificar', body = JSON.stringify(entrada), otros: Record<string, string> = {}) => fetch(s.url + ruta, { method: 'POST', headers: { ...headers, ...otros }, body });
  return { s, pagina, html, token, headers, post, verificar };
}

function peticionCruda(s: ServidorLocal, headers: Record<string, string>, body = JSON.stringify(entrada)) {
  return new Promise<number>((resolve, reject) => {
    const req = request(s.url + '/verificar', { method: 'POST', headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
    req.on('error', reject);
    req.end(body);
  });
}

describe('HTTP local', () => {
  it('sirve una página autónoma, accesible, pequeña y protegida con nonce', async () => {
    const e = await entorno({ ahora: () => new Date('2026-10-01T01:00:00Z') });
    expect(e.s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(e.pagina.status).toBe(200);
    expect(e.token).toMatch(/^[a-f0-9]{64}$/);
    expect(e.pagina.headers.get('cache-control')).toBe('no-store');
    expect(e.pagina.headers.get('x-content-type-options')).toBe('nosniff');
    expect(e.pagina.headers.get('referrer-policy')).toBe('no-referrer');
    const csp = e.pagina.headers.get('content-security-policy') ?? '';
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(e.html).toContain(`<script nonce="${nonce}">`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(e.html).toContain('value="2026-08"');
    expect(e.html).toContain('type="password"');
    expect(e.html).toContain('aria-live="polite"');
    expect(e.html).not.toMatch(/innerHTML|localStorage|sessionStorage|indexedDB|serviceWorker|https:\/\//);
    // Incluye cuatro flujos, el acceso con navegador y tablas nativas, sin dependencias ni recursos externos.
    expect(Buffer.byteLength(e.html)).toBeLessThanOrEqual(26 * 1024);
  });

  it('conecta sin mes y reserva las fechas y consultas para después de entrar', async () => {
    const { html } = await entorno();
    const acceso = /<form id="formulario"[^>]*>([\s\S]*?)<\/form>/.exec(html);
    expect(acceso?.[0]).toContain('action="/conectar"');
    expect(acceso?.[0]).toContain('method="post"');
    expect(acceso?.[1]?.match(/name="[^"]+"/g)).toEqual(['name="rut"', 'name="clave"']);
    expect(acceso?.[1]).not.toContain('type="month"');
    expect(html).toMatch(/<section id="espacio"[^>]*hidden/);
    for (const titulo of ['Vista general', 'Cargar historial', 'Cruzar RCV con F29', 'Explorar documentos']) expect(html).toContain(titulo);
    for (const ruta of ['/sincronizar', '/analizar', '/documentos']) expect(html).toContain(`action="${ruta}"`);
    for (const id of ['totales', 'filas-panorama', 'resultado-sync', 'resultado-analisis', 'resultado-documentos', 'documentos-anterior', 'documentos-siguiente', 'cambiar']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('Total declarado en F29');
    expect(html).toContain('Aún no has cargado datos');
  });

  it('ofrece entrar con el navegador (ClaveÚnica o clave) por su ruta protegida', async () => {
    const { html } = await entorno();
    const acceso = /<section id="acceso"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(acceso).toMatch(/<button id="entrar-navegador"[^>]*type="button"[^>]*>Entrar con el navegador \(ClaveÚnica o clave\)<\/button>/);
    expect(html).toContain("enviar('/conectar-navegador'");
  });

  it('mantiene el estado global visible fuera del acceso y no expone una acción automática de verificación', async () => {
    const { html } = await entorno();
    const acceso = /<section id="acceso"[\s\S]*?<\/section>/.exec(html)?.[0];
    expect(acceso).toBeTruthy();
    expect(acceso).not.toContain('id="estado"');
    expect(html).not.toContain("enviar('/verificar'");
    expect(html).not.toMatch(/<script[^>]*src=/);
    expect(html).not.toMatch(/innerHTML|localStorage|sessionStorage|indexedDB|serviceWorker/i);
  });

  it('ejecuta un envío explícito y devuelve sólo el resultado', async () => {
    const e = await entorno();
    const r = await e.post();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(resultado);
    expect(e.verificar).toHaveBeenCalledExactlyOnceWith(entrada);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it.each<Record<string, string>>([
    { origin: 'https://externo.invalid' },
    { origin: '' },
    { 'x-csrf-token': '' },
    { 'x-csrf-token': 'incorrecto' },
    { host: 'externo.invalid' },
    { 'content-type': 'text/plain' },
  ])('rechaza peticiones no confiables %j antes de verificar', async (otros) => {
    const e = await entorno();
    expect(await peticionCruda(e.s, { ...e.headers, ...otros })).toBeGreaterThanOrEqual(400);
    expect(e.verificar).not.toHaveBeenCalled();
  });

  it('rechaza también GET con Host ajeno', async () => {
    const e = await entorno();
    const codigo = await new Promise<number>((resolve, reject) => {
      const req = request(e.s.url, { headers: { host: 'externo.invalid' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
      req.on('error', reject); req.end();
    });
    expect(codigo).toBe(403);
  });

  it.each(['{', 'null', '[]', '{}', JSON.stringify({ ...entrada, clave: 4 }), JSON.stringify({ ...entrada, adicional: 'no' }), 'x'.repeat(16 * 1024 + 1)])('rechaza body inválido sin iniciar verificación (%#)', async (body) => {
    const e = await entorno();
    const r = await e.post('/verificar', body);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(e.verificar).not.toHaveBeenCalled();
  });

  it('no duplica login ni permite cierre durante una consulta', async () => {
    let terminar!: (r: ResultadoVerificacion) => void;
    let iniciada!: () => void;
    const inicio = new Promise<void>((resolve) => { iniciada = resolve; });
    const verificar = vi.fn(() => { if (verificar.mock.calls.length > 1) return Promise.resolve(resultado); iniciada(); return new Promise<ResultadoVerificacion>((resolve) => { terminar = resolve; }); });
    const e = await entorno({ verificar });
    const primera = e.post();
    await inicio;
    expect(await (await fetch(e.s.url + '/estado')).json()).toEqual({ aplicacion: 'impuestocl-local-v1', ocupado: true });
    expect((await e.post()).status).toBe(409);
    expect((await e.post('/cerrar', '{}')).status).toBe(409);
    terminar(resultado);
    expect((await primera).status).toBe(200);
    expect(verificar).toHaveBeenCalledOnce();
    expect((await e.post()).status).toBe(200);
  });

  it.each([new Error('clave ficticia'), new ErrorImpuestocl('CLAVE_RECHAZADA', 'clave ficticia', { accion: 'clave ficticia', cause: 'clave ficticia' })])('explica fallos sin reflejar secreto, stack ni error crudo (%#)', async (error) => {
    const e = await entorno({ verificar: async () => { throw error; } });
    const r = await e.post();
    const texto = await r.text();
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(texto).not.toContain(entrada.clave);
    expect(texto).not.toMatch(/stack|cause|Error:/);
    expect(JSON.parse(texto)).toMatchObject({ codigo: expect.any(String), mensaje: expect.any(String) });
  });

  it('el estado no contiene datos y el cierre exige protección', async () => {
    const e = await entorno();
    expect(await (await fetch(e.s.url + '/estado')).json()).toEqual({ aplicacion: 'impuestocl-local-v1', ocupado: false });
    expect((await fetch(e.s.url + '/cerrar', { method: 'POST' })).status).toBe(403);
    expect((await e.post('/cerrar', '{}')).status).toBe(200);
    await e.s.cerrado;
    await expect(fetch(e.s.url)).rejects.toThrow();
  });

  it('cierra por inactividad', async () => {
    const e = await entorno({ inactividadMs: 50 });
    await e.s.cerrado;
    await expect(fetch(e.s.url)).rejects.toThrow();
  });

  it('no corta una consulta aunque transcurra el plazo de inactividad', async () => {
    let terminar!: (r: ResultadoVerificacion) => void;
    let iniciada!: () => void;
    const inicio = new Promise<void>((resolve) => { iniciada = resolve; });
    const e = await entorno({ inactividadMs: 50, verificar: () => { iniciada(); return new Promise<ResultadoVerificacion>((resolve) => { terminar = resolve; }); } });
    const peticion = e.post();
    await inicio;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await (await fetch(e.s.url + '/estado')).json()).toMatchObject({ ocupado: true });
    terminar(resultado);
    expect((await peticion).status).toBe(200);
    await e.s.cerrado;
  });

  it('libera una lectura abortada sin iniciar login ni dejar el servidor ocupado', async () => {
    const e = await entorno();
    const req = request(e.s.url + '/verificar', { method: 'POST', headers: { ...e.headers, 'content-length': '1000' } });
    req.on('error', () => {});
    req.write('{');
    async function esperarEstado(ocupado: boolean) {
      for (let intento = 0; intento < 40; intento++) {
        const estado = await (await fetch(e.s.url + '/estado')).json() as { ocupado: boolean };
        if (estado.ocupado === ocupado) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error('El estado no cambió');
    }
    await esperarEstado(true);
    req.destroy();
    await esperarEstado(false);
    expect(e.verificar).not.toHaveBeenCalled();
    expect((await e.post()).status).toBe(200);
  });
});

describe('lanzador local', () => {
  it('reutiliza una instancia propia sin abrir otra', async () => {
    const e = await entorno();
    const abrir = vi.fn(async (_url: string) => {});
    const r = await iniciarLocal({ puerto: Number(new URL(e.s.url).port), abrir });
    expect(r.url).toBe(e.s.url);
    expect(r.servidor).toBeNull();
    expect(abrir).toHaveBeenCalledExactlyOnceWith(e.s.url);
  });

  it('elige puerto efímero si hay otra aplicación y respeta sinAbrir', async () => {
    const ajeno = createServer((_req, res) => res.end('{}'));
    await new Promise<void>((resolve) => ajeno.listen(0, '127.0.0.1', resolve));
    cierres.push(() => new Promise<void>((resolve, reject) => ajeno.close((error) => error ? reject(error) : resolve())));
    const direccion = ajeno.address();
    if (!direccion || typeof direccion === 'string') throw new Error('sin puerto');
    const abrir = vi.fn(async (_url: string) => {});
    const r = await iniciarLocal({ puerto: direccion.port, abrir, sinAbrir: true });
    if (r.servidor) cierres.push(r.servidor.cerrar);
    expect(r.url).not.toBe(`http://127.0.0.1:${direccion.port}`);
    expect(abrir).not.toHaveBeenCalled();
    expect(await (await fetch(r.url + '/estado')).json()).toMatchObject({ aplicacion: 'impuestocl-local-v1' });
  });

  it('cierra la instancia nueva si no logra abrir el navegador', async () => {
    let url = '';
    await expect(iniciarLocal({ puerto: 0, abrir: async (destino) => { url = destino; throw new Error('navegador no disponible'); } })).rejects.toThrow('navegador no disponible');
    await expect(fetch(url)).rejects.toThrow();
  });
});
