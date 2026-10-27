import type { BheEmitidaMes, BoletaHonorarios, BoletaHonorariosEmitida, DocumentoRcv, EmpresaAutorizada, F22Declaracion, F22Detalle, F29Declaracion, F29Valores, InformeBheEmitidas, Perfil, PerfilTributario, PropuestaF29, RcvResumen, RcvResumenFila } from '../../src/domain/tipos.js';

export const RUT_EMPRESA = '22222222-2';
export const RUT_PERSONA = '11111111-1';
export const RUT_PROVEEDOR = '33333333-3';
export const RUT_CLIENTE = '44444444-4';

export const perfilEmpresa = (o: Partial<Perfil> = {}): Perfil => ({
  rut: RUT_EMPRESA,
  alias: 'Mi Pyme',
  tipo: 'empresa',
  representa: [],
  razonSocial: 'EMPRESA DEMO SPA',
  ...o,
});

export const perfilPersona = (o: Partial<Perfil> = {}): Perfil => ({
  rut: RUT_PERSONA,
  alias: 'Yo',
  tipo: 'persona',
  representa: [RUT_EMPRESA],
  razonSocial: null,
  ...o,
});

export const fila = (tipoDoc: number, neto: number, iva: number, cantidad = 1): RcvResumenFila => ({
  tipoDoc,
  descripcion: null,
  cantidad,
  exento: 0,
  neto,
  iva,
  total: neto + iva,
});

export const resumen = (o: Partial<RcvResumen> = {}): RcvResumen => ({
  rut: RUT_EMPRESA,
  periodo: '2026-09',
  lado: 'VENTA',
  estado: 'REGISTRO',
  filas: [fila(33, 1_000_000, 190_000, 2)],
  ...o,
});

export const documento = (o: Partial<DocumentoRcv> = {}): DocumentoRcv => ({
  rut: RUT_EMPRESA,
  periodo: '2026-09',
  lado: 'COMPRA',
  estado: 'REGISTRO',
  tipoDoc: 33,
  rutContraparte: RUT_PROVEEDOR,
  folio: 100,
  razonSocial: 'PROVEEDOR DEMO LTDA',
  fechaEmision: '2026-09-05',
  fechaRecepcion: '2026-09-05 10:00:00',
  fechaAcuse: null,
  montoExento: 0,
  montoNeto: 100_000,
  montoIva: 19_000,
  montoIvaNoRecuperable: 0,
  montoIvaUsoComun: 0,
  montoTotal: 119_000,
  tipoCompra: '1',
  eventoReceptor: null,
  ...o,
});

export const declaracion = (o: Partial<F29Declaracion> = {}): F29Declaracion => ({
  rut: RUT_EMPRESA,
  periodo: '2026-09',
  folio: 555_001,
  estado: 'Vigente',
  estadoId: 1,
  fechaPresentacion: '2026-10-15',
  codigoInterno: 9001,
  totalAPagar: 171_000,
  ...o,
});

export const valores = (v: Record<string, number>, o: Partial<F29Valores> = {}): F29Valores => ({
  rut: RUT_EMPRESA,
  periodo: '2026-09',
  folio: 555_001,
  valores: v,
  ...o,
});

export const propuesta = (o: Partial<PropuestaF29> = {}): PropuestaF29 => ({
  rut: RUT_EMPRESA,
  periodo: '2026-09',
  tipoPropuesta: 40,
  descripcionTipo: 'Propuesta con crédito de documentos',
  estadoCalculo: 1,
  propuestos: { '511': 900_000, '520': 950_000, '519': 50_000, '504': 120_000, '151': 30_000 },
  administrativos: { '9114': 1 },
  sinPropuesta: false,
  ...o,
});

export const RUT_HONORARIOS = '55555555-5';

export const boleta = (o: Partial<BoletaHonorarios> = {}): BoletaHonorarios => ({
  rut: RUT_EMPRESA,
  periodo: '2026-09',
  rutEmisor: RUT_HONORARIOS,
  folio: 101,
  nombreEmisor: 'Profesional Ficticio',
  fecha: '2026-09-05',
  bruto: 1_000_000,
  retencion: 152_500,
  liquido: 847_500,
  sociedadProfesional: false,
  anulada: false,
  fechaAnulacion: null,
  ...o,
});

export const perfilTributario = (o: Partial<PerfilTributario> = {}): PerfilTributario => ({
  autorizadoDia20: true,
  tipoCodigo: '1',
  tipoDescripcion: 'Primera Categoría',
  subtipoCodigo: '10',
  subtipoDescripcion: 'Sociedad por acciones',
  segmentoCodigo: '5',
  segmentoDescripcion: 'Segmento ficticio',
  glosaActividad: 'SERVICIOS DE ASESORIA DE EJEMPLO',
  fechaInicioActividades: '2020-03-02',
  fechaTerminoGiro: null,
  personaEmpresa: 'E',
  atributos: [
    { codigo: '14TT', descripcion: 'Régimen Pro Pyme Transparente 14 D N°8', fechaInicio: '2025-01-01', fechaTermino: null, valor: 'S' },
    { codigo: 'NOTI', descripcion: 'Notificación por correo electrónico', fechaInicio: '2021-01-01', fechaTermino: null },
  ],
  ...o,
});

export const empresaAutorizada = (o: Partial<EmpresaAutorizada> = {}): EmpresaAutorizada => ({
  rutEmpresa: RUT_PROVEEDOR,
  razonSocial: 'OTRA EMPRESA DEMO LTDA',
  privilegios: 'CONSULTA',
  fechaDesautorizacion: null,
  ...o,
});

export const declaracionF22 = (o: Partial<F22Declaracion> = {}): F22Declaracion => ({
  rut: RUT_EMPRESA,
  anioTributario: 2026,
  folio: 123_456_789,
  vigente: true,
  codigoConclusion: '07',
  conclusion: 'Conclusión ficticia: declaración sin observaciones',
  fechaIngreso: '2026-04-15',
  tipoImpugnado: null,
  remanenteSolicitado: 0,
  remanenteDevuelto: 0,
  impuestoPagado: 1_234_567,
  montoGiro: 0,
  fechaVencimiento: '2026-04-30',
  ...o,
});

export const detalleF22 = (o: Partial<F22Detalle> = {}): F22Detalle => ({
  valores: [
    { codigo: '305', valor: -250_000, glosa: 'Resultado liquidación anual ficticio' },
    { codigo: '87', valor: 250_000, glosa: 'Monto devolución solicitada ficticia' },
    { codigo: '15', valor: null, glosa: 'Fecha ficticia' },
  ],
  observaciones: [{ codigo: 'A01', descripcion: 'Observación ficticia', url: 'https://www.sii.cl/ayuda/ficticia.html' }],
  eventos: [{ orden: 1, codigoEvento: 'E01', nombre: 'Declaración recibida', fecha: '2026-04-15', tipo: 'INFO', codigoCarta: null }],
  ...o,
});

/** Un mes sin boletas emitidas, con los datos que se indiquen. */
export const mesBheEmitida = (mes: number, o: Partial<BheEmitidaMes> = {}): BheEmitidaMes => ({
  mes,
  bruto: 0,
  retencionTerceros: 0,
  retencionPropia: 0,
  vigentes: 0,
  anuladas: 0,
  folioInicial: null,
  folioFinal: null,
  ...o,
});

/** Informe anual de boletas emitidas: los 12 meses en 0 salvo los indicados por número de mes. */
export const informeBheEmitidas = (anioComercial: number, meses: Readonly<Record<number, Partial<BheEmitidaMes>>> = {}): InformeBheEmitidas => ({
  anioComercial,
  sociedadProfesional: false,
  meses: Array.from({ length: 12 }, (_, i) => mesBheEmitida(i + 1, meses[i + 1])),
});

/** Boleta emitida vigente por la persona sintética a un cliente sintético. */
export const boletaEmitida = (o: Partial<BoletaHonorariosEmitida> = {}): BoletaHonorariosEmitida => ({
  rut: RUT_PERSONA,
  periodo: '2025-03',
  folio: 1,
  rutReceptor: RUT_PROVEEDOR,
  nombreReceptor: 'Cliente Ficticio SpA',
  fecha: '2025-03-05',
  fechaEmision: '2025-03-05',
  bruto: 500_000,
  retencionEmisor: 0,
  retencionReceptor: 68_750,
  liquido: 431_250,
  sociedadProfesional: false,
  anulada: false,
  fechaAnulacion: null,
  ...o,
});
