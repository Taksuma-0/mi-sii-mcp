export type Lado = 'COMPRA' | 'VENTA';
export type EstadoRcv = 'REGISTRO' | 'PENDIENTE' | 'NO_INCLUIR' | 'RECLAMADO';
export const ESTADOS_RCV: readonly EstadoRcv[] = ['REGISTRO', 'PENDIENTE', 'NO_INCLUIR', 'RECLAMADO'];
export type TipoContribuyente = 'persona' | 'empresa';

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
