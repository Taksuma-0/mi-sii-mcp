import { ErrorMiSiiMcp } from '../../domain/errores.js';
import type { AliasAprendido } from '../../domain/portal.js';

/**
 * Nombres con que el SII entrega cada campo, por superficie, y cuáles son obligatorios: los que vinieron en el 100 % de
 * las filas con datos de las respuestas reales revisadas (decisión 0010). Si un obligatorio falta en todas las filas, el
 * SII cambió la respuesta: se detiene la lectura antes que guardar ceros.
 */
export interface DefinicionCampo {
  readonly alias: readonly string[];
  readonly obligatorio: boolean;
}

export type SuperficieMapa = 'rcv.resumen' | 'rcv.detalle' | 'f29.estados';

export const MAPA_CAMPOS: Readonly<Record<SuperficieMapa, Readonly<Record<string, DefinicionCampo>>>> = {
  'rcv.resumen': {
    tipoDoc: { alias: ['rsmnTipoDocInteger', 'codTipoDoc', 'tipoDoc'], obligatorio: true },
    descripcion: { alias: ['dcvNombreTipoDoc', 'descTipoDoc'], obligatorio: false },
    cantidad: { alias: ['rsmnTotDoc', 'totDoctos'], obligatorio: true },
    exento: { alias: ['rsmnMntExe', 'mntExento'], obligatorio: true },
    neto: { alias: ['rsmnMntNeto', 'mntNeto'], obligatorio: true },
    iva: { alias: ['rsmnMntIVA', 'mntIVA'], obligatorio: true },
    total: { alias: ['rsmnMntTotal', 'mntTotal'], obligatorio: true },
  },
  'rcv.detalle': {
    tipoDoc: { alias: ['detTipoDoc'], obligatorio: false },
    rutDoc: { alias: ['detRutDoc', 'rutDoc'], obligatorio: true },
    dvDoc: { alias: ['detDvDoc', 'dvDoc'], obligatorio: true },
    folio: { alias: ['detNroDoc', 'nroDoc', 'folio'], obligatorio: true },
    razonSocial: { alias: ['detRznSoc', 'rznSoc'], obligatorio: false },
    fechaEmision: { alias: ['detFchDoc', 'fchDoc'], obligatorio: true },
    fechaRecepcion: { alias: ['detFecRecepcion', 'fecRecepcion'], obligatorio: false },
    fechaAcuse: { alias: ['detFecAcuse', 'fecAcuse'], obligatorio: false },
    montoExento: { alias: ['detMntExe', 'mntExe'], obligatorio: true },
    montoNeto: { alias: ['detMntNeto', 'mntNeto'], obligatorio: true },
    montoIva: { alias: ['detMntIVA', 'mntIVA'], obligatorio: true },
    montoIvaNoRecuperable: { alias: ['detMntIVANoRec', 'detIVANoRec'], obligatorio: false },
    montoIvaUsoComun: { alias: ['detIVAUsoComun', 'detMntIVAUsoComun'], obligatorio: false },
    montoTotal: { alias: ['detMntTotal', 'mntTotal'], obligatorio: true },
    tipoCompra: { alias: ['detTipoTransaccion'], obligatorio: false },
    eventoReceptor: { alias: ['detEventoReceptor'], obligatorio: false },
  },
  'f29.estados': {
    folio: { alias: ['folio', 'folioDeclaracion'], obligatorio: true },
    estado: { alias: ['estado', 'glosaEstado', 'descripcionEstado'], obligatorio: true },
    estadoId: { alias: ['estadoDeclaracionId'], obligatorio: false },
    fechaPresentacion: { alias: ['declFechaCreacion', 'fechaCreacion', 'fecha'], obligatorio: false },
    codigoInterno: { alias: ['codigo', 'cod'], obligatorio: false },
    totalAPagar: { alias: ['monto', 'total', 'montoTotal'], obligatorio: false },
  },
};

/** Los nombres con que se busca un campo: los aprendidos primero (son los más nuevos) y luego los conocidos. */
export interface MapaCampos {
  alias(superficie: SuperficieMapa, campo: string): readonly string[];
}

export const MAPA_BASE: MapaCampos = { alias: (superficie, campo) => MAPA_CAMPOS[superficie][campo]?.alias ?? [] };

/** El mapa base más los alias aprendidos de respuestas anteriores (validados con los totales del SII). */
export function conAprendidos(base: MapaCampos, aprendidos: readonly AliasAprendido[]): MapaCampos {
  return {
    alias: (superficie, campo) => {
      const nuevos = aprendidos.filter((a) => a.superficie === superficie && a.campo === campo).map((a) => a.alias);
      return [...new Set([...nuevos, ...base.alias(superficie, campo)])];
    },
  };
}

export const presente = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/** Primer valor no vacío del campo según el mapa (como `primero`, con los nombres del mapa). */
export function valorCampo(fila: Record<string, unknown>, superficie: SuperficieMapa, campo: string, mapa: MapaCampos): unknown {
  for (const alias of mapa.alias(superficie, campo)) if (presente(fila[alias])) return fila[alias];
  return undefined;
}

/** Campos obligatorios que ninguna fila trae (con ninguno de sus nombres). Sin filas, nada falta. */
export function camposAusentes(filas: readonly Record<string, unknown>[], superficie: SuperficieMapa, mapa: MapaCampos): string[] {
  if (filas.length === 0) return [];
  return Object.entries(MAPA_CAMPOS[superficie])
    .filter(([, definicion]) => definicion.obligatorio)
    .map(([campo]) => campo)
    .filter((campo) => !filas.some((f) => valorCampo(f, superficie, campo, mapa) !== undefined));
}

/** Llaves con valor que ningún campo del mapa usa: entre ellas suele estar el nombre nuevo de un campo renombrado. */
export function camposSinUsar(filas: readonly Record<string, unknown>[], superficie: SuperficieMapa, mapa: MapaCampos): string[] {
  const usados = new Set(Object.keys(MAPA_CAMPOS[superficie]).flatMap((campo) => mapa.alias(superficie, campo)));
  const sinUsar = new Set<string>();
  for (const f of filas) for (const [llave, v] of Object.entries(f)) if (!usados.has(llave) && presente(v)) sinUsar.add(llave);
  return [...sinUsar].sort();
}

/**
 * Detiene la lectura con PORTAL_CAMBIO si un campo obligatorio falta en todas las filas, con lo que falta y las llaves
 * sin usar. `excepto` deja fuera los campos que se intentan reparar aparte con los totales del SII.
 */
export function exigirCampos(filas: readonly Record<string, unknown>[], superficie: SuperficieMapa, mapa: MapaCampos, nombre: string, excepto: readonly string[] = []): void {
  const faltan = camposAusentes(filas, superficie, mapa).filter((c) => !excepto.includes(c));
  if (faltan.length === 0) return;
  throw new ErrorMiSiiMcp('PORTAL_CAMBIO', `El SII ya no trae ${faltan.join(', ')} en ${nombre}: no se guardó nada nuevo para no reemplazar datos con ceros.`, {
    detalle: { superficie, faltan, sinUsar: camposSinUsar(filas, superficie, mapa) },
  });
}
