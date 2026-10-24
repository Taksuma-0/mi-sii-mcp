import { ErrorImpuestocl } from '../../domain/errores.js';
import { formatearRut, parseRut, type Rut } from '../../domain/rut.js';
import type { IdentidadSii } from '../../ports/index.js';
import { exigirSesion, HOST_LOGIN, type ClienteHttp } from './http.js';

export const URL_MI_SII = 'https://misiir.sii.cl/cgi_misii/siihome.cgi';
export const URL_LOGIN_PAGINA = `https://${HOST_LOGIN}/AUT2000/InicioAutenticacion/IngresoRutClave.html?${URL_MI_SII}`;
export const URL_LOGIN_POST = `https://${HOST_LOGIN}/cgi_AUT2000/CAutInicio.cgi`;
export const URL_LOGOUT = `https://${HOST_LOGIN}/cgi_AUT2000/autTermino.cgi`;
export const CODIGO_CLAVE_INCORRECTA = '01.01.203.500.720.20';

/** La página de error del login termina con "El código de este mensaje es <código>". */
export function extraerErrorLogin(html: string): { codigo: string | null; mensaje: string } | null {
  const texto = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = /El c.{1,2}digo de este mensaje es\s*([\d.]+\d)/i.exec(texto);
  if (!m) return null;
  return { codigo: m[1] ?? null, mensaje: texto.slice(0, m.index).trim().slice(-300).trim() };
}

/** Extrae el literal JSON asignado a `DatosCntrNow`, respetando llaves dentro de strings. */
export function extraerDatosCntrNow(html: string): Record<string, unknown> | null {
  const posicion = html.search(/DatosCntrNow\s*=\s*\{/);
  if (posicion < 0) return null;
  const inicio = html.indexOf('{', posicion);
  let profundidad = 0;
  let comilla: string | null = null;
  let escapado = false;
  for (let i = inicio; i < html.length; i++) {
    const c = html[i]!;
    if (comilla) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === comilla) comilla = null;
      continue;
    }
    if (c === '"' || c === "'") {
      comilla = c;
      continue;
    }
    if (c === '{') profundidad++;
    else if (c === '}') {
      profundidad--;
      if (profundidad === 0) {
        try {
          return JSON.parse(html.slice(inicio, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const textoNoVacio = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function identidadDesde(datos: Record<string, unknown>): IdentidadSii {
  const contribuyente = datos['contribuyente'];
  if (typeof contribuyente !== 'object' || contribuyente === null || Array.isArray(contribuyente)) {
    throw new ErrorImpuestocl('PORTAL_CAMBIO', 'El SII entregó datos del contribuyente con una estructura inválida.');
  }
  const c = contribuyente as Record<string, unknown>;
  const cuerpo = c['rut'];
  const dv = c['dv'];
  if ((typeof cuerpo !== 'string' && typeof cuerpo !== 'number') || (typeof dv !== 'string' && typeof dv !== 'number') || String(dv).length !== 1) {
    throw new ErrorImpuestocl('PORTAL_CAMBIO', 'El SII entregó un RUT o dígito verificador inválido.');
  }
  let rut: string;
  try {
    rut = parseRut(`${cuerpo}-${dv}`).canonico;
  } catch (cause) {
    throw new ErrorImpuestocl('PORTAL_CAMBIO', 'El SII entregó un RUT o dígito verificador inválido.', { cause });
  }
  const razonSocial = textoNoVacio(c['razonSocial']);
  const nombre =
    razonSocial ??
    [c['nombres'], c['apellidoPaterno'], c['apellidoMaterno']]
      .map(textoNoVacio)
      .filter((x): x is string => x !== null)
      .join(' ');
  return { rut, nombre, razonSocial, tipo: razonSocial ? 'empresa' : 'persona' };
}

export async function leerIdentidad(http: ClienteHttp): Promise<IdentidadSii> {
  const r = exigirSesion(await http.solicitar(URL_MI_SII));
  const datos = extraerDatosCntrNow(r.texto);
  if (!datos) throw new ErrorImpuestocl('SESION_REQUERIDA', 'El SII no entregó los datos del contribuyente; la sesión no está activa.');
  return identidadDesde(datos);
}

/** Un solo intento: el SII bloquea la cuenta tras varias claves erróneas. */
export async function iniciarSesion(http: ClienteHttp, rut: Rut, clave: string): Promise<IdentidadSii> {
  await http.solicitar(URL_LOGIN_PAGINA);
  const formulario = new URLSearchParams({
    rut: String(rut.cuerpo),
    dv: rut.dv,
    referencia: URL_MI_SII,
    '411': '',
    rutcntr: formatearRut(rut),
    clave,
  });
  const r = await http.solicitar(URL_LOGIN_POST, {
    method: 'POST',
    reintentar: false,
    reenviarPostEnRedireccion: false,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: `https://${HOST_LOGIN}`, Referer: URL_LOGIN_PAGINA },
    body: formulario.toString(),
  });
  const error = extraerErrorLogin(r.texto);
  if (error) {
    throw new ErrorImpuestocl('CLAVE_RECHAZADA', error.mensaje || 'El SII rechazó el inicio de sesión.', { detalle: { codigo: error.codigo } });
  }
  if (!(await http.cookie('https://www4.sii.cl/', 'TOKEN'))) {
    throw new ErrorImpuestocl('PORTAL_CAMBIO', 'El SII no entregó la cookie de sesión TOKEN después del login.');
  }
  const identidad = await leerIdentidad(http);
  if (identidad.rut !== rut.canonico) {
    throw new ErrorImpuestocl('PORTAL_CAMBIO', `El SII devolvió la identidad ${identidad.rut} en vez de ${rut.canonico}.`);
  }
  return identidad;
}

export async function cerrarSesion(http: ClienteHttp): Promise<void> {
  try {
    await http.solicitar(URL_LOGOUT, { reintentar: false });
  } catch {
    // best-effort: si falla, igual se borra la sesión local
  }
}
