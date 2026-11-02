import * as z from 'zod';
import { ErrorMiSiiMcp } from '../../domain/errores.js';
import { ddmmaaaaAIso } from '../../domain/fechas.js';
import { periodoSii, type Periodo } from '../../domain/periodo.js';
import { parseRut, type Rut } from '../../domain/rut.js';
import type { DocumentoRcv, EstadoRcv, Lado, RcvResumen, RcvResumenFila } from '../../domain/tipos.js';
import type { SumideroRespuestas } from '../../ports/index.js';
import type { AliasAprendido } from '../../domain/portal.js';
import { entero, numeroChileno, texto } from './campos.js';
import type { Http } from './http.js';
import { camposAusentes, camposSinUsar, conAprendidos, exigirCampos, MAPA_BASE, valorCampo, type MapaCampos } from './mapa-campos.js';
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
  if (!sobre.success) throw new ErrorMiSiiMcp('PORTAL_CAMBIO', `Respuesta inesperada del RCV (${superficie}).`, { detalle: sobre.error.message });
  const codigo = sobre.data.respEstado?.codRespuesta;
  if (codigo !== undefined && codigo !== null && !CODIGOS_OK.has(String(codigo))) {
    const mensaje = sobre.data.respEstado?.msgeRespuesta ?? `código ${String(codigo)}`;
    throw new ErrorMiSiiMcp(/autoriza/i.test(mensaje) ? 'SIN_PERMISO' : 'SII_RECHAZO', `RCV: ${mensaje}`);
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
  mapa: MapaCampos = MAPA_BASE,
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
  exigirCampos(sobre.filas, 'rcv.resumen', mapa, 'el resumen del RCV');
  const campo = (f: Record<string, unknown>, nombre: string): unknown => valorCampo(f, 'rcv.resumen', nombre, mapa);
  const filas: RcvResumenFila[] = sobre.filas
    .map((f) => ({
      tipoDoc: entero(campo(f, 'tipoDoc')),
      descripcion: texto(campo(f, 'descripcion')),
      cantidad: entero(campo(f, 'cantidad')),
      exento: entero(campo(f, 'exento')),
      neto: entero(campo(f, 'neto')),
      iva: entero(campo(f, 'iva')),
      total: entero(campo(f, 'total')),
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
  opciones: OpcionesDetalle = {},
): Promise<DocumentoRcv[]> {
  const mapa = opciones.mapa ?? MAPA_BASE;
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
  const filas = filasDelSobre(crudo, 'getDetalle').filas;
  exigirCampos(filas, 'rcv.detalle', mapa, 'el detalle del RCV', MONTOS.map(([campo]) => campo));
  const reparado = repararMontos(filas, opciones, mapa, tipoDoc, periodo);
  return filas.map((f) => aDocumento(f, rut, periodo, lado, estado, tipoDoc, reparado));
}

/** Totales del resumen del mismo tipo de documento, con los que se comprueba el detalle. */
export type TotalesResumen = Pick<RcvResumenFila, 'cantidad' | 'exento' | 'neto' | 'iva' | 'total'>;

export interface OpcionesDetalle {
  /** Nombres de los campos (los conocidos más los aprendidos); por defecto, los conocidos. */
  readonly mapa?: MapaCampos;
  /** Fila del resumen del mismo tipo: si un monto cambió de nombre, se busca el nombre nuevo que cuadre con ella. */
  readonly esperado?: TotalesResumen;
  /** Recibe cada nombre nuevo adoptado, para guardarlo y avisar. */
  readonly alAprender?: (alias: AliasAprendido) => void;
}

/** Montos del detalle y su total en el resumen: el detalle cuadra al peso con el resumen (28 de 28 grupos reales). */
const MONTOS: readonly (readonly [string, 'exento' | 'neto' | 'iva' | 'total'])[] = [
  ['montoExento', 'exento'],
  ['montoNeto', 'neto'],
  ['montoIva', 'iva'],
  ['montoTotal', 'total'],
];

const sumaDe = (filas: readonly Record<string, unknown>[], llave: string): number => filas.reduce((s, f) => s + Math.trunc(numeroChileno(f[llave]) ?? 0), 0);

/**
 * Si un monto falta en todos los documentos, adopta el único campo sin usar, numérico en todos, cuya suma iguala al peso el
 * total del resumen (con la misma cantidad de documentos y un total distinto de 0). Si no hay exactamente uno, o no hay
 * resumen con qué comprobar, es PORTAL_CAMBIO: nunca se adivina ni se guardan ceros.
 */
function repararMontos(filas: readonly Record<string, unknown>[], opciones: OpcionesDetalle, mapa: MapaCampos, tipoDoc: number, periodo: Periodo): MapaCampos {
  const faltan = camposAusentes(filas, 'rcv.detalle', mapa).filter((campo) => MONTOS.some(([monto]) => monto === campo));
  let actual = mapa;
  for (const campo of faltan) {
    const clave = MONTOS.find(([monto]) => monto === campo)![1];
    const sinUsar = camposSinUsar(filas, 'rcv.detalle', actual);
    const esperado = opciones.esperado;
    const comprobable = esperado !== undefined && esperado[clave] !== 0 && esperado.cantidad === filas.length;
    const candidatos = comprobable ? sinUsar.filter((llave) => filas.every((f) => numeroChileno(f[llave]) !== null) && sumaDe(filas, llave) === esperado[clave]) : [];
    if (candidatos.length !== 1) {
      throw new ErrorMiSiiMcp('PORTAL_CAMBIO', `El SII ya no trae ${campo} en el detalle del RCV y no se pudo comprobar con el resumen cuál es su nombre nuevo: no se guardó nada nuevo.`, {
        detalle: { superficie: 'rcv.detalle', faltan: [campo], sinUsar, candidatos },
      });
    }
    const alias = candidatos[0]!;
    const aprendido: AliasAprendido = {
      superficie: 'rcv.detalle',
      campo,
      alias,
      aprendidoEn: new Date().toISOString(),
      evidencia: `suma de ${alias} = ${clave} del resumen (tipo ${tipoDoc}, ${periodo.texto}, ${filas.length} documentos)`,
    };
    actual = conAprendidos(actual, [aprendido]);
    opciones.alAprender?.(aprendido);
  }
  return actual;
}

function rutContraparte(f: Record<string, unknown>, mapa: MapaCampos): string {
  const cuerpo = valorCampo(f, 'rcv.detalle', 'rutDoc', mapa);
  const dv = valorCampo(f, 'rcv.detalle', 'dvDoc', mapa);
  if (cuerpo === undefined || dv === undefined) return 'DESCONOCIDO';
  try {
    return parseRut(`${String(cuerpo)}-${String(dv)}`).canonico;
  } catch {
    return `${String(cuerpo)}-${String(dv)}`;
  }
}

function aDocumento(f: Record<string, unknown>, rut: Rut, periodo: Periodo, lado: Lado, estado: EstadoRcv, tipoDoc: number, mapa: MapaCampos): DocumentoRcv {
  const campo = (nombre: string): unknown => valorCampo(f, 'rcv.detalle', nombre, mapa);
  return {
    rut: rut.canonico,
    periodo: periodo.texto,
    lado,
    estado,
    tipoDoc: entero(campo('tipoDoc')) || tipoDoc,
    rutContraparte: rutContraparte(f, mapa),
    folio: entero(campo('folio')),
    razonSocial: texto(campo('razonSocial')),
    fechaEmision: ddmmaaaaAIso(texto(campo('fechaEmision'))),
    fechaRecepcion: ddmmaaaaAIso(texto(campo('fechaRecepcion'))),
    fechaAcuse: ddmmaaaaAIso(texto(campo('fechaAcuse'))),
    montoExento: entero(campo('montoExento')),
    montoNeto: entero(campo('montoNeto')),
    montoIva: entero(campo('montoIva')),
    montoIvaNoRecuperable: entero(campo('montoIvaNoRecuperable')),
    montoIvaUsoComun: entero(campo('montoIvaUsoComun')),
    montoTotal: entero(campo('montoTotal')),
    tipoCompra: texto(campo('tipoCompra')),
    eventoReceptor: texto(campo('eventoReceptor')),
  };
}
