import type { DocumentoRcv, F29Declaracion, F29Valores, Perfil, PropuestaF29, RcvResumen, RcvResumenFila } from '../../src/domain/tipos.js';

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
