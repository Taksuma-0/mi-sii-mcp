import type { Periodo } from '../../domain/periodo.js';
import { parseRut } from '../../domain/rut.js';
import type { DocumentoRcv, EmpresaAutorizada, EstadoRcv, F22Declaracion, F22Detalle, F29Declaracion, F29Valores, InformeBhe, Lado, PerfilTributario, PropuestaF29, RcvResumen } from '../../domain/tipos.js';
import type { LectorPdfF29, SiiReader, SumideroRespuestas } from '../../ports/index.js';
import { bheRecibidas } from './bhe.js';
import { empresasAutorizadas } from './empresas.js';
import { f22Declaraciones, f22Detalle } from './f22.js';
import { f29Declaraciones, f29Valores } from './f29.js';
import { lectorPdfF29 } from './f29-pdf.js';
import type { Http } from './http.js';
import { leerPerfilTributario } from './login.js';
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

  bheRecibidas(rut: string, periodo: Periodo): Promise<InformeBhe | null> {
    return bheRecibidas(this.http, this.sumidero, parseRut(rut), periodo);
  }

  /** La evidencia cruda de Mi SII no se guarda: trae datos personales y el sumidero no la recibe. */
  perfilTributario(rut: string): Promise<PerfilTributario> {
    return leerPerfilTributario(this.http, parseRut(rut).canonico);
  }

  empresasAutorizadas(): Promise<EmpresaAutorizada[]> {
    return empresasAutorizadas(this.http, this.sumidero);
  }

  f22Declaraciones(rut: string, anioTributario: number): Promise<F22Declaracion[]> {
    return f22Declaraciones(this.http, this.sumidero, parseRut(rut), anioTributario);
  }

  f22Detalle(rut: string, anioTributario: number, folio: number): Promise<F22Detalle> {
    return f22Detalle(this.http, this.sumidero, parseRut(rut), anioTributario, folio);
  }
}
