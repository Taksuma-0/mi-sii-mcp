import type { Hallazgo } from '../domain/tipos.js';
import { CODIGO_F29, creditoDocumentosF29, creditoRcv, debitoF29, debitoRcv, valorF29, VERSION_REGLAS } from './mapeo-f29.js';
import {
  reglaCambiosPostF29,
  reglaCredito,
  reglaDebito,
  reglaF29Faltante,
  reglaIvaEspecial,
  reglaReclamo,
  reglaRemanente,
  type EntradaConciliacion,
} from './reglas.js';

export interface Comparaciones {
  readonly debitoRcv: number | null;
  readonly debitoF29: number | null;
  readonly creditoRcv: number | null;
  readonly creditoF29: number | null;
  readonly remanenteAnterior77: number | null;
  readonly remanenteActual504: number | null;
}

export interface ResultadoConciliacion {
  readonly comparaciones: Comparaciones;
  readonly hallazgos: readonly Hallazgo[];
  readonly versionReglas: string;
}

const REGLAS = [reglaDebito, reglaCredito, reglaRemanente, reglaF29Faltante, reglaReclamo, reglaCambiosPostF29, reglaIvaEspecial] as const;

export function conciliarPeriodo(e: EntradaConciliacion): ResultadoConciliacion {
  return {
    comparaciones: {
      debitoRcv: e.disponibilidad?.ventasRcv === false ? null : debitoRcv(e.resumenes),
      debitoF29: debitoF29(e.valores),
      creditoRcv: e.disponibilidad?.comprasRcv === false ? null : creditoRcv(e.resumenes),
      creditoF29: creditoDocumentosF29(e.valores),
      remanenteAnterior77: valorF29(e.valoresAnterior, CODIGO_F29.REMANENTE_PERIODO_SIGUIENTE),
      remanenteActual504: valorF29(e.valores, CODIGO_F29.REMANENTE_MES_ANTERIOR),
    },
    hallazgos: REGLAS.flatMap((regla) => regla(e)),
    versionReglas: VERSION_REGLAS,
  };
}
