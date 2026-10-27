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
  | 'CONSULTA_INTERRUMPIDA'
  | 'SII_SESIONES_MAXIMAS'
  | 'RESPUESTA_VACIA'
  | 'DATOS_INCOMPLETOS'
  | 'LECTURA_INCOHERENTE'
  | 'RESPALDO_FALLIDO';

export const ACCION_POR_DEFECTO: Readonly<Record<CodigoError, string>> = {
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
  SII_SESIONES_MAXIMAS: 'El SII tiene demasiadas sesiones abiertas para este RUT. Cierra la sesión del SII en el navegador u otros equipos y reintenta en unos minutos.',
  RESPUESTA_VACIA: 'El SII respondió sin datos donde antes había; se conservan los datos anteriores. Reintenta más tarde.',
  DATOS_INCOMPLETOS: 'El SII entregó menos documentos que su propio resumen; se conserva el último conjunto completo. Reintenta más tarde.',
  LECTURA_INCOHERENTE: 'El F29 leído no cuadra; se conserva la lectura anterior. Puede que el SII haya cambiado el formulario.',
  RESPALDO_FALLIDO: 'No se migró la base porque no se pudo respaldar; revisa espacio en disco o que OneDrive/antivirus no bloquee la carpeta.',
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
  'SII_SESIONES_MAXIMAS',
]);

/** Si conviene volver a intentar: de inmediato (tras corregir la petición), más tarde (falla del SII) o no (requiere una decisión de la persona). */
export type Reintento = 'inmediato' | 'mas_tarde' | 'no';

export const REINTENTO: Readonly<Record<CodigoError, Reintento>> = {
  SESION_REQUERIDA: 'no',
  CLAVE_RECHAZADA: 'no',
  RUT_BLOQUEADO_LOCAL: 'no',
  PORTAL_CAMBIO: 'no',
  SII_NO_DISPONIBLE: 'mas_tarde',
  SII_EN_ESPERA: 'mas_tarde',
  SII_RECHAZO: 'no',
  CAPTCHA_REQUERIDO: 'no',
  SIN_PERMISO: 'no',
  RUT_INVALIDO: 'no',
  PERIODO_INVALIDO: 'no',
  PERFIL_NO_EXISTE: 'no',
  CONSULTA_RECHAZADA: 'no',
  CONSULTA_INTERRUMPIDA: 'inmediato',
  SII_SESIONES_MAXIMAS: 'mas_tarde',
  RESPUESTA_VACIA: 'mas_tarde',
  DATOS_INCOMPLETOS: 'mas_tarde',
  LECTURA_INCOHERENTE: 'no',
  RESPALDO_FALLIDO: 'mas_tarde',
};

/** `codigo` es texto porque los errores de sincronización no lo tipan: CANCELADO se reintenta ya; ERROR_INTERNO y los desconocidos no. */
export function reintentoDe(codigo: string): Reintento {
  if (codigo === 'CANCELADO') return 'inmediato';
  return Object.hasOwn(REINTENTO, codigo) ? REINTENTO[codigo as CodigoError] : 'no';
}
