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
export const VALOR = String.raw`(?:formatMiles\(\s*(?:"([^"\n]*)"|'([^'\n]*)')\s*,\s*['"][^'"\n]*['"]\s*\)|"([^"\n]*)"|'([^'\n]*)'|([^;\n]*?))\s*(?:;|(?=\r?\n)|$)`;
/** `=` de una asignación, no de una comparación (`==`, `===`). */
export const IGUAL = String.raw`\s*=(?!=)\s*`;
const ASIGNACION_FILA = new RegExp(String.raw`arr_informe_mensual\s*\[\s*['"]([A-Za-z_]+?)_(\d+)['"]\s*\]${IGUAL}${VALOR}`, 'g');
const ASIGNACION_XML = new RegExp(String.raw`xml_values\s*\[\s*['"]([A-Za-z_]+)['"]\s*\]${IGUAL}${VALOR}`, 'g');

/** Claves que no se guardan como evidencia: código de barras y comuna de cada boleta, y el nombre del contribuyente. */
const CLAVE_PRIVADA = String.raw`\[\s*['"](?:codigobarras_\d+|cod_comuna_\d+|nombre_contribuyente)['"]\s*\]`;
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
const ASIGNACION_PRIVADA_RESTANTE = new RegExp(
  String.raw`${CLAVE_PRIVADA}\s*=(?!=)|\b(?:codigobarras_\d+|cod_comuna_\d+|nombre_contribuyente)\b['"]?\s*(?::|=(?!=))`,
);

/** Texto del valor capturado por `VALOR`, que empieza en el grupo `desde`; vacío si no vino. */
export const valorDe = (m: RegExpExecArray, desde: number): string => (m[desde] ?? m[desde + 1] ?? m[desde + 2] ?? m[desde + 3] ?? m[desde + 4] ?? '').trim();

/**
 * Evidencia de una página del informe: quita las asignaciones de `codigobarras_N`, `cod_comuna_N` y
 * `xml_values['nombre_contribuyente']`; sus lecturas en otras partes del script se quedan. Si queda alguna asignación
 * de esas claves (otra sintaxis), lanza PORTAL_CAMBIO: nunca se guarda sin sanear. `informe` solo nombra lo que se
 * saneaba en el mensaje de error (el informe anual de las emitidas usa el mismo saneamiento).
 */
export function sanearBhe(html: string, informe = 'las boletas de honorarios recibidas'): string {
  const saneado = html.replace(ASIGNACIONES_PRIVADAS, '');
  if (ASIGNACION_PRIVADA_RESTANTE.test(saneado)) {
    throw new ErrorImpuestocl('PORTAL_CAMBIO', `No se pudo sanear la evidencia de ${informe}.`);
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

/** Entero no negativo con punto de miles opcional; ausente, vacío o ilegible → null (nunca 0 por omisión). */
function entero(v: string | undefined): number | null {
  const t = (v ?? '').trim();
  return /^\d[\d.]*$/.test(t) ? Number(t.replace(/\./g, '')) : null;
}

/** Campos que cada boleta debe traer: sin ellos no se sabe el monto ni si está vigente. */
const CAMPOS_OBLIGATORIOS = ['nroboleta', 'rutemisor', 'dvemisor', 'totalhonorarios', 'retencion_receptor', 'honorariosliquidos', 'estado'] as const;
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

function boleta(rut: Rut, periodo: Periodo, n: number, f: Readonly<Record<string, string>>): BoletaHonorarios {
  const faltan = CAMPOS_OBLIGATORIOS.filter((campo) => f[campo] === undefined);
  if (faltan.length > 0) throw inesperado(`a la fila ${n} le falta ${faltan.join(', ')}`);
  const folio = entero(f['nroboleta']);
  if (folio === null || folio <= 0) throw inesperado(`número de boleta "${f['nroboleta']}"`);
  let rutEmisor: string;
  try {
    rutEmisor = parseRut(`${f['rutemisor']}-${f['dvemisor']}`).canonico;
  } catch {
    throw inesperado(`RUT del emisor de la boleta ${folio}`);
  }
  const montoDe = (campo: string): number => {
    const valor = entero(f[campo]);
    if (valor === null) throw inesperado(`${campo} "${f[campo]}" de la boleta ${folio}`);
    return valor;
  };
  const anulada = ESTADOS[f['estado']!.toUpperCase()];
  if (anulada === undefined) throw inesperado(`estado "${f['estado']}" de la boleta ${folio}`);
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
  if (r.status === 429) throw new ErrorImpuestocl('SII_LIMITE', 'El SII limitó las consultas; reintenta más tarde.');
  sumidero({ superficie: SUPERFICIE, parametros, cuerpo: sanearBhe(r.texto), obtenidoEn: new Date().toISOString() });
  if (r.status === 403) throw new ErrorImpuestocl('SII_RECHAZO', `El SII rechazó la consulta de ${SUPERFICIE} (403).`);
  return leerPagina(r.texto);
}

/** `total_boletas`: null si falta o viene vacío (ambiguo); PORTAL_CAMBIO si trae algo que no es un número. */
function totalInformado(xml: Readonly<Record<string, string>>): number | null {
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
function paginaSiguiente(xml: Readonly<Record<string, string>>): number | null {
  const codigo = (xml['pagina_sig_codigo'] ?? '').trim();
  if (!/^\d{1,3}$/.test(codigo)) return null;
  const pagina = Number(codigo);
  return pagina < MAX_PAGINAS_BHE ? pagina : null;
}

const sumaRetencion = (boletas: readonly BoletaHonorarios[], conAnuladas: boolean): number =>
  boletas.filter((b) => conAnuladas || !b.anulada).reduce((suma, b) => suma + b.retencion, 0);

/**
 * Control de lo leído: si el SII informa `suma_retencion_receptor`, debe cuadrar con la retención de las boletas
 * leídas. No se sabe si el SII suma solo las vigentes o también las anuladas, ni si la suma es del informe o de la
 * página: se acepta cualquiera de esas cuatro sumas y solo una que no calce con ninguna es PORTAL_CAMBIO.
 */
function revisarSumaRetencion(periodo: Periodo, xml: Readonly<Record<string, string>>, todas: readonly BoletaHonorarios[], primeraPagina: readonly BoletaHonorarios[]): void {
  const informada = entero(xml['suma_retencion_receptor']);
  // El SII entrega 0 como valor vacío (la página calcula los totales en el cliente): 0, ausente o ilegible = no informada.
  if (informada === null || informada <= 0) return;
  const aceptadas = [sumaRetencion(todas, false), sumaRetencion(todas, true), sumaRetencion(primeraPagina, false), sumaRetencion(primeraPagina, true)];
  if (aceptadas.includes(informada)) return;
  throw new ErrorImpuestocl(
    'PORTAL_CAMBIO',
    `Boletas de honorarios ${periodo.texto}: el SII informa una retención total de ${informada} y las boletas leídas suman ${aceptadas[0]} (vigentes) o ${aceptadas[1]} (con anuladas).`,
  );
}

/**
 * Informe mensual de boletas de honorarios electrónicas recibidas: pide páginas (desde la 0) hasta juntar
 * `total_boletas` boletas distintas (por emisor y folio). Una página que no agrega boletas nuevas (el SII repite la
 * última cuando no hay más) corta la búsqueda, salvo que su `pagina_sig_codigo` apunte a una página aún no pedida.
 * Nunca pide más de `MAX_PAGINAS_BHE`. Si faltan boletas, DATOS_INCOMPLETOS. Devuelve null si el SII respondió sin
 * boletas y sin `total_boletas` (ausente o vacío: vacío ambiguo); con `total_boletas` 0 es un mes sin boletas.
 */
export async function bheRecibidas(http: Http, sumidero: SumideroRespuestas, rut: Rut, periodo: Periodo): Promise<InformeBhe | null> {
  const boletas = new Map<string, BoletaHonorarios>();
  const pedidas = new Set<number>();
  let primera: { readonly xml: Readonly<Record<string, string>>; readonly boletas: readonly BoletaHonorarios[] } | null = null;
  let total: number | null = null;
  let pagina = 0;
  while (pedidas.size < MAX_PAGINAS_BHE) {
    pedidas.add(pagina);
    const leida = await pedirPagina(http, sumidero, rut, periodo, pagina);
    const deLaPagina = [...leida.filas].map(([n, fila]) => boleta(rut, periodo, n, fila));
    if (primera === null) {
      primera = { xml: leida.xml, boletas: deLaPagina };
      total = totalInformado(leida.xml);
    }
    let nuevas = 0;
    for (const b of deLaPagina) {
      const clave = `${b.rutEmisor}:${b.folio}`;
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
    throw new ErrorImpuestocl('PORTAL_CAMBIO', `Boletas de honorarios ${periodo.texto}: el SII no informó total_boletas; no se puede saber si están todas.`);
  }
  if (boletas.size < total) {
    throw new ErrorImpuestocl('DATOS_INCOMPLETOS', `Boletas de honorarios ${periodo.texto}: el SII entregó ${boletas.size} de ${total} boletas.`);
  }
  const xml = primera?.xml ?? {};
  const todas = [...boletas.values()];
  revisarSumaRetencion(periodo, xml, todas, primera?.boletas ?? []);
  // Los `suma_*` del SII son valores vacíos (0) en la página real: los montos salen de las boletas vigentes leídas.
  const vigentes = todas.filter((b) => !b.anulada);
  const sumar = (monto: (b: BoletaHonorarios) => number): number => vigentes.reduce((s, b) => s + monto(b), 0);
  return {
    boletas: todas,
    totales: { total, bruto: sumar((b) => b.bruto), retencion: sumar((b) => b.retencion), liquido: sumar((b) => b.liquido) },
  };
}
