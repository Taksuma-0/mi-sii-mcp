import { ErrorImpuestocl } from '../../src/domain/errores.js';
import type { Periodo } from '../../src/domain/periodo.js';
import type { DocumentoRcv, EstadoRcv, F29Declaracion, F29Valores, Lado, RcvResumen, RcvResumenFila } from '../../src/domain/tipos.js';
import type { SiiReader, SumideroRespuestas } from '../../src/ports/index.js';

/**
 * SII en memoria. Llaves de datos:
 * - resumenes: `periodo|lado|estado`
 * - detalles: `periodo|lado|estado|tipo`
 * - declaraciones: `periodo`
 * - valores: `periodo|folio`
 * Cada llamada queda en `llamadas` (p. ej. `resumen|2026-09|VENTA|REGISTRO`); `fallas` usa ese mismo texto.
 */
export class SiiFalso implements SiiReader {
  sumidero: SumideroRespuestas = () => {};
  readonly llamadas: string[] = [];
  readonly resumenes = new Map<string, RcvResumenFila[]>();
  readonly detalles = new Map<string, DocumentoRcv[]>();
  readonly declaraciones = new Map<string, F29Declaracion[]>();
  readonly valores = new Map<string, F29Valores>();
  readonly fallas = new Map<string, Error>();

  private registrar(llamada: string): void {
    this.llamadas.push(llamada);
    this.sumidero({ superficie: llamada, parametros: {}, cuerpo: '{}', obtenidoEn: '2026-10-21T12:00:00.000Z' });
    const falla = this.fallas.get(llamada);
    if (falla) throw falla;
  }

  async rcvResumen(rut: string, periodo: Periodo, lado: Lado, estado: EstadoRcv): Promise<RcvResumen> {
    this.registrar(`resumen|${periodo.texto}|${lado}|${estado}`);
    return { rut, periodo: periodo.texto, lado, estado, filas: this.resumenes.get(`${periodo.texto}|${lado}|${estado}`) ?? [] };
  }

  async rcvDetalle(_rut: string, periodo: Periodo, lado: Lado, tipoDoc: number, estado: EstadoRcv): Promise<DocumentoRcv[]> {
    this.registrar(`detalle|${periodo.texto}|${lado}|${estado}|${tipoDoc}`);
    return this.detalles.get(`${periodo.texto}|${lado}|${estado}|${tipoDoc}`) ?? [];
  }

  async f29Declaraciones(_rut: string, periodo: Periodo): Promise<F29Declaracion[]> {
    this.registrar(`f29|${periodo.texto}`);
    return this.declaraciones.get(periodo.texto) ?? [];
  }

  async f29Valores(_rut: string, d: F29Declaracion): Promise<F29Valores> {
    this.registrar(`f29valores|${d.periodo}|${d.folio}`);
    const v = this.valores.get(`${d.periodo}|${d.folio}`);
    if (!v) throw new ErrorImpuestocl('PORTAL_CAMBIO', 'El PDF del F29 no trajo valores.');
    return v;
  }
}
