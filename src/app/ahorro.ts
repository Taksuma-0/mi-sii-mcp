import { declaracionVigente } from '../domain/f29.js';
import { fechaEnSantiago } from '../domain/fechas.js';
import { periodoDeFecha, rangoPeriodos, restarPeriodos } from '../domain/periodo.js';
import { f22Vigente, totalesBheEmitidas } from '../domain/renta.js';
import { oportunidades, type Oportunidad } from '../reconciliation/oportunidades.js';
import { perfilExistente } from './consultas.js';
import type { DepsApp } from './deps.js';

export interface ResultadoOportunidades {
  readonly rut: string;
  readonly oportunidades: readonly Oportunidad[];
  /** Qué datos guardados se revisaron, para que se sepa qué falta sincronizar. */
  readonly revisado: readonly string[];
}

/**
 * Oportunidades legales de pagar menos o de pagar después que sostienen los datos guardados: crédito de IVA pendiente,
 * remanente sin usar, postergación del IVA, gastos efectivos de honorarios y APV. Solo lee la base local.
 */
export function ahorroOportunidades(deps: DepsApp, rutTexto: string): ResultadoOportunidades {
  const perfil = perfilExistente(deps, rutTexto);
  const rut = perfil.rut;
  const actual = periodoDeFecha(fechaEnSantiago(deps.reloj.ahora()));
  const recientes = rangoPeriodos(restarPeriodos(actual, 2), actual);
  const comprasPendientes = recientes.flatMap((p) => [...deps.store.documentosRcv(rut, p.texto, { lado: 'COMPRA', estado: 'PENDIENTE' }), ...deps.store.documentosRcv(rut, p.texto, { lado: 'COMPRA', estado: 'NO_INCLUIR' })]);
  const f29 = rangoPeriodos(restarPeriodos(actual, 12), restarPeriodos(actual, 1)).flatMap((p) => {
    const vigente = declaracionVigente(deps.store.declaracionesF29(rut, p.texto));
    const valores = vigente ? deps.store.valoresF29(rut, p.texto, vigente.folio) : null;
    return valores ? [{ periodo: p.texto, valores: valores.valores }] : [];
  });
  const emitidas = totalesBheEmitidas(deps.store.bheEmitidas(rut, actual.anio));
  const sueldos = deps.store.djTerceros(rut).some((f) => f.dj === 1887);
  const conF22 = f22Vigente(deps.store.declaracionesF22(rut)) !== null;
  return {
    rut,
    oportunidades: oportunidades({
      tipo: perfil.tipo,
      actual,
      comprasPendientes,
      f29,
      honorariosEmitidos: emitidas.bruto > 0 ? { anioComercial: actual.anio, bruto: emitidas.bruto } : null,
      tieneIngresosPersona: emitidas.bruto > 0 || sueldos || conF22,
    }),
    revisado: [`compras pendientes de ${recientes[0]!.texto} a ${actual.texto}`, `${f29.length} F29 presentados de los últimos 12 meses`, `boletas emitidas de ${actual.anio}`],
  };
}
