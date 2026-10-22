import type { DocumentoRcv, F29Declaracion, F29Valores, RcvResumen } from '../../src/domain/tipos.js';
import type { Store } from '../../src/ports/index.js';
import { RUT_EMPRESA } from './fabricas.js';

export interface DatosMes {
  readonly resumenes?: readonly RcvResumen[];
  readonly documentos?: readonly DocumentoRcv[];
  readonly declaraciones?: readonly F29Declaracion[];
  readonly valores?: readonly F29Valores[];
  /** true si el mes no tuvo consulta de F29. */
  readonly sinF29?: boolean;
}

export const T_SEMBRADO = '2026-10-21T10:00:00.000Z';

/** Escribe en el store un mes ya sincronizado: RCV de ambos lados y, salvo `sinF29`, la consulta F29. */
export function sembrarMes(store: Store, periodo: string, datos: DatosMes = {}, rut = RUT_EMPRESA): void {
  for (const lado of ['VENTA', 'COMPRA'] as const) {
    const id = store.iniciarSincronizacion(rut, `rcv.${lado}`, periodo, T_SEMBRADO);
    store.reemplazarRcv(
      id,
      rut,
      periodo,
      lado,
      (datos.resumenes ?? []).filter((r) => r.lado === lado),
      (datos.documentos ?? []).filter((d) => d.lado === lado),
      T_SEMBRADO,
    );
    store.terminarSincronizacion(id, T_SEMBRADO, 'ok');
  }
  if (datos.sinF29) return;
  const id = store.iniciarSincronizacion(rut, 'f29', periodo, T_SEMBRADO);
  store.guardarF29(id, rut, periodo, datos.declaraciones ?? [], datos.valores ?? [], T_SEMBRADO);
  store.terminarSincronizacion(id, T_SEMBRADO, 'ok');
}
