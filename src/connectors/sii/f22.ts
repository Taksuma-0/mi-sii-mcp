import { ErrorImpuestocl } from '../../domain/errores.js';
import { ddmmaaaaAIso } from '../../domain/fechas.js';
import type { Rut } from '../../domain/rut.js';
import type { F22Declaracion, F22Detalle, F22Evento, F22Observacion, F22Valor } from '../../domain/tipos.js';
import type { SumideroRespuestas } from '../../ports/index.js';
import { esObjeto, mensajeDeError, numeroChileno, texto } from './campos.js';
import type { Http } from './http.js';
import { HOST_SDI, postSdi } from './sdi.js';

const BASE = `${HOST_SDI}/consultaestadof22ui/services/data/facadeService`;
const NAMESPACE = 'cl.sii.sdi.lob.renta.consultaestadof22.data.api.interfaces.FacadeService';
const REFERER = `${HOST_SDI}/consultaestadof22ui/`;

/**
 * Campos de cada declaración que se leen y se guardan como evidencia. La respuesta trae además nombres, apellidos,
 * domicilio, cuenta y banco para la devolución, giro y RUT de terceros: nunca se guardan.
 */
const CAMPOS_DECLARACION = [
  'folio',
  'tipoIng',
  'fecIng',
  'codConc',
  'vgte',
  'tipoImpugnado',
  'remanenteSolicitado',
  'remanenteDevuelto',
  'impuestoPagado',
  'montoGiro',
  'fechaVencimiento',
  'rectificacble',
  'dcrtCodigoRectificado',
  'dcrtCodigoAnulado',
] as const;

/** Campos de cada evento; sin `referencia`, `idCarta` ni `unidadSii`. */
const CAMPOS_EVENTO = ['codEvento', 'nombre', 'fechaEvento', 'tipoEvento', 'codCarta'] as const;

/**
 * Códigos de identificación del F22 (nombre, RUT, domicilio, comuna, giro, correo, banco, número y tipo de cuenta,
 * moneda, RUT del representante): nunca se guardan, aunque su valor sea numérico (el 306 es el número de cuenta). Ya
 * normalizados.
 */
const CODIGOS_EXCLUIDOS: ReadonlySet<string> = new Set(['1', '2', '3', '5', '6', '8', '13', '55', '301', '306', '780', '903', '8811']);
/**
 * Filas con datos personales aunque su código no esté en la lista: se reconocen por la glosa. «Cuenta» solo como cuenta
 * bancaria: «a cuenta del impuesto» es una fila tributaria y se conserva.
 */
const GLOSA_PERSONAL =
  /apellido|nombre|raz[oó]n social|domicilio|direcci[oó]n|calle|comuna|correo|e-?mail|tel[eé]fono|celular|\bfono\b|banco|n[uú]mero de cuenta|tipo de cuenta|cuenta (?:corriente|vista|de ahorro|bancaria|rut)|\bcta\b|rut (?:del )?representante|rol [uú]nico tributario/i;
/** Códigos cuyo valor es una fecha: se guarda la glosa, no el valor. */
const CODIGOS_FECHA: ReadonlySet<string> = new Set(['15', '315']);

/** Código sin espacios ni ceros a la izquierda; null si no es numérico. */
function normalizarCodigo(v: unknown): string | null {
  const t = texto(v);
  if (t === null || !/^\d+$/.test(t)) return null;
  return t.replace(/^0+(?=\d)/, '');
}

/** Solo valores simples: un objeto anidado en un campo permitido podría traer cualquier cosa. */
const simple = (v: unknown): unknown => (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null);

const elegir = (fila: Record<string, unknown>, campos: readonly string[]): Record<string, unknown> => Object.fromEntries(campos.map((c) => [c, simple(fila[c] ?? null)]));

/** El enlace tal cual si es http(s) de sii.cl; null si no. */
function urlDelSii(v: unknown): string | null {
  const t = texto(v);
  if (t === null) return null;
  try {
    const url = new URL(t);
    const delSii = url.hostname === 'sii.cl' || url.hostname.endsWith('.sii.cl');
    return delSii && (url.protocol === 'https:' || url.protocol === 'http:') ? t : null;
  } catch {
    return null;
  }
}

/** Fila del compacto que se puede guardar: código numérico, ni de identificación ni con glosa personal. */
function filaCompacto(fila: unknown): F22Valor | null {
  if (!esObjeto(fila)) return null;
  const codigo = normalizarCodigo(fila['codigo']);
  if (codigo === null || CODIGOS_EXCLUIDOS.has(codigo)) return null;
  const glosa = texto(fila['glosa']);
  if (glosa !== null && GLOSA_PERSONAL.test(glosa)) return null;
  return { codigo, valor: CODIGOS_FECHA.has(codigo) ? null : numeroChileno(fila['valor']), glosa };
}

/** Filas permitidas del compacto, sin repetir código (queda el primero). */
function valoresCompacto(filas: readonly unknown[]): F22Valor[] {
  const vistos = new Set<string>();
  const out: F22Valor[] = [];
  for (const fila of filas) {
    const v = filaCompacto(fila);
    if (v === null || vistos.has(v.codigo)) continue;
    vistos.add(v.codigo);
    out.push(v);
  }
  return out;
}

const observacionDe = (fila: unknown): F22Observacion | null => {
  if (!esObjeto(fila)) return null;
  const codigo = texto(fila['codigo']);
  return codigo === null ? null : { codigo, descripcion: texto(fila['descripcion']), url: urlDelSii(fila['url']) };
};

/** Observaciones legibles sin repetir código (queda la primera): la base guarda una por código. */
function observacionesDe(filas: readonly unknown[]): F22Observacion[] {
  const vistas = new Set<string>();
  return filas.flatMap((fila) => {
    const o = observacionDe(fila);
    if (o === null || vistas.has(o.codigo)) return [];
    vistas.add(o.codigo);
    return [o];
  });
}

/** Cabecera común de la evidencia saneada: los errores como texto, nunca el objeto completo. */
function sobreSaneado(cuerpo: unknown, data: unknown): unknown {
  const sobre = esObjeto(cuerpo) ? cuerpo : {};
  const metaData = esObjeto(sobre['metaData']) ? sobre['metaData'] : {};
  const respCod = sobre['respCod'];
  return {
    data,
    respCod: typeof respCod === 'number' || typeof respCod === 'string' ? respCod : null,
    errorMsg: mensajeDeError(sobre['errorMsg']),
    metaData: { errors: mensajeDeError(metaData['errors']) },
  };
}

const dataDe = (cuerpo: unknown): unknown => (esObjeto(cuerpo) ? cuerpo['data'] : undefined);

/** Evidencia de buscaDeclVgte: solo los campos permitidos de cada declaración y las glosas de conclusión. Nunca lanza. */
export function sanearDeclaracionesF22(cuerpo: unknown): unknown {
  const data = dataDe(cuerpo);
  if (!esObjeto(data)) return sobreSaneado(cuerpo, null);
  const decls = Array.isArray(data['decls']) ? data['decls'].flatMap((d) => (esObjeto(d) ? [elegir(d, CAMPOS_DECLARACION)] : [])) : null;
  const glosas = Array.isArray(data['glosas']) ? data['glosas'].flatMap((g) => (esObjeto(g) ? [elegir(g, ['codConclusion', 'descripcion'])] : [])) : null;
  return sobreSaneado(cuerpo, { decls, glosas });
}

/** Evidencia de f22Compacto: las mismas filas que se guardan, con el valor solo si es numérico. Nunca lanza. */
export function sanearCompactoF22(cuerpo: unknown): unknown {
  const data = dataDe(cuerpo);
  return sobreSaneado(cuerpo, Array.isArray(data) ? valoresCompacto(data) : null);
}

/** Evidencia de situacionObservacion: código, descripción y enlace solo si es de sii.cl. Nunca lanza. */
export function sanearObservacionesF22(cuerpo: unknown): unknown {
  const data = dataDe(cuerpo);
  return sobreSaneado(cuerpo, Array.isArray(data) ? observacionesDe(data) : null);
}

/** Evidencia de buscaEventos: solo los campos permitidos de cada evento. Nunca lanza. */
export function sanearEventosF22(cuerpo: unknown): unknown {
  const data = dataDe(cuerpo);
  return sobreSaneado(cuerpo, Array.isArray(data) ? data.flatMap((f) => (esObjeto(f) ? [elegir(f, CAMPOS_EVENTO)] : [])) : null);
}

interface Operacion {
  readonly nombre: string;
  readonly superficie: string;
  readonly sanear: (cuerpo: unknown) => unknown;
}

const BUSCA_DECL: Operacion = { nombre: 'buscaDeclVgte', superficie: 'f22', sanear: sanearDeclaracionesF22 };
const COMPACTO: Operacion = { nombre: 'f22Compacto', superficie: 'f22.compacto', sanear: sanearCompactoF22 };
const OBSERVACIONES: Operacion = { nombre: 'situacionObservacion', superficie: 'f22.observaciones', sanear: sanearObservacionesF22 };
const EVENTOS: Operacion = { nombre: 'buscaEventos', superficie: 'f22.eventos', sanear: sanearEventosF22 };

/** Llama a una operación de la fachada del F22 y devuelve su `data` (null si no vino), o lanza el error del SII. */
async function consultar(http: Http, sumidero: SumideroRespuestas, op: Operacion, data: Record<string, unknown>): Promise<unknown> {
  const crudo = await postSdi(http, sumidero, { superficie: op.superficie, url: `${BASE}/${op.nombre}`, namespace: `${NAMESPACE}/${op.nombre}`, referer: REFERER, data, sanear: op.sanear });
  if (!esObjeto(crudo)) throw new ErrorImpuestocl('PORTAL_CAMBIO', `Respuesta inesperada del F22 (${op.nombre}).`);
  const metaData = esObjeto(crudo['metaData']) ? crudo['metaData'] : {};
  const error = mensajeDeError(metaData['errors']) ?? mensajeDeError(crudo['errorMsg']);
  if (error) throw new ErrorImpuestocl(/autoriza/i.test(error) ? 'SIN_PERMISO' : 'SII_RECHAZO', `F22: ${error}`);
  return crudo['data'] ?? null;
}

/** Lista de la respuesta: null es vacía; otra cosa que no sea lista es un cambio del portal. */
function lista(data: unknown, op: Operacion): unknown[] {
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) throw new ErrorImpuestocl('PORTAL_CAMBIO', `Respuesta inesperada del F22 (${op.nombre}: no es una lista).`);
  return data;
}

function vigenteDe(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  const t = texto(v)?.toUpperCase();
  if (t === 'S' || t === '1') return true;
  if (t === 'N' || t === '0') return false;
  return null;
}

function declaracionDe(fila: unknown, rut: Rut, anio: number, glosas: ReadonlyMap<string, string | null>): F22Declaracion {
  if (!esObjeto(fila)) throw new ErrorImpuestocl('PORTAL_CAMBIO', 'Declaración F22 inesperada (no es un objeto).');
  const folio = numeroChileno(fila['folio']);
  if (folio === null || !Number.isInteger(folio) || folio <= 0) throw new ErrorImpuestocl('PORTAL_CAMBIO', 'Declaración F22 sin un folio válido.');
  const codigoConclusion = texto(fila['codConc']);
  return {
    rut: rut.canonico,
    anioTributario: anio,
    folio,
    vigente: vigenteDe(fila['vgte']),
    codigoConclusion,
    conclusion: codigoConclusion === null ? null : (glosas.get(codigoConclusion) ?? null),
    fechaIngreso: ddmmaaaaAIso(texto(fila['fecIng'])),
    tipoImpugnado: texto(fila['tipoImpugnado']),
    remanenteSolicitado: numeroChileno(fila['remanenteSolicitado']),
    remanenteDevuelto: numeroChileno(fila['remanenteDevuelto']),
    impuestoPagado: numeroChileno(fila['impuestoPagado']),
    montoGiro: numeroChileno(fila['montoGiro']),
    fechaVencimiento: ddmmaaaaAIso(texto(fila['fechaVencimiento'])),
  };
}

/** Declaraciones F22 del año tributario (vigente y anteriores), sin repetir folio; vacía si el SII no informó ninguna. */
export async function f22Declaraciones(http: Http, sumidero: SumideroRespuestas, rut: Rut, anioTributario: number): Promise<F22Declaracion[]> {
  const data = await consultar(http, sumidero, BUSCA_DECL, { periodo: String(anioTributario), rut: String(rut.cuerpo), dv: rut.dv });
  if (data === null) return [];
  if (!esObjeto(data)) throw new ErrorImpuestocl('PORTAL_CAMBIO', 'Respuesta inesperada del F22 (buscaDeclVgte).');
  const glosas = new Map<string, string | null>();
  for (const g of Array.isArray(data['glosas']) ? data['glosas'] : []) {
    if (!esObjeto(g)) continue;
    const codigo = texto(g['codConclusion']);
    if (codigo !== null && !glosas.has(codigo)) glosas.set(codigo, texto(g['descripcion']));
  }
  const declaraciones = lista(data['decls'], BUSCA_DECL).map((fila) => declaracionDe(fila, rut, anioTributario, glosas));
  const folios = new Set<number>();
  return declaraciones.filter((d) => !folios.has(d.folio) && folios.add(d.folio));
}

/** Detalle de un folio del F22: códigos del compacto, observaciones y eventos. Si una operación falla, falla el detalle. */
export async function f22Detalle(http: Http, sumidero: SumideroRespuestas, rut: Rut, anioTributario: number, folio: number): Promise<F22Detalle> {
  const base = { rut: String(rut.cuerpo), dv: rut.dv };
  const comoTexto = { ...base, periodo: String(anioTributario), folio: String(folio) };
  const valores = valoresCompacto(lista(await consultar(http, sumidero, COMPACTO, comoTexto), COMPACTO));
  const observaciones = observacionesDe(lista(await consultar(http, sumidero, OBSERVACIONES, { ...base, periodo: anioTributario, folio }), OBSERVACIONES));
  const eventos: F22Evento[] = lista(await consultar(http, sumidero, EVENTOS, comoTexto), EVENTOS)
    .filter(esObjeto)
    .map((f, i) => ({
      orden: i + 1,
      codigoEvento: texto(f['codEvento']),
      nombre: texto(f['nombre']),
      fecha: ddmmaaaaAIso(texto(f['fechaEvento'])),
      tipo: texto(f['tipoEvento']),
      codigoCarta: texto(f['codCarta']),
    }));
  return { valores, observaciones, eventos };
}
