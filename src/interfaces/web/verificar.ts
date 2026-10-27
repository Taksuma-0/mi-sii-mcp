import type { DepsApp } from '../../app/deps.js';
import { plazos, resumenIva } from '../../app/consultas.js';
import { registrarIdentidad } from '../../app/perfiles.js';
import { sincronizar } from '../../app/sincronizar.js';
import { ErrorMiSiiMcp, esErrorMiSiiMcp, type CodigoError } from '../../domain/errores.js';
import { parsePeriodo, periodoAnterior } from '../../domain/periodo.js';
import { parseRut } from '../../domain/rut.js';
import { crearContenedor } from '../../main/contenedor.js';
import type { IdentidadSii, ResultadoLogin, SecretStore } from '../../ports/index.js';
import { textoPlazos, textoResumenIva, textoSync } from '../formato.js';

export interface EntradaVerificacion {
  readonly rut: string;
  readonly clave: string;
  readonly mes: string;
}

export interface ResultadoVerificacion {
  readonly estado: 'completo' | 'parcial';
  readonly sincronizacion: string;
  readonly resumen: string;
  readonly plazos: string;
  readonly codigosF29: Readonly<Record<string, number>> | null;
}

export interface ContenedorWeb {
  readonly deps: DepsApp;
  readonly sesiones: {
    loginInteractivo(rut: string, clave: string, guardarClave: boolean): Promise<ResultadoLogin>;
    /** Login en el navegador de la persona (ClaveÚnica o clave): devuelve solo la identidad, nunca cookies. */
    loginNavegador(rutEsperado?: string): Promise<IdentidadSii>;
  };
  cerrar(): void;
}

export type FabricaContenedorWeb = (opciones: { secretos: SecretStore }) => ContenedorWeb;

/** La interfaz local no lee ni escribe claves del llavero. */
export class SecretosNulos implements SecretStore {
  async obtener(_rut: string): Promise<null> { return null; }
  async guardar(_rut: string, _clave: string): Promise<void> {}
  async borrar(_rut: string): Promise<void> {}
}

const MENSAJES: Readonly<Record<CodigoError, string>> = {
  SESION_REQUERIDA: 'La sesión del SII terminó. Ingresa nuevamente tus datos para otra consulta.',
  CLAVE_RECHAZADA: 'El SII rechazó la clave. Revisa tus datos antes de volver a enviarlos. No se reintentará automáticamente.',
  RUT_BLOQUEADO_LOCAL: 'Hubo una clave rechazada. Revisa la clave y vuelve a enviarla sólo cuando sea correcta.',
  PORTAL_CAMBIO: 'La respuesta del portal cambió y no se pudo interpretar. Revisa la guía de solución de problemas del proyecto.',
  SII_NO_DISPONIBLE: 'El SII no está disponible. Puedes volver a intentarlo más tarde.',
  SII_EN_ESPERA: 'El SII tiene una sala de espera. Puedes volver a intentarlo más tarde.',
  SII_LIMITE: 'El SII está limitando las consultas. Se detuvo la sincronización; puedes volver a intentarlo más tarde.',
  SII_RECHAZO: 'El SII rechazó la consulta. Revisa tu acceso al portal antes de volver a intentarlo.',
  CAPTCHA_REQUERIDO: 'El SII requiere un captcha. Completa la gestión directamente en el portal del SII.',
  SIN_PERMISO: 'La sesión no tiene permiso para ese RUT. Revisa el RUT y su clave tributaria.',
  RUT_INVALIDO: 'Revisa el RUT y su dígito verificador.',
  PERIODO_INVALIDO: 'Elige meses válidos entre enero de 2000 y diciembre de 2100, en orden y con un máximo de 120 meses por consulta.',
  PERFIL_NO_EXISTE: 'No se pudo preparar el perfil para la consulta. Cierra y vuelve a abrir la aplicación.',
  CONSULTA_RECHAZADA: 'La consulta no está permitida. Usa una sola sentencia SELECT o WITH.',
  CONSULTA_INTERRUMPIDA: 'La consulta tardó demasiado y se detuvo. Simplifica la consulta y vuelve a intentarlo.',
  SII_SESIONES_MAXIMAS: 'El SII tiene demasiadas sesiones abiertas para este RUT. Cierra la sesión del SII en otros navegadores o equipos y vuelve a intentarlo en unos minutos.',
  RESPUESTA_VACIA: 'El SII respondió sin datos; si había datos anteriores, se conservan. Puedes volver a intentarlo más tarde.',
  DATOS_INCOMPLETOS: 'El SII entregó menos documentos de los esperados. Se conserva el último conjunto completo; puedes volver a intentarlo más tarde.',
  LECTURA_INCOHERENTE: 'La lectura del F29 no cuadra, así que se conserva la anterior. Puede que el SII haya cambiado el formulario.',
  RESPALDO_FALLIDO: 'No se pudo respaldar la base antes de actualizarla, así que no se actualizó. Revisa el espacio en disco o que OneDrive o el antivirus no bloqueen la carpeta.',
  NAVEGADOR_NO_DISPONIBLE: 'No se pudo abrir Microsoft Edge ni Google Chrome en este equipo. Instala uno de ellos o entra con tu clave tributaria.',
};

/** Nunca expone mensajes, causas o cuerpos recibidos del SII. */
export function errorPublico(error: unknown): { codigo: string; mensaje: string } {
  return esErrorMiSiiMcp(error)
    ? { codigo: error.codigo, mensaje: MENSAJES[error.codigo] }
    : { codigo: 'ERROR_INTERNO', mensaje: 'No se pudo completar la consulta. Puedes volver a intentarlo. Si persiste, cierra y vuelve a abrir la aplicación.' };
}

export async function verificar(entrada: EntradaVerificacion, fabrica: FabricaContenedorWeb = crearContenedor): Promise<ResultadoVerificacion> {
  const rut = parseRut(entrada.rut).canonico;
  const mes = parsePeriodo(entrada.mes);
  const anterior = periodoAnterior(mes);
  if (typeof entrada.clave !== 'string' || entrada.clave.length === 0) throw new ErrorMiSiiMcp('CLAVE_RECHAZADA', 'Ingresa tu clave tributaria.');
  const contenedor = fabrica({ secretos: new SecretosNulos() });
  try {
    const login = await contenedor.sesiones.loginInteractivo(rut, entrada.clave, false);
    registrarIdentidad(contenedor.deps, login.identidad);
    const sync = await sincronizar(contenedor.deps, rut, anterior, mes, ['rcv', 'f29']);
    const resumen = resumenIva(contenedor.deps, rut, mes.texto);
    const seguro = { ...sync, abortado: sync.abortado ? { ...sync.abortado, mensaje: errorPublico(new ErrorMiSiiMcp(sync.abortado.codigo as CodigoError, '')).mensaje } : null };
    return {
      estado: sync.abortado || sync.periodos.some((p) => p.errores.length > 0 || p.avisos.length > 0) ? 'parcial' : 'completo',
      sincronizacion: textoSync(seguro),
      resumen: textoResumenIva(resumen),
      plazos: textoPlazos(plazos(contenedor.deps, rut)),
      codigosF29: resumen.f29?.valores ?? null,
    };
  } finally {
    contenedor.cerrar();
  }
}
