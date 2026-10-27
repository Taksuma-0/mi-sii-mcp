import type { Periodo } from '../domain/periodo.js';
import type {
  BheEmitidaMes,
  BoletaHonorarios,
  DisponibilidadFuentes,
  DocumentoRcv,
  EmpresaAutorizada,
  EstadoRcv,
  F22Declaracion,
  F22Detalle,
  F29Declaracion,
  F29Valores,
  Hallazgo,
  InformeBhe,
  InformeBheEmitidas,
  InformeBheEmitidasMes,
  Lado,
  LecturaF29,
  LecturaFolioF29,
  Perfil,
  PerfilTributario,
  PerfilTributarioGuardado,
  PropuestaF29,
  RcvResumen,
  RespuestaCruda,
  Severidad,
  SnapshotRcv,
  TipoContribuyente,
  TotalesBheMes,
} from '../domain/tipos.js';

/** Recibe cada respuesta cruda del SII, para guardarla como evidencia. */
export type SumideroRespuestas = (respuesta: RespuestaCruda) => void;

export interface SiiReader {
  /** Aviso que acompaña toda lectura de este lector (p. ej., una lectura por representación sin confirmar en vivo). */
  readonly aviso?: string;
  rcvResumen(rut: string, periodo: Periodo, lado: Lado, estado: EstadoRcv): Promise<RcvResumen>;
  rcvDetalle(rut: string, periodo: Periodo, lado: Lado, tipoDoc: number, estado: EstadoRcv): Promise<DocumentoRcv[]>;
  f29Declaraciones(rut: string, periodo: Periodo): Promise<F29Declaracion[]>;
  f29Valores(rut: string, declaracion: F29Declaracion): Promise<F29Valores>;
  /** Propuesta de F29 del SII para el mes, o null si el SII no devolvió datos. */
  f29Propuesta(rut: string, periodo: Periodo): Promise<PropuestaF29 | null>;
  /** Boletas de honorarios recibidas del mes (todas las páginas), o null si el SII respondió vacío sin confirmar que no hay boletas. */
  bheRecibidas(rut: string, periodo: Periodo): Promise<InformeBhe | null>;
  /** Informe anual de boletas de honorarios emitidas por el contribuyente en un año comercial (los 12 meses). */
  bheEmitidasAnual(rut: string, anioComercial: number): Promise<InformeBheEmitidas>;
  /** Boletas de honorarios emitidas del mes, una por una (todas las páginas), o null si el SII respondió vacío sin confirmar que no hay boletas. */
  bheEmitidasMes(rut: string, periodo: Periodo): Promise<InformeBheEmitidasMes | null>;
  /** Datos tributarios de Mi SII del contribuyente de la sesión (lista permitida, sin datos personales). */
  perfilTributario(rut: string): Promise<PerfilTributario>;
  /** Empresas que el contribuyente de la sesión puede consultar en el SII. */
  empresasAutorizadas(): Promise<EmpresaAutorizada[]>;
  /** Declaraciones de renta (F22) del año tributario, solo con campos permitidos; vacía si el SII no informó ninguna. */
  f22Declaraciones(rut: string, anioTributario: number): Promise<F22Declaracion[]>;
  /** Códigos (sin los de identificación), observaciones y eventos de un folio del F22. */
  f22Detalle(rut: string, anioTributario: number, folio: number): Promise<F22Detalle>;
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

/** Declaración F22 guardada, con el instante en que se leyó del SII. */
export interface F22DeclaracionGuardada extends F22Declaracion {
  readonly obtenidoEn: string;
}

/** Mes guardado del informe anual de boletas de honorarios emitidas, con su año comercial y el instante de la lectura. */
export interface BheEmitidaMesGuardado extends BheEmitidaMes {
  readonly anioComercial: number;
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
  /** 'navegador' si la sesión se tomó del navegador (login-navegador): no se renueva sola. */
  readonly origen?: 'navegador';
  /** Si la sesión se renueva sola cuando vence (hay clave guardada y no vino del navegador); ausente si no se averiguó. */
  readonly renuevaSola?: boolean;
}

export interface ConsultaSesiones {
  estado(rut: string): EstadoSesion;
  /** Si hay clave guardada en el llavero del sistema para el RUT (nunca devuelve la clave). */
  claveGuardada?(rut: string): Promise<boolean>;
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
  /** Reemplaza la propuesta F29 del mes (cabecera y valores) en una transacción. */
  reemplazarPropuestaF29(sincronizacionId: number, rut: string, periodo: string, propuesta: PropuestaF29, obtenidoEn: string): void;
  propuestaF29(rut: string, periodo: string): PropuestaF29 | null;
  /** Reemplaza las boletas de honorarios recibidas del mes en una transacción. */
  reemplazarBhe(sincronizacionId: number, rut: string, periodo: string, boletas: readonly BoletaHonorarios[], obtenidoEn: string): void;
  boletasHonorarios(rut: string, periodo: string): BoletaHonorarios[];
  /** Reemplaza el perfil tributario del contribuyente. */
  guardarPerfilTributario(rut: string, perfil: PerfilTributario, obtenidoEn: string): void;
  perfilTributario(rut: string): PerfilTributarioGuardado | null;
  /** Reemplaza la lista completa de empresas autorizadas del contribuyente en una transacción. */
  reemplazarEmpresasAutorizadas(sincronizacionId: number, rut: string, empresas: readonly EmpresaAutorizada[], obtenidoEn: string): void;
  /** Empresas autorizadas guardadas (activas y desautorizadas), ordenadas por RUT. */
  empresasAutorizadas(rut: string): EmpresaAutorizada[];
  /** Reemplaza las declaraciones F22 del año tributario y borra el detalle de los folios que ya no están, en una transacción. */
  reemplazarF22Declaraciones(sincronizacionId: number, rut: string, anioTributario: number, declaraciones: readonly F22Declaracion[], obtenidoEn: string): void;
  /** Reemplaza el detalle del F22 del año (valores, observaciones y eventos) por el de un folio, el vigente, en una transacción: borra el de los demás folios del año. */
  reemplazarF22Detalle(rut: string, anioTributario: number, folio: number, detalle: F22Detalle): void;
  /** Declaraciones F22 guardadas (de un año o de todos), del año más nuevo al más antiguo y por folio. */
  declaracionesF22(rut: string, anioTributario?: number): F22DeclaracionGuardada[];
  /** Detalle guardado de un folio del F22 (listas vacías si no hay); las observaciones vuelven sin enlace. */
  detalleF22(rut: string, anioTributario: number, folio: number): F22Detalle;
  /** Reemplaza los meses guardados de boletas de honorarios emitidas de un año comercial en una transacción. */
  reemplazarBheEmitidas(sincronizacionId: number, rut: string, anioComercial: number, meses: readonly BheEmitidaMes[], obtenidoEn: string): void;
  /** Meses guardados de boletas de honorarios emitidas (de un año comercial o de todos), del año más nuevo al más antiguo y por mes. */
  bheEmitidas(rut: string, anioComercial?: number): BheEmitidaMesGuardado[];
  /** Cantidad de boletas guardadas del mes (con anuladas) y montos de las no anuladas. */
  totalesBhe(rut: string, periodo: string): TotalesBheMes;
  /** Estado y código de error del intento más reciente de una superficie en un mes; null si nunca se intentó. */
  ultimaSincronizacion(rut: string, superficie: string, periodo: string): { readonly estado: 'en_curso' | 'ok' | 'error'; readonly errorCodigo: string | null } | null;
  snapshotsRcv(rut: string, periodo: string): SnapshotRcv[];
  disponibilidadFuentes(rut: string, periodo: string): DisponibilidadFuentes;
  frescura(rut: string, periodo: string): Frescura;
  periodosConDatos(rut: string): string[];
  reemplazarHallazgos(rut: string, periodo: string, hallazgos: readonly Hallazgo[], versionReglas: string, calculadoEn: string): void;
  hallazgos(rut: string, filtro?: FiltroHallazgos): HallazgoGuardado[];
}
