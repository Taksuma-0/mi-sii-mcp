import { ErrorMiSiiMcp } from '../domain/errores.js';
import { f22Vigente, parseAnioTributario } from '../domain/renta.js';
import { estimarRenta, type DatosRenta, type EstimacionRenta, type ParametrosRenta } from '../reconciliation/estimar-renta.js';
import { perfilExistente } from './consultas.js';
import type { DepsApp } from './deps.js';

export interface ParametrosEstimacionRenta extends ParametrosRenta {
  /** Factores de actualización del año comercial, de enero a diciembre (diciembre = 1); sin ellos, montos nominales. */
  readonly factoresIpc?: readonly number[];
  readonly gastosEfectivos?: number;
  readonly apvRegimenB?: number;
  readonly otrasRentas?: number;
  /** Sueldos y su impuesto único, si no están en la DJ del empleador guardada o se quieren corregir. */
  readonly sueldos?: number;
  readonly impuestoUnicoRetenido?: number;
}

export interface ResultadoEstimacionRenta extends EstimacionRenta {
  readonly rut: string;
  readonly anioTributario: number;
  readonly datos: DatosRenta;
  /** El F22 vigente guardado y su código 305 (resultado: negativo es devolución); null si no hay. */
  readonly f22: { readonly folio: number; readonly resultado305: number | null } | null;
  /** Estimado menos el 305 del F22; null sin F22. */
  readonly diferenciaConF22: number | null;
}

function validar(p: ParametrosEstimacionRenta): void {
  const invalido = (mensaje: string): never => {
    throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', mensaje);
  };
  if (p.tablaIgc.length === 0) invalido('Falta la tabla del Impuesto Global Complementario del año (fuentes_oficiales).');
  if (!(p.uta > 0)) invalido('La UTA de diciembre debe ser mayor que cero.');
  if (!(p.gastosPresuntosPct >= 0 && p.gastosPresuntosPct <= 100)) invalido('El porcentaje de gastos presuntos va entre 0 y 100.');
  if (!(p.topeGastosPresuntosUta >= 0)) invalido('El tope de gastos presuntos (en UTA) no puede ser negativo.');
  if (p.factoresIpc !== undefined && (p.factoresIpc.length !== 12 || p.factoresIpc.some((f) => !(f > 0)))) invalido('Los factores de actualización son 12, de enero a diciembre, mayores que cero.');
}

/**
 * Estima el F22 de una persona para un año tributario con lo guardado (boletas emitidas del año comercial, sueldos de la
 * DJ del empleador) y los datos públicos que se informan. Si hay un F22 vigente guardado, compara con su resultado (305).
 */
export function estimacionRenta(deps: DepsApp, rutTexto: string, anioTexto: string, p: ParametrosEstimacionRenta): ResultadoEstimacionRenta {
  const perfil = perfilExistente(deps, rutTexto);
  if (perfil.tipo !== 'persona') throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'renta_estimar estima la renta de una persona; para una empresa usa contabilidad_resultado y regimen_simular.');
  validar(p);
  const anio = parseAnioTributario(anioTexto);
  const supuestos: string[] = [];
  const meses = deps.store.bheEmitidas(perfil.rut, anio - 1);
  if (meses.length === 0) supuestos.push(`Sin boletas emitidas guardadas de ${anio - 1}: usa renta_sincronizar del AT${anio} para traerlas.`);
  if (p.factoresIpc === undefined && meses.length > 0) supuestos.push('Honorarios y retenciones sin actualizar por IPC: el F22 los actualiza (pasa factores_ipc para comparar exacto).');
  const factor = (mes: number): number => p.factoresIpc?.[mes - 1] ?? 1;
  const honorariosBrutos = Math.round(meses.reduce((s, m) => s + m.bruto * factor(m.mes), 0));
  const retencionHonorarios = Math.round(meses.reduce((s, m) => s + (m.retencionTerceros + m.retencionPropia) * factor(m.mes), 0));
  const dj1887 = deps.store.djTerceros(perfil.rut, anio).filter((f) => f.dj === 1887);
  if (dj1887.length > 0 && p.sueldos === undefined) supuestos.push('Sueldos e impuesto único tomados de la DJ 1887 del empleador (forma aún no verificada con datos reales).');
  const datos: DatosRenta = {
    honorariosBrutos,
    retencionHonorarios,
    sueldos: p.sueldos ?? dj1887.reduce((s, f) => s + (f.rentaSueldo ?? 0), 0),
    impuestoUnicoRetenido: p.impuestoUnicoRetenido ?? dj1887.reduce((s, f) => s + (f.impuestoUnicoRetenido ?? 0), 0),
    ...(p.gastosEfectivos === undefined ? {} : { gastosEfectivos: p.gastosEfectivos }),
    ...(p.apvRegimenB === undefined ? {} : { apvRegimenB: p.apvRegimenB }),
    ...(p.otrasRentas === undefined ? {} : { otrasRentas: p.otrasRentas }),
  };
  const estimacion = estimarRenta(datos, p);
  const vigente = f22Vigente(deps.store.declaracionesF22(perfil.rut, anio));
  const resultado305 = vigente ? (deps.store.detalleF22(perfil.rut, anio, vigente.folio).valores.find((v) => v.codigo === '305')?.valor ?? null) : null;
  return {
    ...estimacion,
    supuestos: [...supuestos, ...estimacion.supuestos],
    rut: perfil.rut,
    anioTributario: anio,
    datos,
    f22: vigente ? { folio: vigente.folio, resultado305 } : null,
    diferenciaConF22: resultado305 === null ? null : estimacion.resultado - resultado305,
  };
}
