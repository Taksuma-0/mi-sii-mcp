import { declaracionVigente } from '../domain/f29.js';
import type { DisponibilidadFuentes, Lado, Perfil, RcvResumen } from '../domain/tipos.js';
import type { Frescura } from '../ports/index.js';
import { creditoRcv, debitoRcv, signoTipoDoc } from '../reconciliation/mapeo-f29.js';
import { perfilExistente } from './consultas.js';
import type { DepsApp } from './deps.js';

export interface TotalPanorama {
  readonly monto: number | null;
  readonly mesesConDatos: number;
  readonly mesesSinDatos: number;
}

export interface PeriodoPanorama {
  readonly periodo: string;
  readonly disponibilidad: DisponibilidadFuentes;
  readonly frescura: Frescura;
  readonly ventas: number | null;
  readonly compras: number | null;
  readonly ivaDebito: number | null;
  readonly ivaCredito: number | null;
  readonly f29: {
    readonly consultado: boolean;
    readonly presentado: boolean | null;
    readonly folio: number | null;
    readonly estado: string | null;
    readonly totalAPagar: number | null;
    readonly valores: Readonly<Record<string, number>>;
  };
}

export interface PanoramaSii {
  readonly perfil: Perfil;
  readonly periodos: readonly PeriodoPanorama[];
  readonly totales: {
    readonly ventas: TotalPanorama;
    readonly compras: TotalPanorama;
    readonly ivaDebito: TotalPanorama;
    readonly ivaCredito: TotalPanorama;
    readonly f29: TotalPanorama;
  };
}

const totalRcv = (resumenes: readonly RcvResumen[], lado: Lado): number =>
  resumenes
    .filter((r) => r.lado === lado && r.estado === 'REGISTRO')
    .flatMap((r) => r.filas)
    .reduce((suma, f) => suma + signoTipoDoc(f.tipoDoc) * f.total, 0);

function totalConCobertura(montos: readonly (number | null)[]): TotalPanorama {
  const conocidos = montos.filter((m): m is number => m !== null);
  return {
    monto: conocidos.length > 0 ? conocidos.reduce((suma, monto) => suma + monto, 0) : null,
    mesesConDatos: conocidos.length,
    mesesSinDatos: montos.length - conocidos.length,
  };
}

/** Vista de todos los meses almacenados; no sincroniza ni concilia. */
export function panorama(deps: DepsApp, rutTexto: string): PanoramaSii {
  const perfil = perfilExistente(deps, rutTexto);
  const periodos = deps.store.periodosConDatos(perfil.rut).sort().map((periodo): PeriodoPanorama => {
    const disponibilidad = deps.store.disponibilidadFuentes(perfil.rut, periodo);
    const resumenes = deps.store.resumenesRcv(perfil.rut, periodo);
    const vigente = disponibilidad.f29 ? declaracionVigente(deps.store.declaracionesF29(perfil.rut, periodo)) : null;
    const valores = vigente ? deps.store.valoresF29(perfil.rut, periodo, vigente.folio) : null;
    return {
      periodo,
      disponibilidad,
      frescura: deps.store.frescura(perfil.rut, periodo),
      ventas: disponibilidad.ventasRcv ? totalRcv(resumenes, 'VENTA') : null,
      compras: disponibilidad.comprasRcv ? totalRcv(resumenes, 'COMPRA') : null,
      ivaDebito: disponibilidad.ventasRcv ? debitoRcv(resumenes) : null,
      ivaCredito: disponibilidad.comprasRcv ? creditoRcv(resumenes) : null,
      f29: {
        consultado: disponibilidad.f29,
        presentado: disponibilidad.f29 ? vigente !== null : null,
        folio: vigente?.folio ?? null,
        estado: vigente?.estado ?? null,
        totalAPagar: vigente?.totalAPagar ?? null,
        valores: valores?.valores ?? {},
      },
    };
  });
  return {
    perfil,
    periodos,
    totales: {
      ventas: totalConCobertura(periodos.map((p) => p.ventas)),
      compras: totalConCobertura(periodos.map((p) => p.compras)),
      ivaDebito: totalConCobertura(periodos.map((p) => p.ivaDebito)),
      ivaCredito: totalConCobertura(periodos.map((p) => p.ivaCredito)),
      f29: totalConCobertura(periodos.map((p) => p.f29.totalAPagar)),
    },
  };
}
