import * as z from 'zod';
import { ErrorImpuestocl } from '../../domain/errores.js';
import type { Periodo } from '../../domain/periodo.js';
import type { Rut } from '../../domain/rut.js';
import type { PropuestaF29 } from '../../domain/tipos.js';
import type { SumideroRespuestas } from '../../ports/index.js';
import { errorDeSobre, esObjeto, numero, texto } from './campos.js';
import type { Http } from './http.js';
import { HOST_SDI, postSdi } from './sdi.js';

const BASE = `${HOST_SDI}/propuestaf29ui/services/data/facadeAdapterService`;
const OPERACION = 'getDeclaracionConCondicionesYTipoPropuesta';
const NAMESPACE = 'cl.sii.sdi.lob.iva.propuestaf29.data.api.interfaces.FacadeAdapterService';
const REFERER = `${HOST_SDI}/propuestaf29ui/`;
/** Código interno del formulario 29 en esta fachada. */
const FORM_CODIGO = '2';

/** Códigos de identificación del contribuyente (nombre, domicilio, giro…): no son montos y nunca se guardan. Ya normalizados. */
const CODIGOS_IDENTIFICACION: ReadonlySet<string> = new Set(['1', '2', '3', '5', '6', '8', '9', '55', '314', '610']);

const Sobre = z
  .object({
    metaData: z.object({ errors: z.unknown().nullish() }).loose().nullish(),
    data: z.record(z.string(), z.unknown()).nullable(),
  })
  .loose();

/** Código sin espacios ni ceros a la izquierda; null si no es numérico. */
function normalizarCodigo(v: unknown): string | null {
  const t = texto(v);
  if (t === null || !/^\d+$/.test(t)) return null;
  return t.replace(/^0+(?=\d)/, '');
}

/** Pares `{codigo, valor}` legibles de una lista del portal, sin los códigos de identificación; lo ilegible se descarta. */
function leerLista(lista: unknown, nombre: string): Record<string, number> {
  if (lista === undefined || lista === null) return {};
  if (!Array.isArray(lista)) throw new ErrorImpuestocl('PORTAL_CAMBIO', `Respuesta inesperada de la propuesta del F29 (${nombre} no es una lista).`);
  const out: Record<string, number> = {};
  for (const fila of lista) {
    if (!esObjeto(fila)) continue;
    const codigo = normalizarCodigo(fila['codigo']);
    const valor = numero(fila['valor']);
    if (codigo === null || valor === null || CODIGOS_IDENTIFICACION.has(codigo)) continue;
    out[codigo] = valor;
  }
  return out;
}

function filasPermitidas(lista: unknown): unknown[] {
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((fila) => {
    if (!esObjeto(fila)) return [];
    const codigo = normalizarCodigo(fila['codigo']);
    if (codigo === null || CODIGOS_IDENTIFICACION.has(codigo)) return [];
    // Solo montos: igual que lo guardado, un texto libre (correo, domicilio) no pasa a la evidencia.
    if (numero(fila['valor']) === null) return [];
    return [{ codigo: fila['codigo'], valor: fila['valor'] }];
  });
}

/**
 * Evidencia de la propuesta: solo una lista permitida de campos. La respuesta cruda trae datos de identificación
 * (`listCodBase`), la traza del cálculo, actividades y anotaciones que no se guardan. Nunca lanza.
 */
export function sanearPropuesta(cuerpo: unknown): unknown {
  const sobre = esObjeto(cuerpo) ? cuerpo : {};
  const metaData = esObjeto(sobre['metaData']) ? sobre['metaData'] : {};
  const errors = metaData['errors'] ?? null;
  const data = sobre['data'];
  if (!esObjeto(data)) return { metaData: { errors }, data: null };
  const saneado: Record<string, unknown> = {};
  for (const clave of ['tipopropuesta', 'tipopropuestadescrip', 'listGlosasProp', 'estado', 'descripcionEstado', 'tieneAnotaciones']) {
    if (clave in data) saneado[clave] = data[clave];
  }
  if ('listCodPropuestos' in data) saneado['listCodPropuestos'] = filasPermitidas(data['listCodPropuestos']);
  if ('listCodAdministrativos' in data) saneado['listCodAdministrativos'] = filasPermitidas(data['listCodAdministrativos']);
  const calculo = data['resultadoCalculoPP29'];
  if (esObjeto(calculo)) saneado['resultadoCalculoPP29'] = { estado: calculo['estado'] ?? null, glosaError: calculo['glosaError'] ?? null };
  return { metaData: { errors }, data: saneado };
}

/** Propuesta de F29 del mes, o null si el SII respondió sin datos ni errores. */
export async function f29Propuesta(http: Http, sumidero: SumideroRespuestas, rut: Rut, periodo: Periodo): Promise<PropuestaF29 | null> {
  const crudo = await postSdi(http, sumidero, {
    superficie: 'f29.propuesta',
    url: `${BASE}/${OPERACION}`,
    namespace: `${NAMESPACE}/${OPERACION}`,
    referer: REFERER,
    data: { rutContribuyente: String(rut.cuerpo), dv: rut.dv, formCodigo: FORM_CODIGO, mes: String(periodo.mes).padStart(2, '0'), anno: String(periodo.anio) },
    sanear: sanearPropuesta,
  });
  // Los errores se leen antes de validar `data`: un sobre de error puede venir sin esa clave.
  const error = errorDeSobre(crudo);
  if (error) throw new ErrorImpuestocl(/autoriza/i.test(error) ? 'SIN_PERMISO' : 'SII_RECHAZO', `Propuesta F29: ${error}`);
  const sobre = Sobre.safeParse(crudo);
  if (!sobre.success) throw new ErrorImpuestocl('PORTAL_CAMBIO', 'Respuesta inesperada de la propuesta del F29.', { detalle: sobre.error.message });
  const data = sobre.data.data;
  if (data === null) return null;
  const propuestos = leerLista(data['listCodPropuestos'], 'listCodPropuestos');
  const administrativos = leerLista(data['listCodAdministrativos'], 'listCodAdministrativos');
  const calculo = esObjeto(data['resultadoCalculoPP29']) ? data['resultadoCalculoPP29'] : {};
  const tipoPropuesta = numero(data['tipopropuesta']);
  const descripcionTipo = texto(data['tipopropuestadescrip']);
  const estadoCalculo = numero(calculo['estado']);
  const sinCodigos = Object.keys(propuestos).length === 0 && Object.keys(administrativos).length === 0;
  // Sin tipo, descripción, estado de cálculo ni códigos no hay nada que guardar: es una respuesta nula, no un mes sin propuesta.
  if (tipoPropuesta === null && descripcionTipo === null && estadoCalculo === null && sinCodigos) return null;
  return { rut: rut.canonico, periodo: periodo.texto, tipoPropuesta, descripcionTipo, estadoCalculo, propuestos, administrativos, sinPropuesta: sinCodigos };
}
