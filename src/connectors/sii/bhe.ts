import { ErrorImpuestocl } from '../../domain/errores.js';
import type { Periodo } from '../../domain/periodo.js';
import { parseRut, type Rut } from '../../domain/rut.js';
import type { BoletaHonorarios, InformeBhe } from '../../domain/tipos.js';
import type { SumideroRespuestas } from '../../ports/index.js';
import { exigirSesion, type Http } from './http.js';

const URL_RECIBIDAS = 'https://loa.sii.cl/cgi_IMT/TMBCOC_InformeMensualBheRec.cgi';
/** Tope de páginas por mes: el SII repite la última página en vez de responder vacío, así que nunca se pide sin fin. */
export const MAX_PAGINAS_BHE = 50;

/** Valor de una asignación JS: texto entre comillas, `formatMiles("…", '.')` o un literal sin comillas. */
export const VALOR = String.raw`(?:formatMiles\(\s*(?:"([^"\n]*)"|'([^'\n]*)')\s*,\s*['"][^'"\n]*['"]\s*\)|"([^"\n]*)"|'([^'\n]*)'|([^;\n]*?))\s*(?:;|(?=\r?\n)|$)`;
/** `=` de una asignación, no de una comparación (`==`, `===`). */
export const IGUAL = String.raw`\s*=(?!=)\s*`;
const ASIGNACION_FILA = new RegExp(String.raw`arr_informe_mensual\s*\[\s*['"]([A-Za-z_]+?)_(\d+)['"]\s*\]${IGUAL}${VALOR}`, 'g');
const ASIGNACION_XML = new RegExp(String.raw`xml_values\s*\[\s*['"]([A-Za-z_]+)['"]\s*\]${IGUAL}${VALOR}`, 'g');

/**
 * Claves que no se guardan como evidencia: código de barras y comuna de cada boleta, el nombre del contribuyente y, en
 * las emitidas, la identidad del emisor (el propio contribuyente) y el correo del receptor.
 */
const CLAVES_PRIVADAS = String.raw`(?:codigobarras_\d+|cod_comuna_\d+|usuemisor_\d+|email_envio_\d+|nombre_contribuyente)`;
const CLAVE_PRIVADA = String.raw`\[\s*['"]${CLAVES_PRIVADAS}['"]\s*\]`;
/**
 * Asignación completa de una clave privada. A diferencia de `VALOR`, un valor vacío solo se acepta si lo cierra un `;`:
 * así un valor en la línea siguiente no queda suelto tras quitar la asignación.
 */
const ASIGNACIONES_PRIVADAS = new RegExp(
  String.raw`(?:arr_informe_mensual|xml_values)\s*${CLAVE_PRIVADA}${IGUAL}(?:(?:formatMiles\([^)\n]*\)|"[^"\n]*"|'[^'\n]*'|[^;\s][^;\n]*?)\s*(?:;|(?=\r?\n)|$)|;)`,
  'g',
);
/**
 * Una asignación de una clave privada que no se pudo quitar. Las lecturas (`x = xml_values['nombre_contribuyente']`,
 * `arr_informe_mensual['codigobarras_' + i]`) no cuentan: la página real las tiene y no traen el dato.
 */
const ASIGNACION_PRIVADA_RESTANTE = new RegExp(String.raw`${CLAVE_PRIVADA}\s*=(?!=)|\b${CLAVES_PRIVADAS}\b['"]?\s*(?::|=(?!=))`);

/** Texto del valor capturado por `VALOR`, que empieza en el grupo `desde`; vacío si no vino. */
export const valorDe = (m: RegExpExecArray, desde: number): string => (m[desde] ?? m[desde + 1] ?? m[desde + 2] ?? m[desde + 3] ?? m[desde + 4] ?? '').trim();

/**
 * Evidencia de una página de un informe de boletas: quita las asignaciones de las claves privadas (`codigobarras_N`,
 * `cod_comuna_N`, `usuemisor_N`, `email_envio_N` y `xml_values['nombre_contribuyente']`); sus lecturas en otras partes del
 * script se quedan. Si queda alguna asignación de esas claves (otra sintaxis), lanza PORTAL_CAMBIO: nunca se guarda sin
 * sanear. `informe` solo nombra lo que se saneaba en el mensaje de error.
 */
export function sanearBhe(html: string, informe = 'las boletas de honorarios recibidas'): string {
  const saneado = html.replace(ASIGNACIONES_PRIVADAS, '');
  if (ASIGNACION_PRIVADA_RESTANTE.test(saneado)) {
    throw new ErrorImpuestocl('PORTAL_CAMBIO', `No se pudo sanear la evidencia de ${informe}.`);
  }
  return saneado;
}

type Campos = Readonly<Record<string, string>>;

interface PaginaBhe {
  readonly filas: ReadonlyMap<number, Campos>;
  readonly xml: Campos;
}

function leerPagina(html: string, nombre: string): PaginaBhe {
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
    throw new ErrorImpuestocl('PORTAL_CAMBIO', `El informe de ${nombre} no trae los datos esperados (arr_informe_mensual ni xml_values).`);
  }
  return { filas, xml };
}

/** Entero no negativo con punto de miles opcional; ausente, vacío o ilegible → null (nunca 0 por omisión). */
export function entero(v: string | undefined): number | null {
  const t = (v ?? '').trim();
  return /^\d[\d.]*$/.test(t) ? Number(t.replace(/\./g, '')) : null;
}

/** `estado` del SII: N vigente, S anulada. */
const ESTADOS: Readonly<Record<string, boolean>> = { N: false, S: true };

/** `DD/MM/AAAA` → `AAAA-MM-DD`; vacío o ilegible → null. */
function fecha(v: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function inesperado(detalle: string): ErrorImpuestocl {
  return new ErrorImpuestocl('PORTAL_CAMBIO', `Boleta de honorarios inesperada en el informe del SII: ${detalle}.`);
}

/** Lo común de una fila ya revisada: folio, estado y lectores de montos, RUT, fechas y textos. */
export interface FilaBoleta {
  readonly folio: number;
  readonly anulada: boolean;
  /** Monto obligatorio: ilegible es PORTAL_CAMBIO, nunca 0. */
  monto(campo: string): number;
  /** RUT canónico de `cuerpo`-`dv`; inválido es PORTAL_CAMBIO. */
  rut(cuerpo: string, dv: string, quien: string): string;
  fecha(campo: string): string | null;
  /** Texto sin espacios de los bordes; null si viene vacío o no viene. */
  texto(campo: string): string | null;
  /** `es_soc_profesional` en SI. */
  readonly sociedadProfesional: boolean;
}

/**
 * Revisa una fila del informe: que traiga los campos `obligatorios`, un folio positivo y un estado conocido. Los montos
 * y RUT se leen después con la misma regla: nunca 0 ni vigente por omisión.
 */
export function filaBoleta(n: number, f: Campos, obligatorios: readonly string[]): FilaBoleta {
  const faltan = ['nroboleta', 'estado', ...obligatorios].filter((campo) => f[campo] === undefined);
  if (faltan.length > 0) throw inesperado(`a la fila ${n} le falta ${faltan.join(', ')}`);
  const folio = entero(f['nroboleta']);
  if (folio === null || folio <= 0) throw inesperado(`número de boleta "${f['nroboleta']}"`);
  const anulada = ESTADOS[f['estado']!.toUpperCase()];
  if (anulada === undefined) throw inesperado(`estado "${f['estado']}" de la boleta ${folio}`);
  return {
    folio,
    anulada,
    monto: (campo) => {
      const valor = entero(f[campo]);
      if (valor === null) throw inesperado(`${campo} "${f[campo]}" de la boleta ${folio}`);
      return valor;
    },
    rut: (cuerpo, dv, quien) => {
      try {
        return parseRut(`${f[cuerpo]}-${f[dv]}`).canonico;
      } catch {
        throw inesperado(`RUT del ${quien} de la boleta ${folio}`);
      }
    },
    fecha: (campo) => fecha(f[campo]),
    texto: (campo) => {
      const t = (f[campo] ?? '').trim();
      return t === '' ? null : t;
    },
    sociedadProfesional: (f['es_soc_profesional'] ?? '').toUpperCase() === 'SI',
  };
}

/** Una suma del SII que, si viene positiva, debe cuadrar con lo leído. */
export interface ControlSuma<B> {
  /** Clave en `xml_values`, p. ej. `suma_retencion_receptor`. */
  readonly clave: string;
  /** Qué es, para el mensaje: «una retención total de». */
  readonly descripcion: string;
  readonly monto: (b: B) => number;
}

/** Lo que distingue a cada informe mensual de boletas (recibidas o emitidas); la paginación y los controles son comunes. */
export interface InformeMensualBhe<B extends { readonly anulada: boolean }> {
  readonly url: string;
  readonly superficie: string;
  /** Para los mensajes: «boletas de honorarios recibidas». */
  readonly nombre: string;
  readonly boleta: (n: number, fila: Campos) => B;
  /** Distingue una boleta repetida entre páginas. */
  readonly clave: (b: B) => string;
  readonly controles: readonly ControlSuma<B>[];
  /** Revisión opcional de los metadatos de la primera página (p. ej., que el informe sea del mes y RUT pedidos). */
  readonly revisar?: (xml: Campos) => void;
}

/** Lo que hace falta para pedir una página: dirección, superficie de la evidencia y nombre para los mensajes. */
type DestinoBhe = Pick<InformeMensualBhe<{ readonly anulada: boolean }>, 'url' | 'superficie' | 'nombre'>;

async function pedirPagina(http: Http, sumidero: SumideroRespuestas, informe: DestinoBhe, rut: Rut, periodo: Periodo, pagina: number): Promise<PaginaBhe> {
  const parametros = {
    rut_arrastre: String(rut.cuerpo),
    dv_arrastre: rut.dv,
    cbanoinformemensual: String(periodo.anio),
    cbmesinformemensual: String(periodo.mes).padStart(2, '0'),
    pagina_solicitada: pagina,
  };
  const consulta = new URLSearchParams(Object.entries(parametros).map(([k, v]) => [k, String(v)]));
  const r = exigirSesion(await http.solicitar(`${informe.url}?${consulta.toString()}`, { headers: { Accept: 'text/html,application/xhtml+xml,*/*' } }));
  if (r.status === 401) throw new ErrorImpuestocl('SESION_REQUERIDA', 'El SII no reconoció la sesión (401).');
  if (r.status === 429) throw new ErrorImpuestocl('SII_LIMITE', 'El SII limitó las consultas; reintenta más tarde.');
  sumidero({ superficie: informe.superficie, parametros, cuerpo: sanearBhe(r.texto, `las ${informe.nombre}`), obtenidoEn: new Date().toISOString() });
  if (r.status === 403) throw new ErrorImpuestocl('SII_RECHAZO', `El SII rechazó la consulta de ${informe.superficie} (403).`);
  return leerPagina(r.texto, informe.nombre);
}

/** `total_boletas`: null si falta o viene vacío (ambiguo); PORTAL_CAMBIO si trae algo que no es un número. */
function totalInformado(xml: Campos): number | null {
  const informado = xml['total_boletas'];
  if (informado === undefined || informado.trim() === '') return null;
  const total = entero(informado);
  if (total === null) throw new ErrorImpuestocl('PORTAL_CAMBIO', `El SII informó un total de boletas ilegible: "${informado}".`);
  return total;
}

/**
 * Índice de página de `pagina_sig_codigo`, solo si es un índice simple (hasta 3 dígitos) bajo `MAX_PAGINAS_BHE`. En la
 * página real suele ser un código largo (14 dígitos) que no es un índice: entonces null y no se salta a ninguna página.
 */
function paginaSiguiente(xml: Campos): number | null {
  const codigo = (xml['pagina_sig_codigo'] ?? '').trim();
  if (!/^\d{1,3}$/.test(codigo)) return null;
  const pagina = Number(codigo);
  return pagina < MAX_PAGINAS_BHE ? pagina : null;
}

const sumaDe = <B extends { readonly anulada: boolean }>(boletas: readonly B[], monto: (b: B) => number, conAnuladas: boolean): number =>
  boletas.filter((b) => conAnuladas || !b.anulada).reduce((suma, b) => suma + monto(b), 0);

/**
 * Control de lo leído: cada suma que el SII informa positiva debe cuadrar con las boletas leídas. No se sabe si el SII
 * suma solo las vigentes o también las anuladas, ni si la suma es del informe o de la página: se acepta cualquiera de
 * esas cuatro sumas y solo una que no calce con ninguna es PORTAL_CAMBIO.
 */
function revisarSumas<B extends { readonly anulada: boolean }>(titulo: string, controles: readonly ControlSuma<B>[], xml: Campos, todas: readonly B[], primeraPagina: readonly B[]): void {
  for (const control of controles) {
    const informada = entero(xml[control.clave]);
    // El SII entrega 0 como valor vacío (la página calcula los totales en el cliente): 0, ausente o ilegible = no informada.
    if (informada === null || informada <= 0) continue;
    const aceptadas = [todas, primeraPagina].flatMap((boletas) => [sumaDe(boletas, control.monto, false), sumaDe(boletas, control.monto, true)]);
    if (aceptadas.includes(informada)) continue;
    throw new ErrorImpuestocl(
      'PORTAL_CAMBIO',
      `${titulo}: el SII informa ${control.descripcion} ${informada} y las boletas leídas suman ${aceptadas[0]} (vigentes) o ${aceptadas[1]} (con anuladas).`,
    );
  }
}

/**
 * Informe mensual de boletas de honorarios: pide páginas (desde la 0) hasta juntar `total_boletas` boletas distintas
 * (según `informe.clave`). Una página que no agrega boletas nuevas (el SII repite la última cuando no hay más) corta la
 * búsqueda, salvo que su `pagina_sig_codigo` apunte a una página aún no pedida. Nunca pide más de `MAX_PAGINAS_BHE`. Si
 * faltan boletas, DATOS_INCOMPLETOS. Devuelve null si el SII respondió sin boletas y sin `total_boletas` (ausente o
 * vacío: vacío ambiguo); con `total_boletas` 0 es un mes sin boletas.
 */
export async function leerInformeMensualBhe<B extends { readonly anulada: boolean }>(
  http: Http,
  sumidero: SumideroRespuestas,
  informe: InformeMensualBhe<B>,
  rut: Rut,
  periodo: Periodo,
): Promise<{ readonly total: number; readonly boletas: readonly B[] } | null> {
  const titulo = `${informe.nombre.charAt(0).toUpperCase()}${informe.nombre.slice(1)} ${periodo.texto}`;
  const boletas = new Map<string, B>();
  const pedidas = new Set<number>();
  let primera: { readonly xml: Campos; readonly boletas: readonly B[] } | null = null;
  let total: number | null = null;
  let pagina = 0;
  while (pedidas.size < MAX_PAGINAS_BHE) {
    pedidas.add(pagina);
    const leida = await pedirPagina(http, sumidero, informe, rut, periodo, pagina);
    const deLaPagina = [...leida.filas].map(([n, fila]) => informe.boleta(n, fila));
    if (primera === null) {
      primera = { xml: leida.xml, boletas: deLaPagina };
      informe.revisar?.(leida.xml);
      total = totalInformado(leida.xml);
    }
    let nuevas = 0;
    for (const b of deLaPagina) {
      const clave = informe.clave(b);
      if (boletas.has(clave)) continue;
      boletas.set(clave, b);
      nuevas++;
    }
    if (total === null || boletas.size >= total) break;
    if (nuevas === 0) {
      const siguiente = paginaSiguiente(leida.xml);
      if (siguiente === null || pedidas.has(siguiente)) break;
      pagina = siguiente;
      continue;
    }
    while (pedidas.has(pagina)) pagina++;
  }
  if (total === null) {
    if (boletas.size === 0) return null;
    throw new ErrorImpuestocl('PORTAL_CAMBIO', `${titulo}: el SII no informó total_boletas; no se puede saber si están todas.`);
  }
  if (boletas.size < total) {
    throw new ErrorImpuestocl('DATOS_INCOMPLETOS', `${titulo}: el SII entregó ${boletas.size} de ${total} boletas.`);
  }
  const todas = [...boletas.values()];
  revisarSumas(titulo, informe.controles, primera?.xml ?? {}, todas, primera?.boletas ?? []);
  return { total, boletas: todas };
}

/** Campos que cada boleta recibida debe traer, además del folio y el estado: sin ellos no se sabe el monto. */
const OBLIGATORIOS_RECIBIDA = ['rutemisor', 'dvemisor', 'totalhonorarios', 'retencion_receptor', 'honorariosliquidos'] as const;

const recibidas = (rut: Rut, periodo: Periodo): InformeMensualBhe<BoletaHonorarios> => ({
  url: URL_RECIBIDAS,
  superficie: 'bhe.recibidas.mensual',
  nombre: 'boletas de honorarios recibidas',
  boleta: (n, campos) => {
    const f = filaBoleta(n, campos, OBLIGATORIOS_RECIBIDA);
    const rutEmisor = f.rut('rutemisor', 'dvemisor', 'emisor');
    return {
      rut: rut.canonico,
      periodo: periodo.texto,
      rutEmisor,
      folio: f.folio,
      nombreEmisor: f.texto('nombre_emisor'),
      fecha: f.fecha('fecha_boleta'),
      bruto: f.monto('totalhonorarios'),
      retencion: f.monto('retencion_receptor'),
      liquido: f.monto('honorariosliquidos'),
      sociedadProfesional: f.sociedadProfesional,
      anulada: f.anulada,
      fechaAnulacion: f.anulada ? f.fecha('fechaanulacion') : null,
    };
  },
  clave: (b) => `${b.rutEmisor}:${b.folio}`,
  controles: [{ clave: 'suma_retencion_receptor', descripcion: 'una retención total de', monto: (b) => b.retencion }],
});

/**
 * Informe mensual de boletas de honorarios electrónicas recibidas (todas las páginas, sin repetir emisor y folio). Los
 * `suma_*` del SII son valores vacíos (0) en la página real: los totales salen de las boletas vigentes leídas.
 */
export async function bheRecibidas(http: Http, sumidero: SumideroRespuestas, rut: Rut, periodo: Periodo): Promise<InformeBhe | null> {
  const leido = await leerInformeMensualBhe(http, sumidero, recibidas(rut, periodo), rut, periodo);
  if (leido === null) return null;
  const vigentes = leido.boletas.filter((b) => !b.anulada);
  const sumar = (monto: (b: BoletaHonorarios) => number): number => vigentes.reduce((s, b) => s + monto(b), 0);
  return {
    boletas: leido.boletas,
    totales: { total: leido.total, bruto: sumar((b) => b.bruto), retencion: sumar((b) => b.retencion), liquido: sumar((b) => b.liquido) },
  };
}
