import { ErrorImpuestocl } from '../../src/domain/errores.js';
import type { Periodo } from '../../src/domain/periodo.js';
import type { DocumentoRcv, EmpresaAutorizada, EstadoRcv, F22Declaracion, F22Detalle, F29Declaracion, F29Valores, InformeBhe, InformeBheEmitidas, Lado, PerfilTributario, PropuestaF29, RcvResumen, RcvResumenFila } from '../../src/domain/tipos.js';
import type { SiiReader, SumideroRespuestas } from '../../src/ports/index.js';

/**
 * SII en memoria. Llaves de datos:
 * - resumenes: `periodo|lado|estado`
 * - detalles: `periodo|lado|estado|tipo`
 * - declaraciones: `periodo`
 * - valores: `periodo|folio`
 * - propuestas: `periodo` (null = el SII respondió sin datos)
 * - bhe: `periodo` (null = vacío ambiguo; sin entrada = mes sin boletas)
 * - bheEmitidas: año comercial (sin entrada = el año con los 12 meses en 0); llamada `bheemitidas|anio`
 * - perfil y empresas: una sola respuesta cada una (`perfil` null = Mi SII sin datos); las llamadas quedan como `perfil` y `empresas`
 * - f22: `anio` (sin entrada = sin declaraciones); f22Detalles: `anio|folio` (sin entrada = detalle vacío); llamadas `f22|anio` y `f22detalle|anio|folio`
 * Cada llamada queda en `llamadas` (p. ej. `resumen|2026-09|VENTA|REGISTRO`); `fallas` usa ese mismo texto.
 * `alLlamar` corre en cada llamada, antes de responder (por ejemplo, para cancelar a mitad de camino).
 * Un resumen sin filas llega con "sin movimientos" explícito (código 3), salvo con `vaciosAmbiguos`.
 * Valores sin códigos fallan como el conector ante un PDF ilegible.
 */
export class SiiFalso implements SiiReader {
  sumidero: SumideroRespuestas = () => {};
  /** Aviso del lector (p. ej., lectura por representación). */
  aviso: string | undefined = undefined;
  readonly llamadas: string[] = [];
  readonly resumenes = new Map<string, RcvResumenFila[]>();
  readonly detalles = new Map<string, DocumentoRcv[]>();
  readonly declaraciones = new Map<string, F29Declaracion[]>();
  readonly valores = new Map<string, F29Valores>();
  readonly propuestas = new Map<string, PropuestaF29 | null>();
  readonly bhe = new Map<string, InformeBhe | null>();
  readonly bheEmitidas = new Map<number, InformeBheEmitidas>();
  readonly fallas = new Map<string, Error>();
  readonly f22 = new Map<number, F22Declaracion[]>();
  readonly f22Detalles = new Map<string, F22Detalle>();
  perfil: PerfilTributario | null = null;
  empresas: EmpresaAutorizada[] = [];
  alLlamar: (llamada: string) => void | Promise<void> = () => {};
  /** Entrega los resúmenes vacíos sin la marca `sinMovimientos`, como un vacío ambiguo del SII. */
  vaciosAmbiguos = false;

  private async registrar(llamada: string): Promise<void> {
    this.llamadas.push(llamada);
    this.sumidero({ superficie: llamada, parametros: {}, cuerpo: '{}', obtenidoEn: '2026-10-21T12:00:00.000Z' });
    await this.alLlamar(llamada);
    const falla = this.fallas.get(llamada);
    if (falla) throw falla;
  }

  async rcvResumen(rut: string, periodo: Periodo, lado: Lado, estado: EstadoRcv): Promise<RcvResumen> {
    await this.registrar(`resumen|${periodo.texto}|${lado}|${estado}`);
    const filas = this.resumenes.get(`${periodo.texto}|${lado}|${estado}`) ?? [];
    const sinMovimientos = filas.length === 0 && !this.vaciosAmbiguos;
    return { rut, periodo: periodo.texto, lado, estado, filas, ...(sinMovimientos ? { sinMovimientos: true as const } : {}) };
  }

  async rcvDetalle(_rut: string, periodo: Periodo, lado: Lado, tipoDoc: number, estado: EstadoRcv): Promise<DocumentoRcv[]> {
    await this.registrar(`detalle|${periodo.texto}|${lado}|${estado}|${tipoDoc}`);
    return this.detalles.get(`${periodo.texto}|${lado}|${estado}|${tipoDoc}`) ?? [];
  }

  async f29Declaraciones(_rut: string, periodo: Periodo): Promise<F29Declaracion[]> {
    await this.registrar(`f29|${periodo.texto}`);
    return this.declaraciones.get(periodo.texto) ?? [];
  }

  async f29Valores(_rut: string, d: F29Declaracion): Promise<F29Valores> {
    await this.registrar(`f29valores|${d.periodo}|${d.folio}`);
    const v = this.valores.get(`${d.periodo}|${d.folio}`);
    if (!v) throw new ErrorImpuestocl('PORTAL_CAMBIO', 'El PDF del F29 no trajo valores.');
    if (Object.keys(v.valores).length === 0) throw new ErrorImpuestocl('PORTAL_CAMBIO', `El PDF del F29 de ${d.periodo} no trajo códigos legibles.`);
    return v;
  }

  async f29Propuesta(_rut: string, periodo: Periodo): Promise<PropuestaF29 | null> {
    await this.registrar(`propuesta|${periodo.texto}`);
    return this.propuestas.get(periodo.texto) ?? null;
  }

  async bheRecibidas(_rut: string, periodo: Periodo): Promise<InformeBhe | null> {
    await this.registrar(`bhe|${periodo.texto}`);
    const informe = this.bhe.get(periodo.texto);
    return informe === undefined ? { boletas: [], totales: { total: 0, bruto: 0, retencion: 0, liquido: 0 } } : informe;
  }

  async bheEmitidasAnual(_rut: string, anioComercial: number): Promise<InformeBheEmitidas> {
    await this.registrar(`bheemitidas|${anioComercial}`);
    const vacio = (mes: number) => ({ mes, bruto: 0, retencionTerceros: 0, retencionPropia: 0, vigentes: 0, anuladas: 0, folioInicial: null, folioFinal: null });
    return this.bheEmitidas.get(anioComercial) ?? { anioComercial, sociedadProfesional: false, meses: Array.from({ length: 12 }, (_, i) => vacio(i + 1)) };
  }

  async perfilTributario(_rut: string): Promise<PerfilTributario> {
    await this.registrar('perfil');
    if (!this.perfil) throw new ErrorImpuestocl('PORTAL_CAMBIO', 'Mi SII no entregó datos del contribuyente.');
    return this.perfil;
  }

  async empresasAutorizadas(): Promise<EmpresaAutorizada[]> {
    await this.registrar('empresas');
    return this.empresas;
  }

  async f22Declaraciones(_rut: string, anioTributario: number): Promise<F22Declaracion[]> {
    await this.registrar(`f22|${anioTributario}`);
    return this.f22.get(anioTributario) ?? [];
  }

  async f22Detalle(_rut: string, anioTributario: number, folio: number): Promise<F22Detalle> {
    await this.registrar(`f22detalle|${anioTributario}|${folio}`);
    return this.f22Detalles.get(`${anioTributario}|${folio}`) ?? { valores: [], observaciones: [], eventos: [] };
  }
}
