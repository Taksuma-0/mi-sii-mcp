import type { Periodo } from '../../domain/periodo.js';
import { parseRut } from '../../domain/rut.js';
import type { DocumentoRcv, EstadoRcv, F29Declaracion, F29Valores, Lado, PropuestaF29, RcvResumen } from '../../domain/tipos.js';
import type { LectorPdfF29, SiiReader, SumideroRespuestas } from '../../ports/index.js';
import { f29Declaraciones, f29Valores } from './f29.js';
import { lectorPdfF29 } from './f29-pdf.js';
import type { Http } from './http.js';
import { f29Propuesta } from './propuesta.js';
import { rcvDetalle, rcvResumen } from './rcv.js';

/** Lee el portal del SII con una sesión ya iniciada (clave tributaria). */
export class LectorPortalSii implements SiiReader {
  constructor(
    private readonly http: Http,
    private readonly sumidero: SumideroRespuestas,
    /** Lee el PDF compacto del F29; el contenedor inyecta el mismo que usa la relectura. */
    private readonly lectorPdf: LectorPdfF29 = lectorPdfF29,
  ) {}

  rcvResumen(rut: string, periodo: Periodo, lado: Lado, estado: EstadoRcv): Promise<RcvResumen> {
    return rcvResumen(this.http, this.sumidero, parseRut(rut), periodo, lado, estado);
  }

  rcvDetalle(rut: string, periodo: Periodo, lado: Lado, tipoDoc: number, estado: EstadoRcv): Promise<DocumentoRcv[]> {
    return rcvDetalle(this.http, this.sumidero, parseRut(rut), periodo, lado, tipoDoc, estado);
  }

  f29Declaraciones(rut: string, periodo: Periodo): Promise<F29Declaracion[]> {
    return f29Declaraciones(this.http, this.sumidero, parseRut(rut), periodo);
  }

  f29Valores(rut: string, declaracion: F29Declaracion): Promise<F29Valores> {
    return f29Valores(this.http, this.sumidero, parseRut(rut), declaracion, this.lectorPdf);
  }

  f29Propuesta(rut: string, periodo: Periodo): Promise<PropuestaF29 | null> {
    return f29Propuesta(this.http, this.sumidero, parseRut(rut), periodo);
  }
}
