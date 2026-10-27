import { ErrorImpuestocl } from '../../domain/errores.js';
import type { Periodo } from '../../domain/periodo.js';
import type { DocumentoRcv, EmpresaAutorizada, EstadoRcv, F22Declaracion, F22Detalle, F29Declaracion, F29Valores, InformeBhe, Lado, PerfilTributario, PropuestaF29, RcvResumen } from '../../domain/tipos.js';
import type { SiiReader } from '../../ports/index.js';

/** Sin la prueba con una sesión real (T21) no se sabe si el SII entrega el RCV de la empresa a su representante. */
export const AVISO_REPRESENTACION = 'lectura por representación sin confirmar en vivo';
const ACCION_SESION_PROPIA = 'Inicia sesión con la identidad del contribuyente (login o login-navegador).';

/**
 * Lee un contribuyente con la sesión de otra identidad (`rutAcceso`, p. ej. la persona que representa a la empresa).
 * Solo el RCV se pide por representación (`rutEmisor` = el contribuyente), con aviso porque no está confirmado en vivo.
 * F29, propuesta, boletas, F22, perfil y empresas autorizadas exigen la sesión propia: SIN_PERMISO sin llamar al SII.
 * La sesión de quien accede (`abrir`) se abre recién en la primera consulta del RCV: lo demás no toca Mi SII ni el llavero.
 */
export class LectorPorRepresentacion implements SiiReader {
  readonly aviso: string;
  private base: Promise<SiiReader> | null = null;

  constructor(
    private readonly abrir: () => Promise<SiiReader>,
    private readonly rutAcceso: string,
  ) {
    this.aviso = `${AVISO_REPRESENTACION} (sesión de ${rutAcceso})`;
  }

  async rcvResumen(rut: string, periodo: Periodo, lado: Lado, estado: EstadoRcv): Promise<RcvResumen> {
    return (await this.lector()).rcvResumen(rut, periodo, lado, estado);
  }

  async rcvDetalle(rut: string, periodo: Periodo, lado: Lado, tipoDoc: number, estado: EstadoRcv): Promise<DocumentoRcv[]> {
    return (await this.lector()).rcvDetalle(rut, periodo, lado, tipoDoc, estado);
  }

  /** Abre una sola vez la sesión de quien accede; si falla, el mismo error vale para el resto de la llamada (un único login con la clave guardada). */
  private lector(): Promise<SiiReader> {
    this.base ??= this.abrir();
    return this.base;
  }

  f29Declaraciones(rut: string, _periodo: Periodo): Promise<F29Declaracion[]> {
    return this.sinPermiso('el F29', rut);
  }

  f29Valores(rut: string, _declaracion: F29Declaracion): Promise<F29Valores> {
    return this.sinPermiso('el F29', rut);
  }

  f29Propuesta(rut: string, _periodo: Periodo): Promise<PropuestaF29 | null> {
    return this.sinPermiso('la propuesta de F29', rut);
  }

  bheRecibidas(rut: string, _periodo: Periodo): Promise<InformeBhe | null> {
    return this.sinPermiso('las boletas de honorarios', rut);
  }

  perfilTributario(rut: string): Promise<PerfilTributario> {
    return this.sinPermiso('el perfil tributario', rut);
  }

  empresasAutorizadas(): Promise<EmpresaAutorizada[]> {
    return this.sinPermiso('las empresas autorizadas', null);
  }

  f22Declaraciones(rut: string, _anioTributario: number): Promise<F22Declaracion[]> {
    return this.sinPermiso('la renta (F22)', rut);
  }

  f22Detalle(rut: string, _anioTributario: number, _folio: number): Promise<F22Detalle> {
    return this.sinPermiso('la renta (F22)', rut);
  }

  private async sinPermiso(area: string, rut: string | null): Promise<never> {
    const de = rut === null ? 'del contribuyente' : `de ${rut}`;
    throw new ErrorImpuestocl('SIN_PERMISO', `Para leer ${area} ${de} hace falta su propia sesión; la configurada es la de ${this.rutAcceso}.`, { accion: ACCION_SESION_PROPIA });
  }
}
