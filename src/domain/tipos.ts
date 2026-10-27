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
  /** RUT de la identidad con cuya sesión se entra al SII (p. ej., la persona que representa a la empresa); sin él, la propia. */
  readonly accedeCon?: string;
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

/** Boleta de honorarios electrónica recibida por el contribuyente (`rut`), según el informe mensual del SII. */
export interface BoletaHonorarios {
  /** RUT del receptor: el contribuyente que consulta. */
  readonly rut: string;
  readonly periodo: string;
  readonly rutEmisor: string;
  readonly folio: number;
  readonly nombreEmisor: string | null;
  /** Fecha de la boleta (`AAAA-MM-DD`); null si el SII no la informó. */
  readonly fecha: string | null;
  /** Total de honorarios (bruto). */
  readonly bruto: number;
  /** Retención que hace el receptor. */
  readonly retencion: number;
  readonly liquido: number;
  readonly sociedadProfesional: boolean;
  readonly anulada: boolean;
  /** Fecha de anulación (`AAAA-MM-DD`); null si no está anulada o no se informó. */
  readonly fechaAnulacion: string | null;
}

/** Totales que informa el SII junto a las boletas: cantidad de boletas y sumas de bruto, retención y líquido. */
export interface TotalesBhe {
  readonly total: number;
  readonly bruto: number;
  readonly retencion: number;
  readonly liquido: number;
}

/** Informe mensual de boletas de honorarios recibidas: todas las páginas, sin repetidas. */
export interface InformeBhe {
  readonly boletas: readonly BoletaHonorarios[];
  readonly totales: TotalesBhe;
}

/** Boletas de honorarios guardadas de un mes: cantidad (con anuladas) y montos de las no anuladas. */
export interface TotalesBheMes {
  readonly cantidad: number;
  readonly anuladas: number;
  readonly bruto: number;
  readonly retencion: number;
  readonly liquido: number;
}

/**
 * Atributo del contribuyente en Mi SII. `valor` solo existe para los códigos cuyo valor no es personal (ver
 * `connectors/sii/login.ts`); los demás llegan sin esa clave.
 */
export interface AtributoTributario {
  readonly codigo: string;
  readonly descripcion: string | null;
  readonly fechaInicio: string | null;
  readonly fechaTermino: string | null;
  readonly valor?: string | null;
}

/** Datos tributarios de Mi SII, sin nombres, correos, teléfonos, direcciones ni otros datos personales. */
export interface PerfilTributario {
  /** El SII autoriza declarar y pagar el F29 hasta el día 20; null si no lo informó. */
  readonly autorizadoDia20: boolean | null;
  readonly tipoCodigo: string | null;
  readonly tipoDescripcion: string | null;
  readonly subtipoCodigo: string | null;
  readonly subtipoDescripcion: string | null;
  readonly segmentoCodigo: string | null;
  readonly segmentoDescripcion: string | null;
  readonly glosaActividad: string | null;
  readonly fechaInicioActividades: string | null;
  readonly fechaTerminoGiro: string | null;
  readonly personaEmpresa: string | null;
  readonly atributos: readonly AtributoTributario[];
}

export interface PerfilTributarioGuardado extends PerfilTributario {
  /** Instante ISO UTC en que se leyó de Mi SII. */
  readonly obtenidoEn: string;
}

/** Empresa que el contribuyente autenticado puede consultar en el SII. */
export interface EmpresaAutorizada {
  readonly rutEmpresa: string;
  readonly razonSocial: string | null;
  readonly privilegios: string | null;
  /** Fecha desde la que ya no está autorizada; null mientras sigue activa. */
  readonly fechaDesautorizacion: string | null;
}

/**
 * Declaración anual de renta (F22) de un año tributario, solo con campos permitidos: sin nombres, domicilio, cuenta ni
 * banco. Los montos son null si el SII no los informó.
 */
export interface F22Declaracion {
  readonly rut: string;
  /** Año tributario (AT): el año comercial + 1. */
  readonly anioTributario: number;
  readonly folio: number;
  /** El SII la marca vigente (S/1) o no (N/0); null si no lo informó. */
  readonly vigente: boolean | null;
  readonly codigoConclusion: string | null;
  /** Glosa del SII de `codigoConclusion`. */
  readonly conclusion: string | null;
  /** Fecha de ingreso, `AAAA-MM-DD` si el SII la entrega como `DD/MM/AAAA`. */
  readonly fechaIngreso: string | null;
  readonly tipoImpugnado: string | null;
  readonly remanenteSolicitado: number | null;
  readonly remanenteDevuelto: number | null;
  readonly impuestoPagado: number | null;
  readonly montoGiro: number | null;
  readonly fechaVencimiento: string | null;
}

/** Código del F22 con su glosa del SII; `valor` null si vino vacío, no es numérico o es una fecha. */
export interface F22Valor {
  readonly codigo: string;
  readonly valor: number | null;
  readonly glosa: string | null;
}

export interface F22Observacion {
  readonly codigo: string;
  readonly descripcion: string | null;
  /** Enlace de ayuda del SII; null si no es de sii.cl. No se guarda en la base. */
  readonly url: string | null;
}

export interface F22Evento {
  /** Posición en la lista del SII, desde 1. */
  readonly orden: number;
  readonly codigoEvento: string | null;
  readonly nombre: string | null;
  /** `AAAA-MM-DD` si el SII la entrega como `DD/MM/AAAA`. */
  readonly fecha: string | null;
  readonly tipo: string | null;
  readonly codigoCarta: string | null;
}

/** Detalle de un folio del F22: códigos (sin los de identificación), observaciones y eventos. */
export interface F22Detalle {
  readonly valores: readonly F22Valor[];
  readonly observaciones: readonly F22Observacion[];
  readonly eventos: readonly F22Evento[];
}
