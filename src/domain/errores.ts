export type CodigoError =
  | 'SESION_REQUERIDA'
  | 'CLAVE_RECHAZADA'
  | 'RUT_BLOQUEADO_LOCAL'
  | 'PORTAL_CAMBIO'
  | 'SII_NO_DISPONIBLE'
  | 'SII_EN_ESPERA'
  | 'SII_RECHAZO'
  | 'CAPTCHA_REQUERIDO'
  | 'SIN_PERMISO'
  | 'RUT_INVALIDO'
  | 'PERIODO_INVALIDO'
  | 'PERFIL_NO_EXISTE'
  | 'CONSULTA_RECHAZADA'
  | 'CONSULTA_INTERRUMPIDA';

const ACCION_POR_DEFECTO: Record<CodigoError, string> = {
  SESION_REQUERIDA: 'Ejecuta `impuestocl login <rut>` para iniciar sesión en el SII.',
  CLAVE_RECHAZADA: 'Revisa la clave tributaria y ejecuta `impuestocl login <rut>`. No se harán intentos automáticos.',
  RUT_BLOQUEADO_LOCAL: 'Hubo una clave rechazada. Ejecuta `impuestocl login <rut>` con la clave correcta para desbloquear.',
  PORTAL_CAMBIO: 'El SII cambió su portal. Revisa la carpeta de diagnóstico y reporta el problema.',
  SII_NO_DISPONIBLE: 'El SII no responde. Intenta de nuevo en unos minutos.',
  SII_EN_ESPERA: 'El SII tiene sala de espera por alta demanda. Intenta más tarde.',
  SII_RECHAZO: 'El SII rechazó la consulta. Revisa el mensaje del SII.',
  CAPTCHA_REQUERIDO: 'Esta consulta exige captcha en el SII y no se puede automatizar.',
  SIN_PERMISO: 'La sesión no tiene permiso para ese RUT. Inicia sesión con la clave de ese contribuyente.',
  RUT_INVALIDO: 'Revisa el RUT (formato 12.345.678-9).',
  PERIODO_INVALIDO: 'Usa el formato AAAA-MM, por ejemplo 2026-09.',
  PERFIL_NO_EXISTE: 'Agrega el perfil con `impuestocl perfil agregar <rut> --alias <nombre> --tipo empresa`.',
  CONSULTA_RECHAZADA: 'Usa una sola sentencia SELECT o WITH sobre las tablas de datos_esquema.',
  CONSULTA_INTERRUMPIDA: 'Simplifica la consulta: filtra por RUT o período, agrega LIMIT o agrupa.',
};

export class ErrorImpuestocl extends Error {
  readonly codigo: CodigoError;
  readonly accion: string;
  readonly detalle: unknown;

  constructor(codigo: CodigoError, mensaje: string, opciones: { accion?: string; detalle?: unknown; cause?: unknown } = {}) {
    super(mensaje, { cause: opciones.cause });
    this.name = 'ErrorImpuestocl';
    this.codigo = codigo;
    this.accion = opciones.accion ?? ACCION_POR_DEFECTO[codigo];
    this.detalle = opciones.detalle;
  }

  toJSON(): { codigo: CodigoError; mensaje: string; accion: string } {
    return { codigo: this.codigo, mensaje: this.message, accion: this.accion };
  }
}

export const esErrorImpuestocl = (e: unknown): e is ErrorImpuestocl => e instanceof ErrorImpuestocl;

/** Errores que detienen una sincronización completa: no tiene sentido seguir con otros períodos. */
export const ERRORES_FATALES: ReadonlySet<CodigoError> = new Set<CodigoError>([
  'SESION_REQUERIDA',
  'CLAVE_RECHAZADA',
  'RUT_BLOQUEADO_LOCAL',
  'SII_EN_ESPERA',
]);
