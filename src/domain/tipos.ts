export type Lado = 'COMPRA' | 'VENTA';
export type EstadoRcv = 'REGISTRO' | 'PENDIENTE' | 'NO_INCLUIR' | 'RECLAMADO';
export const ESTADOS_RCV: readonly EstadoRcv[] = ['REGISTRO', 'PENDIENTE', 'NO_INCLUIR', 'RECLAMADO'];
export type TipoContribuyente = 'persona' | 'empresa';

/** Una fuente es conocida si existe una consulta completa exitosa, aunque haya resultado vacía. */
export interface DisponibilidadFuentes {
  readonly ventasRcv: boolean;
  readonly comprasRcv: boolean;
  readonly f29: boolean;
  /** Propuesta de F29 (superficie `f29.propuesta`). */
  readonly propuestaF29: boolean;
  /** Boletas de honorarios recibidas (superficie `bhe.recibidas`). */
  readonly bheRecibidas: boolean;
}

export interface Perfil {
  readonly rut: string;
  readonly alias: string;
  readonly tipo: TipoContribuyente;
  readonly representa: readonly string[];
  readonly razonSocial: string | null;
}

export interface RcvResumenFila {
  readonly tipoDoc: number;
  readonly descripcion: string | null;
  readonly cantidad: number;
  readonly exento: number;
  readonly neto: number;
  readonly iva: number;
  readonly total: number;
}

export interface RcvResumen {
  readonly rut: string;
  readonly periodo: string;
  readonly lado: Lado;
  readonly estado: EstadoRcv;
  readonly filas: readonly RcvResumenFila[];
  /** El SII confirmó que no hay movimientos (código 3 sin filas); un vacío sin esta marca es ambiguo. */
  readonly sinMovimientos?: true;
}

export interface DocumentoRcv {
  readonly rut: string;
  readonly periodo: string;
  readonly lado: Lado;
  readonly estado: EstadoRcv;
  readonly tipoDoc: number;
  readonly rutContraparte: string;
  readonly folio: number;
  readonly razonSocial: string | null;
  readonly fechaEmision: string | null;
  readonly fechaRecepcion: string | null;
  readonly fechaAcuse: string | null;
  readonly montoExento: number;
  readonly montoNeto: number;
  readonly montoIva: number;
  readonly montoIvaNoRecuperable: number;
  readonly montoIvaUsoComun: number;
  readonly montoTotal: number;
  readonly tipoCompra: string | null;
  readonly eventoReceptor: string | null;
}

export interface F29Declaracion {
  readonly rut: string;
  readonly periodo: string;
  /** 0 cuando la declaración solo está guardada, no presentada. */
  readonly folio: number;
  readonly estado: string;
  /** `estadoDeclaracionId` del SII (10 guardada, 70 rechazada); null si no lo informó o es un dato anterior. */
  readonly estadoId: number | null;
  readonly fechaPresentacion: string | null;
  /** `codigo` del portal, necesario para descargar el PDF compacto (`codInt`). */
  readonly codigoInterno: number | null;
  readonly totalAPagar: number | null;
}

export interface F29Valores {
  readonly rut: string;
  readonly periodo: string;
  readonly folio: number;
  /** código del formulario → valor (montos en pesos; tasas como decimal). */
  readonly valores: Readonly<Record<string, number>>;
  /** Versión del lector de PDF que obtuvo los valores, cuando vienen de leer el PDF compacto. */
  readonly versionLector?: string;
}

export type OrigenLecturaF29 = 'sincronizacion' | 'relectura';

/** Cómo se obtuvieron los valores guardados de un folio: con qué lector, desde dónde, cuándo y si el autocontrol cuadró. */
export interface LecturaF29 {
  readonly versionLector: string;
  readonly origen: OrigenLecturaF29;
  readonly leidoEn: string;
  /** La lectura es confiable: leída, con 538 y 537 legibles y sin incoherencias (`lecturaConfiable`). */
  readonly coherente: boolean;
}

export interface LecturaFolioF29 extends LecturaF29 {
  readonly folio: number;
}

export interface FilaSnapshot {
  readonly clave: string;
  readonly estado: EstadoRcv;
  readonly sha: string;
}

export interface SnapshotRcv {
  readonly sincronizacionId: number;
  readonly lado: Lado;
  readonly obtenidoEn: string;
  readonly filas: readonly FilaSnapshot[];
}

export type Severidad = 'info' | 'advertencia' | 'critico';
export type Naturaleza = 'HECHO' | 'DERIVADO';

export interface Hallazgo {
  readonly regla: string;
  readonly severidad: Severidad;
  readonly naturaleza: Naturaleza;
  readonly rut: string;
  readonly periodo: string;
  readonly titulo: string;
  readonly detalle: string;
  readonly montos: { readonly esperado: number; readonly declarado: number; readonly diferencia: number } | null;
  readonly evidencia: readonly string[];
}

export type TipoPlazo = 'F29' | 'RECLAMO_FACTURA';

export interface Plazo {
  readonly rut: string;
  readonly tipo: TipoPlazo;
  readonly vence: string;
  readonly diasRestantes: number;
  readonly descripcion: string;
  readonly referencia: string | null;
}

export interface RespuestaCruda {
  readonly superficie: string;
  readonly parametros: Readonly<Record<string, unknown>>;
  readonly cuerpo: string;
  readonly obtenidoEn: string;
}

/** Identificador estable de un documento: `LADO:tipo:rutContraparte:folio`. */
export const claveDocumento = (d: Pick<DocumentoRcv, 'lado' | 'tipoDoc' | 'rutContraparte' | 'folio'>): string =>
  `${d.lado}:${d.tipoDoc}:${d.rutContraparte}:${d.folio}`;

/**
 * Propuesta de F29 que prepara el SII para un mes. Trae crédito, remanente y retención propuestos; no trae débito ni
 * total a pagar. Los códigos van sin ceros a la izquierda y nunca incluyen los de identificación del contribuyente.
 */
export interface PropuestaF29 {
  readonly rut: string;
  readonly periodo: string;
  /** Tipo de propuesta según el SII (40 con propuesta, 48 sin propuesta); null si no lo informó. */
  readonly tipoPropuesta: number | null;
  readonly descripcionTipo: string | null;
  /** Estado del cálculo de la propuesta (5 cuando no hay propuesta); null si no lo informó. */
  readonly estadoCalculo: number | null;
  readonly propuestos: Readonly<Record<string, number>>;
  readonly administrativos: Readonly<Record<string, number>>;
  /** El SII no armó una propuesta para el mes: ambas listas vienen vacías. */
  readonly sinPropuesta: boolean;
}
