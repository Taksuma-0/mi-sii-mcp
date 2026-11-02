import type { AliasAprendido, CambioPortal } from '../domain/portal.js';
import { parseRut } from '../domain/rut.js';
import { esMasNueva } from '../domain/version.js';
import type { DepsApp } from './deps.js';
import { esSuperficieVigente } from './superficies.js';

/** Días hacia atrás que mira el diagnóstico (cambios del portal, lecturas rotas y reintentos pendientes). */
const DIAS_DIAGNOSTICO = 30;

export interface CuentaDiagnostico {
  readonly rut: string;
  readonly alias: string;
  readonly sesion: 'activa' | 'sin_sesion';
  /** Última vez que salió bien cada superficie traída del SII. */
  readonly ultimasOk: readonly { readonly superficie: string; readonly en: string }[];
  /** Fallas del SII que la revisión diaria reintentará sola. */
  readonly pendientesReintento: number;
  readonly avisosSinVer: number;
}

export interface Diagnostico {
  readonly version: { readonly actual: string | null; readonly ultima: string | null; readonly hayNueva: boolean };
  readonly base: { readonly integridad: string; readonly respuestasCrudas: number; readonly ultimoRespaldo: string | null };
  readonly cuentas: readonly CuentaDiagnostico[];
  /** Cambios del SII detectados, nombres de campos aprendidos y lecturas que fallaron porque el portal cambió. */
  readonly portal: {
    readonly cambios: readonly CambioPortal[];
    readonly alias: readonly AliasAprendido[];
    /** Lecturas cuyo último intento sigue fallando porque el portal cambió (de superficies que el lector actual pide). */
    readonly rotas: readonly { readonly rut: string; readonly superficie: string; readonly periodo: string; readonly en: string }[];
    readonly lecturasRotas: number;
  };
}

/**
 * Estado de salud de mi-sii-mcp con lo guardado, sin ir al SII ni a la red: versión, base (integridad, respaldo), cada
 * cuenta (sesión, última lectura buena, reintentos pendientes) y lo que se sabe de los cambios del portal.
 */
export function diagnostico(deps: DepsApp, rutTexto?: string): Diagnostico {
  const desde = new Date(deps.reloj.ahora().getTime() - DIAS_DIAGNOSTICO * 86_400_000).toISOString();
  const rut = rutTexto === undefined ? undefined : parseRut(rutTexto).canonico;
  const actual = deps.versionActual ?? null;
  const ultima = deps.versiones?.conocida() ?? null;
  let integridad: string;
  try {
    integridad = deps.store.integridad();
  } catch (e) {
    integridad = `no se pudo revisar: ${e instanceof Error ? e.message : String(e)}`;
  }
  const rotas = deps.store
    .ultimasFallas(desde)
    .filter((f) => f.codigo === 'PORTAL_CAMBIO' && esSuperficieVigente(f.superficie, f.periodo) && (rut === undefined || f.rut === rut))
    .map((f) => ({ rut: f.rut, superficie: f.superficie, periodo: f.periodo, en: f.en }));
  const cuentas = deps.store
    .contribuyentes()
    .filter((p) => rut === undefined || p.rut === rut)
    .map(
      (p): CuentaDiagnostico => ({
        rut: p.rut,
        alias: p.alias,
        sesion: deps.sesiones.estado(p.rut).tieneSesion ? 'activa' : 'sin_sesion',
        ultimasOk: deps.store.ultimasSincronizacionesOk(p.rut),
        pendientesReintento: deps.store.pendientesDeReintento(p.rut, desde).length,
        avisosSinVer: deps.store.avisos({ rut: p.rut, sinVer: true }).length,
      }),
    );
  return {
    version: { actual, ultima, hayNueva: actual !== null && esMasNueva(ultima, actual) },
    base: { integridad, respuestasCrudas: deps.store.contarRespuestasCrudas(), ultimoRespaldo: deps.respaldos?.ultimo() ?? null },
    cuentas,
    portal: { cambios: deps.store.cambiosPortal(desde), alias: deps.store.aliasAprendidos(), rotas, lecturasRotas: rotas.length },
  };
}
