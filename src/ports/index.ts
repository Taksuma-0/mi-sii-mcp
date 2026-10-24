import type { Periodo } from '../domain/periodo.js';
import type {
  DisponibilidadFuentes,
  DocumentoRcv,
  EstadoRcv,
  F29Declaracion,
  F29Valores,
  Hallazgo,
  Lado,
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
  ): void;
  resumenesRcv(rut: string, periodo: string): RcvResumen[];
  documentosRcv(rut: string, periodo: string, filtro?: FiltroDocumentos): DocumentoRcv[];
  declaracionesF29(rut: string, periodo: string): F29Declaracion[];
  valoresF29(rut: string, periodo: string, folio: number): F29Valores | null;
  snapshotsRcv(rut: string, periodo: string): SnapshotRcv[];
  disponibilidadFuentes(rut: string, periodo: string): DisponibilidadFuentes;
  frescura(rut: string, periodo: string): Frescura;
  periodosConDatos(rut: string): string[];
  reemplazarHallazgos(rut: string, periodo: string, hallazgos: readonly Hallazgo[], versionReglas: string, calculadoEn: string): void;
  hallazgos(rut: string, filtro?: FiltroHallazgos): HallazgoGuardado[];
}
