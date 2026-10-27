import * as z from 'zod';
import { ErrorImpuestocl } from '../../domain/errores.js';
import { ddmmaaaaAIso } from '../../domain/fechas.js';
import type { Periodo } from '../../domain/periodo.js';
import type { Rut } from '../../domain/rut.js';
import type { F29Declaracion, F29Valores } from '../../domain/tipos.js';
import type { LectorPdfF29, SumideroRespuestas } from '../../ports/index.js';
import { mensajeDeError, numero, primero, texto } from './campos.js';
import { lectorPdfF29 } from './f29-pdf.js';
import { exigirSesion, type Http } from './http.js';
import { HOST_SDI, postSdi } from './sdi.js';

const BASE = `${HOST_SDI}/propuestaf29ui/services/data/facadeAdapterService`;
const NAMESPACE = 'cl.sii.sdi.lob.iva.propuestaf29.data.api.interfaces.FacadeAdapterService';
const REFERER = `${HOST_SDI}/propuestaf29ui/`;
/** Id interno del F29 en las fachadas SDI (el formulario es el 29, su id interno es "2"). */
const FORM_ID = '2';

const Sobre = z.object({ metaData: z.object({ errors: z.unknown().nullish() }).loose().nullish(), data: z.array(z.record(z.string(), z.unknown())).nullable() }).loose();

export async function f29Declaraciones(http: Http, sumidero: SumideroRespuestas, rut: Rut, periodo: Periodo): Promise<F29Declaracion[]> {
  const crudo = await postSdi(http, sumidero, {
    superficie: 'f29.estados',
    url: `${BASE}/getDeclaracionConEstados`,
    namespace: `${NAMESPACE}/getDeclaracionConEstados`,
    referer: REFERER,
    data: { rut: String(rut.cuerpo), dv: rut.dv, formId: FORM_ID, mes: String(periodo.mes).padStart(2, '0'), anno: String(periodo.anio) },
  });
  const sobre = Sobre.safeParse(crudo);
  if (!sobre.success) throw new ErrorImpuestocl('PORTAL_CAMBIO', 'Respuesta inesperada del F29 (estados).', { detalle: sobre.error.message });
  const error = mensajeDeError(sobre.data.metaData?.errors);
  if (error) throw new ErrorImpuestocl(/autoriza/i.test(error) ? 'SIN_PERMISO' : 'SII_RECHAZO', `F29: ${error}`);
  const filas = sobre.data.data ?? [];
  return filas.map((f) => ({
    rut: rut.canonico,
    periodo: periodo.texto,
    folio: numero(primero(f, ['folio', 'folioDeclaracion'])) ?? 0,
    estado: texto(primero(f, ['estado', 'glosaEstado', 'descripcionEstado'])) ?? 'desconocido',
    estadoId: numero(primero(f, ['estadoDeclaracionId'])),
    fechaPresentacion: ddmmaaaaAIso(texto(primero(f, ['declFechaCreacion', 'fechaCreacion', 'fecha']))),
    codigoInterno: numero(primero(f, ['codigo', 'cod'])),
    totalAPagar: numero(primero(f, ['monto', 'total', 'montoTotal'])),
  }));
}

export function urlFormCompacto(rut: Rut, folio: number, codigoInterno: number): string {
  const q = new URLSearchParams({ folio: String(folio), rut: String(rut.cuerpo), form: '029', codInt: String(codigoInterno) });
  return `${HOST_SDI}/rfiInternet/formCompacto?${q.toString()}`;
}

/** Valores por código del F29 presentado, leídos del PDF compacto que entrega el SII. */
export async function f29Valores(http: Http, sumidero: SumideroRespuestas, rut: Rut, d: F29Declaracion, lector: LectorPdfF29 = lectorPdfF29): Promise<F29Valores> {
  if (d.folio <= 0 || d.codigoInterno === null) {
    throw new ErrorImpuestocl('SII_RECHAZO', `El F29 de ${d.periodo} no tiene un folio presentado.`);
  }
  const r = exigirSesion(await http.solicitar(urlFormCompacto(rut, d.folio, d.codigoInterno), { headers: { Referer: REFERER, Accept: 'application/pdf,*/*' } }));
  sumidero({
    superficie: 'f29.formCompacto',
    parametros: { periodo: d.periodo, folio: d.folio },
    cuerpo: Buffer.from(r.bytes).toString('base64'),
    obtenidoEn: new Date().toISOString(),
  });
  const esPdf = r.bytes.length > 5 && new TextDecoder('latin1').decode(r.bytes.slice(0, 5)) === '%PDF-';
  if (!esPdf) throw new ErrorImpuestocl('PORTAL_CAMBIO', `El SII no entregó el PDF del F29 de ${d.periodo} (content-type ${r.contentType}).`);
  let valores: Record<string, number>;
  try {
    valores = await lector.extraer(r.bytes);
  } catch (cause) {
    throw new ErrorImpuestocl('PORTAL_CAMBIO', `No se pudo leer el PDF del F29 de ${d.periodo}.`, { cause });
  }
  // Un PDF en blanco o con otra maqueta da {}: reemplazar con eso borraría los valores guardados del folio.
  if (Object.keys(valores).length === 0) throw new ErrorImpuestocl('PORTAL_CAMBIO', `El PDF del F29 de ${d.periodo} no trajo códigos legibles.`);
  return { rut: rut.canonico, periodo: d.periodo, folio: d.folio, valores, versionLector: lector.version };
}
