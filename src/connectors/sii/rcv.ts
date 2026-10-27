import * as z from 'zod';
import { ErrorImpuestocl } from '../../domain/errores.js';
import { ddmmaaaaAIso } from '../../domain/fechas.js';
import { periodoSii, type Periodo } from '../../domain/periodo.js';
import { parseRut, type Rut } from '../../domain/rut.js';
import type { DocumentoRcv, EstadoRcv, Lado, RcvResumen, RcvResumenFila } from '../../domain/tipos.js';
import type { SumideroRespuestas } from '../../ports/index.js';
import { entero, primero, texto } from './campos.js';
import type { Http } from './http.js';
import { HOST_SDI, postSdi } from './sdi.js';

const BASE = `${HOST_SDI}/consdcvinternetui/services/data/facadeService`;
const NAMESPACE = 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService';
const REFERER = `${HOST_SDI}/consdcvinternetui/`;

/** Literales aceptados sin rechazo en consultas vacías de resumen (docs/decisiones/0001-spike-sii.md).
 * Su clasificación con documentos y su uso en detalle siguen pendientes de verificación. */
export const ESTADO_WIRE: Readonly<Record<EstadoRcv, string>> = {
  REGISTRO: 'REGISTRO',
  PENDIENTE: 'PENDIENTE',
  NO_INCLUIR: 'NO_INCLUIR',
  RECLAMADO: 'RECLAMADO',
};
const ACCION_RECAPTCHA: Readonly<Record<Lado, string>> = { COMPRA: 'RCV_DETC', VENTA: 'RCV_DETV' };
/** Marcador sintético del plan; su aceptación en detalle no se ha verificado. */
const TOKEN_RECAPTCHA = 't-o-k-e-n-web';
/** El contrato trata 0 como OK y 3 como sin movimientos; la spike solo observó 3/data:null sin rechazo. */
const CODIGOS_OK = new Set(['0', '3']);
const CODIGO_SIN_MOVIMIENTOS = '3';

const Sobre = z
  .object({
    respEstado: z
      .object({
        codRespuesta: z.union([z.number(), z.string()]).nullish(),
        msgeRespuesta: z.string().nullish(),
      })
      .loose()
      .nullish(),
    data: z.array(z.record(z.string(), z.unknown())).nullish(),
    datos: z.array(z.record(z.string(), z.unknown())).nullish(),
  })
  .loose()
  .refine((sobre) => sobre.data !== undefined || sobre.datos !== undefined || sobre.respEstado !== undefined, {
    message: 'El sobre del RCV no contiene data, datos ni respEstado.',
  });

interface Filas {
  readonly filas: Record<string, unknown>[];
  /** Código 3 del SII sin filas: confirma que no hay movimientos. */
  readonly sinMovimientos: boolean;
}

function filasDelSobre(crudo: unknown, superficie: string): Filas {
  const sobre = Sobre.safeParse(crudo);
  if (!sobre.success) throw new ErrorImpuestocl('PORTAL_CAMBIO', `Respuesta inesperada del RCV (${superficie}).`, { detalle: sobre.error.message });
  const codigo = sobre.data.respEstado?.codRespuesta;
  if (codigo !== undefined && codigo !== null && !CODIGOS_OK.has(String(codigo))) {
    const mensaje = sobre.data.respEstado?.msgeRespuesta ?? `código ${String(codigo)}`;
    throw new ErrorImpuestocl(/autoriza/i.test(mensaje) ? 'SIN_PERMISO' : 'SII_RECHAZO', `RCV: ${mensaje}`);
  }
  const filas = sobre.data.data ?? sobre.data.datos ?? [];
  return { filas, sinMovimientos: filas.length === 0 && String(codigo) === CODIGO_SIN_MOVIMIENTOS };
}

const sufijo = (lado: Lado): string => (lado === 'COMPRA' ? 'Compra' : 'Venta');

export async function rcvResumen(
  http: Http,
  sumidero: SumideroRespuestas,
  rut: Rut,
  periodo: Periodo,
  lado: Lado,
  estado: EstadoRcv,
): Promise<RcvResumen> {
  const crudo = await postSdi(http, sumidero, {
    superficie: `rcv.resumen.${lado}.${estado}`,
    url: `${BASE}/getResumen`,
    namespace: `${NAMESPACE}/getResumen`,
    referer: REFERER,
    conPage: true,
    data: { rutEmisor: String(rut.cuerpo), dvEmisor: rut.dv, ptributario: periodoSii(periodo), estadoContab: ESTADO_WIRE[estado], operacion: lado, busquedaInicial: true },
  });
  const sobre = filasDelSobre(crudo, 'getResumen');
  const filas: RcvResumenFila[] = sobre.filas
    .map((f) => ({
      tipoDoc: entero(primero(f, ['rsmnTipoDocInteger', 'codTipoDoc', 'tipoDoc'])),
      descripcion: texto(primero(f, ['dcvNombreTipoDoc', 'descTipoDoc'])),
      cantidad: entero(primero(f, ['rsmnTotDoc', 'totDoctos'])),
      exento: entero(primero(f, ['rsmnMntExe', 'mntExento'])),
      neto: entero(primero(f, ['rsmnMntNeto', 'mntNeto'])),
      iva: entero(primero(f, ['rsmnMntIVA', 'mntIVA'])),
      total: entero(primero(f, ['rsmnMntTotal', 'mntTotal'])),
    }))
    .filter((f) => f.tipoDoc > 0);
  return { rut: rut.canonico, periodo: periodo.texto, lado, estado, filas, ...(sobre.sinMovimientos ? { sinMovimientos: true as const } : {}) };
}

export async function rcvDetalle(
  http: Http,
  sumidero: SumideroRespuestas,
  rut: Rut,
  periodo: Periodo,
  lado: Lado,
  tipoDoc: number,
  estado: EstadoRcv,
): Promise<DocumentoRcv[]> {
  const crudo = await postSdi(http, sumidero, {
    superficie: `rcv.detalle.${lado}.${estado}.${tipoDoc}`,
    url: `${BASE}/getDetalle${sufijo(lado)}`,
    namespace: `${NAMESPACE}/getDetalle${sufijo(lado)}`,
    referer: REFERER,
    conPage: true,
    data: {
      rutEmisor: String(rut.cuerpo),
      dvEmisor: rut.dv,
      ptributario: periodoSii(periodo),
      estadoContab: ESTADO_WIRE[estado],
      operacion: lado,
      codTipoDoc: String(tipoDoc),
      accionRecaptcha: ACCION_RECAPTCHA[lado],
      tokenRecaptcha: TOKEN_RECAPTCHA,
    },
  });
  return filasDelSobre(crudo, 'getDetalle').filas.map((f) => aDocumento(f, rut, periodo, lado, estado, tipoDoc));
}

function rutContraparte(f: Record<string, unknown>): string {
  const cuerpo = primero(f, ['detRutDoc', 'rutDoc']);
  const dv = primero(f, ['detDvDoc', 'dvDoc']);
  if (cuerpo === undefined || dv === undefined) return 'DESCONOCIDO';
  try {
    return parseRut(`${String(cuerpo)}-${String(dv)}`).canonico;
  } catch {
    return `${String(cuerpo)}-${String(dv)}`;
  }
}

function aDocumento(f: Record<string, unknown>, rut: Rut, periodo: Periodo, lado: Lado, estado: EstadoRcv, tipoDoc: number): DocumentoRcv {
  return {
    rut: rut.canonico,
    periodo: periodo.texto,
    lado,
    estado,
    tipoDoc: entero(primero(f, ['detTipoDoc'])) || tipoDoc,
    rutContraparte: rutContraparte(f),
    folio: entero(primero(f, ['detNroDoc', 'nroDoc', 'folio'])),
    razonSocial: texto(primero(f, ['detRznSoc', 'rznSoc'])),
    fechaEmision: ddmmaaaaAIso(texto(primero(f, ['detFchDoc', 'fchDoc']))),
    fechaRecepcion: ddmmaaaaAIso(texto(primero(f, ['detFecRecepcion', 'fecRecepcion']))),
    fechaAcuse: ddmmaaaaAIso(texto(primero(f, ['detFecAcuse', 'fecAcuse']))),
    montoExento: entero(primero(f, ['detMntExe', 'mntExe'])),
    montoNeto: entero(primero(f, ['detMntNeto', 'mntNeto'])),
    montoIva: entero(primero(f, ['detMntIVA', 'mntIVA'])),
    montoIvaNoRecuperable: entero(primero(f, ['detMntIVANoRec', 'detIVANoRec'])),
    montoIvaUsoComun: entero(primero(f, ['detIVAUsoComun', 'detMntIVAUsoComun'])),
    montoTotal: entero(primero(f, ['detMntTotal', 'mntTotal'])),
    tipoCompra: texto(primero(f, ['detTipoTransaccion'])),
    eventoReceptor: texto(primero(f, ['detEventoReceptor'])),
  };
}
