import { ErrorImpuestocl } from '../../domain/errores.js';
import type { Periodo } from '../../domain/periodo.js';
import { parseRut, type Rut } from '../../domain/rut.js';
import type { BoletaHonorarios, InformeBhe } from '../../domain/tipos.js';
import type { SumideroRespuestas } from '../../ports/index.js';
import { exigirSesion, type Http } from './http.js';

const URL_INFORME = 'https://loa.sii.cl/cgi_IMT/TMBCOC_InformeMensualBheRec.cgi';
const SUPERFICIE = 'bhe.recibidas.mensual';
/** Tope de páginas por mes: el SII repite la última página en vez de responder vacío, así que nunca se pide sin fin. */
export const MAX_PAGINAS_BHE = 50;

/** Valor de una asignación JS: texto entre comillas, `formatMiles("…", '.')` o un literal sin comillas. */
const VALOR = String.raw`(?:formatMiles\(\s*(?:"([^"\n]*)"|'([^'\n]*)')\s*,\s*['"][^'"\n]*['"]\s*\)|"([^"\n]*)"|'([^'\n]*)'|([^;\n]*?))\s*(?:;|(?=\r?\n)|$)`;
const ASIGNACION_FILA = new RegExp(String.raw`arr_informe_mensual\s*\[\s*['"]([A-Za-z_]+?)_(\d+)['"]\s*\]\s*=\s*${VALOR}`, 'g');
const ASIGNACION_XML = new RegExp(String.raw`xml_values\s*\[\s*['"]([A-Za-z_]+)['"]\s*\]\s*=\s*${VALOR}`, 'g');

/** Asignaciones que no se guardan como evidencia: código de barras y comuna de cada boleta, y el nombre del contribuyente. */
const ASIGNACIONES_PRIVADAS = new RegExp(
  String.raw`(?:arr_informe_mensual\s*\[\s*['"](?:codigobarras|cod_comuna)_\d+['"]\s*\]|xml_values\s*\[\s*['"]nombre_contribuyente['"]\s*\])\s*=\s*${VALOR}`,
  'g',
);
const RESTO_PRIVADO = /codigobarras_\d|cod_comuna_\d|nombre_contribuyente/;

const valorDe = (m: RegExpExecArray, desde: number): string => (m[desde] ?? m[desde + 1] ?? m[desde + 2] ?? m[desde + 3] ?? m[desde + 4] ?? '').trim();

/**
 * Evidencia de una página del informe: quita las asignaciones de `codigobarras_N`, `cod_comuna_N` y
 * `xml_values['nombre_contribuyente']`. Si alguna de esas claves sigue en el texto (otra sintaxis), lanza
 * PORTAL_CAMBIO: nunca se guarda sin sanear.
 */
export function sanearBhe(html: string): string {
  const saneado = html.replace(ASIGNACIONES_PRIVADAS, '');
  if (RESTO_PRIVADO.test(saneado)) {
    throw new ErrorImpuestocl('PORTAL_CAMBIO', 'No se pudo sanear la evidencia de las boletas de honorarios recibidas.');
  }
  return saneado;
}

interface PaginaBhe {
  readonly filas: ReadonlyMap<number, Readonly<Record<string, string>>>;
  readonly xml: Readonly<Record<string, string>>;
}

function leerPagina(html: string): PaginaBhe {
  const filas = new Map<number, Record<string, string>>();
  for (const m of html.matchAll(ASIGNACION_FILA)) {
    const n = Number(m[2]);
    const fila = filas.get(n) ?? {};
    fila[m[1]!] = valorDe(m, 3);
    filas.set(n, fila);
  }
  const xml: Record<string, string> = {};
  for (const m of html.matchAll(ASIGNACION_XML)) xml[m[1]!] = valorDe(m, 2);
  if (filas.size === 0 && Object.keys(xml).length === 0) {
    throw new ErrorImpuestocl('PORTAL_CAMBIO', 'El informe de boletas de honorarios recibidas no trae los datos esperados (arr_informe_mensual ni xml_values).');
  }
  return { filas, xml };
}

/** Monto entero en pesos; vacío vale 0 y acepta el punto de miles. null si no es un número. */
function monto(v: string | undefined): number | null {
  const t = (v ?? '').replace(/\./g, '').trim();
  if (t === '') return 0;
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

/** `DD/MM/AAAA` → `AAAA-MM-DD`; vacío o ilegible → null. */
function fecha(v: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function inesperado(detalle: string): ErrorImpuestocl {
  return new ErrorImpuestocl('PORTAL_CAMBIO', `Boleta de honorarios inesperada en el informe del SII: ${detalle}.`);
}

function boleta(rut: Rut, periodo: Periodo, f: Readonly<Record<string, string>>): BoletaHonorarios {
  const folio = monto(f['nroboleta']);
  if (folio === null || folio <= 0) throw inesperado(`número de boleta "${f['nroboleta'] ?? ''}"`);
  let rutEmisor: string;
  try {
    rutEmisor = parseRut(`${f['rutemisor'] ?? ''}-${f['dvemisor'] ?? ''}`).canonico;
  } catch {
    throw inesperado(`RUT del emisor de la boleta ${folio}`);
  }
  const montoDe = (campo: string): number => {
    const valor = monto(f[campo]);
    if (valor === null) throw inesperado(`${campo} de la boleta ${folio}`);
    return valor;
  };
  const anulada = (f['estado'] ?? '').toUpperCase() === 'S';
  const nombre = (f['nombre_emisor'] ?? '').trim();
  return {
    rut: rut.canonico,
    periodo: periodo.texto,
    rutEmisor,
    folio,
    nombreEmisor: nombre === '' ? null : nombre,
    fecha: fecha(f['fecha_boleta']),
    bruto: montoDe('totalhonorarios'),
    retencion: montoDe('retencion_receptor'),
    liquido: montoDe('honorariosliquidos'),
    sociedadProfesional: (f['es_soc_profesional'] ?? '').toUpperCase() === 'SI',
    anulada,
    fechaAnulacion: anulada ? fecha(f['fechaanulacion']) : null,
  };
}

async function pedirPagina(http: Http, sumidero: SumideroRespuestas, rut: Rut, periodo: Periodo, pagina: number): Promise<PaginaBhe> {
  const parametros = {
    rut_arrastre: String(rut.cuerpo),
    dv_arrastre: rut.dv,
    cbanoinformemensual: String(periodo.anio),
    cbmesinformemensual: String(periodo.mes).padStart(2, '0'),
    pagina_solicitada: pagina,
  };
  const consulta = new URLSearchParams(Object.entries(parametros).map(([k, v]) => [k, String(v)]));
  const r = exigirSesion(await http.solicitar(`${URL_INFORME}?${consulta.toString()}`, { headers: { Accept: 'text/html,application/xhtml+xml,*/*' } }));
  if (r.status === 401) throw new ErrorImpuestocl('SESION_REQUERIDA', 'El SII no reconoció la sesión (401).');
  if (r.status === 429) throw new ErrorImpuestocl('SII_NO_DISPONIBLE', 'El SII limitó las consultas; reintenta más tarde.');
  sumidero({ superficie: SUPERFICIE, parametros, cuerpo: sanearBhe(r.texto), obtenidoEn: new Date().toISOString() });
  if (r.status === 403) throw new ErrorImpuestocl('SII_RECHAZO', `El SII rechazó la consulta de ${SUPERFICIE} (403).`);
  return leerPagina(r.texto);
}

/**
 * Informe mensual de boletas de honorarios electrónicas recibidas: pide páginas (desde la 0) hasta juntar
 * `total_boletas` boletas distintas (por emisor y folio), hasta que una página no agregue ninguna nueva (el SII repite
 * la última) o hasta `MAX_PAGINAS_BHE`. Si faltan boletas, DATOS_INCOMPLETOS. Devuelve null si el SII respondió sin
 * boletas ni `total_boletas` (vacío ambiguo); con `total_boletas` 0 es un mes sin boletas.
 */
export async function bheRecibidas(http: Http, sumidero: SumideroRespuestas, rut: Rut, periodo: Periodo): Promise<InformeBhe | null> {
  const boletas = new Map<string, BoletaHonorarios>();
  let primera: PaginaBhe | null = null;
  let total: number | null = null;
  for (let pagina = 0; pagina < MAX_PAGINAS_BHE; pagina++) {
    const leida = await pedirPagina(http, sumidero, rut, periodo, pagina);
    if (primera === null) {
      primera = leida;
      const informado = leida.xml['total_boletas'];
      total = informado === undefined ? null : monto(informado);
      if (informado !== undefined && total === null) throw new ErrorImpuestocl('PORTAL_CAMBIO', `El SII informó un total de boletas ilegible: "${informado}".`);
    }
    let nuevas = 0;
    for (const fila of leida.filas.values()) {
      const b = boleta(rut, periodo, fila);
      const clave = `${b.rutEmisor}:${b.folio}`;
      if (boletas.has(clave)) continue;
      boletas.set(clave, b);
      nuevas++;
    }
    if (total === null) break;
    if (boletas.size >= total || nuevas === 0) break;
  }
  if (total === null) {
    if (boletas.size === 0) return null;
    throw new ErrorImpuestocl('PORTAL_CAMBIO', `Boletas de honorarios ${periodo.texto}: el SII no informó total_boletas; no se puede saber si están todas.`);
  }
  if (boletas.size < total) {
    throw new ErrorImpuestocl('DATOS_INCOMPLETOS', `Boletas de honorarios ${periodo.texto}: el SII entregó ${boletas.size} de ${total} boletas.`);
  }
  const xml = primera?.xml ?? {};
  const suma = (clave: string): number => monto(xml[clave]) ?? 0;
  return {
    boletas: [...boletas.values()],
    totales: { total, bruto: suma('suma_honorarios'), retencion: suma('suma_retencion_receptor'), liquido: suma('suma_liquido') },
  };
}
