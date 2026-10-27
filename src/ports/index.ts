import type { Periodo } from '../domain/periodo.js';
import type {
  DisponibilidadFuentes,
  DocumentoRcv,
  EstadoRcv,
  F29Declaracion,
  F29Valores,
  Hallazgo,
  Lado,
  LecturaF29,
  LecturaFolioF29,
  Perfil,
  RcvResumen,
  RespuestaCruda,
  Severidad,
  SnapshotRcv,
  TipoContribuyente,
} from '../domain/tipos.js';

/** Recibe cada respuesta cruda del SII, para guardarla como evidencia. */
export type SumideroRespuestas = (respuesta: RespuestaCruda) => void;

export interface SiiReader {
  rcvResumen(rut: string, periodo: Periodo, lado: Lado, estado: EstadoRcv): Promise<RcvResumen>;
  rcvDetalle(rut: string, periodo: Periodo, lado: Lado, tipoDoc: number, estado: EstadoRcv): Promise<DocumentoRcv[]>;
  f29Declaraciones(rut: string, periodo: Periodo): Promise<F29Declaracion[]>;
  f29Valores(rut: string, declaracion: F29Declaracion): Promise<F29Valores>;
}

/** Lee los códigos del PDF compacto del F29. La sincronización y la relectura usan el mismo, así su versión dice qué lector se usó. */
export interface LectorPdfF29 {
  readonly version: string;
  extraer(bytes: Uint8Array): Promise<Record<string, number>>;
}

/** PDF compacto del F29 guardado como evidencia de una sincronización. */
export interface PdfF29Guardado {
  readonly periodo: string;
  readonly folio: number;
  readonly bytes: Uint8Array;
  readonly obtenidoEn: string;
}

export interface LecturaF29Guardada extends LecturaF29 {
  /** Cantidad de códigos guardados del folio. */
  readonly codigos: number;
}

export interface SecretStore {
  obtener(rut: string): Promise<string | null>;
  guardar(rut: string, clave: string): Promise<void>;
  borrar(rut: string): Promise<void>;
}

export interface Reloj {
  ahora(): Date;
}

export interface EstadoSesion {
  readonly tieneSesion: boolean;
  readonly guardadaEn: string | null;
  readonly bloqueado: boolean;
}

export interface ConsultaSesiones {
  estado(rut: string): EstadoSesion;
}

export interface IdentidadSii {
  readonly rut: string;
  readonly nombre: string;
  readonly razonSocial: string | null;
  readonly tipo: TipoContribuyente;
}

export interface ResultadoLogin {
  readonly identidad: IdentidadSii;
  readonly claveGuardada: boolean;
}

export interface FiltroDocumentos {
  readonly lado?: Lado;
  readonly estado?: EstadoRcv;
  readonly tipoDoc?: number;
  readonly rutContraparte?: string;
}

export interface DocumentosPaginados {
  readonly total: number;
  readonly documentos: readonly DocumentoRcv[];
}

export interface FiltroHallazgos {
  readonly desde?: string;
  readonly hasta?: string;
  readonly severidad?: Severidad;
}

export interface HallazgoGuardado extends Hallazgo {
  readonly versionReglas: string;
  readonly calculadoEn: string;
}

export interface Frescura {
  readonly rcv: string | null;
  readonly f29: string | null;
  readonly propuesta: string | null;
  readonly bhe: string | null;
}

/** Topes de una consulta libre: filas, caracteres del JSON compacto de las filas, largo de cada celda de texto y plazo. */
export interface LimitesConsulta {
  readonly filas: number;
  readonly caracteres: number;
  readonly caracteresCelda: number;
  readonly milisegundos: number;
}

export interface OpcionesConsulta {
  readonly limites: LimitesConsulta;
  /** Tipos de documento que restan (notas de crédito): dan `signo = -1` en la copia. */
  readonly tiposNegativos: readonly number[];
}

export interface ResultadoConsulta {
  readonly columnas: readonly string[];
  readonly filas: readonly (readonly unknown[])[];
  /** true si se omitieron filas o se recortaron celdas por los límites. */
  readonly truncado: boolean;
}

/** SQL de solo lectura sobre una copia curada de la base, sin tokens ni respuestas crudas. */
export interface ConsultaLibre {
  consultar(sql: string, opciones: OpcionesConsulta): Promise<ResultadoConsulta>;
}

export interface Store {
  guardarContribuyente(perfil: Perfil): void;
  contribuyente(rut: string): Perfil | null;
  contribuyentes(): Perfil[];
  iniciarSincronizacion(rut: string, superficie: string, periodo: string, inicio: string): number;
  terminarSincronizacion(id: number, fin: string, estado: 'ok' | 'error', error?: { codigo: string; detalle: string }): void;
  guardarRespuestaCruda(sincronizacionId: number, respuesta: RespuestaCruda): void;
  reemplazarRcv(
    sincronizacionId: number,
    rut: string,
    periodo: string,
    lado: Lado,
    resumenes: readonly RcvResumen[],
    documentos: readonly DocumentoRcv[],
    obtenidoEn: string,
  ): void;
  guardarF29(
    sincronizacionId: number,
    rut: string,
    periodo: string,
    declaraciones: readonly F29Declaracion[],
    valores: readonly F29Valores[],
    obtenidoEn: string,
    /** Lecturas nuevas; las de folios que siguen declarados y con valores se conservan, las demás se borran. */
    lecturas?: readonly LecturaFolioF29[],
  ): void;
  /** Reemplaza solo los valores de un folio ya declarado y registra su lectura, en una transacción. */
  reemplazarValoresFolioF29(rut: string, periodo: string, folio: number, valores: Readonly<Record<string, number>>, lectura: LecturaF29): void;
  lecturaF29(rut: string, periodo: string, folio: number): LecturaF29Guardada | null;
  /** El PDF válido más nuevo de cada período y folio guardado como evidencia, de cualquier sincronización; ordenado por período y folio. */
  pdfsF29Guardados(rut: string, desde?: string, hasta?: string): PdfF29Guardado[];
  resumenesRcv(rut: string, periodo: string): RcvResumen[];
  documentosRcv(rut: string, periodo: string, filtro?: FiltroDocumentos): DocumentoRcv[];
  documentosRcvPaginados(rut: string, periodo: string, filtro: FiltroDocumentos, pagina: number, tamano: number): DocumentosPaginados;
  declaracionesF29(rut: string, periodo: string): F29Declaracion[];
  valoresF29(rut: string, periodo: string, folio: number): F29Valores | null;
  snapshotsRcv(rut: string, periodo: string): SnapshotRcv[];
  disponibilidadFuentes(rut: string, periodo: string): DisponibilidadFuentes;
  frescura(rut: string, periodo: string): Frescura;
  periodosConDatos(rut: string): string[];
  reemplazarHallazgos(rut: string, periodo: string, hallazgos: readonly Hallazgo[], versionReglas: string, calculadoEn: string): void;
  hallazgos(rut: string, filtro?: FiltroHallazgos): HallazgoGuardado[];
}
