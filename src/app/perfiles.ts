import { ErrorMiSiiMcp } from '../domain/errores.js';
import { parseRut } from '../domain/rut.js';
import type { Perfil, TipoContribuyente } from '../domain/tipos.js';
import type { EstadoSesion, IdentidadSii } from '../ports/index.js';
import { cuentaDe, type CuentaSii } from './cuenta.js';
import type { DepsApp } from './deps.js';

export interface PerfilConSesion extends Perfil {
  readonly sesion: EstadoSesion;
  /** Día 20, régimen, segmento y empresas autorizadas; solo existe si se sincronizó la cuenta. */
  readonly cuenta?: CuentaSii;
}

export function agregarPerfil(
  deps: DepsApp,
  entrada: {
    readonly rut: string;
    readonly alias: string;
    readonly tipo: TipoContribuyente;
    readonly representa?: readonly string[];
    /** RUT de la identidad con cuya sesión se entra al SII; sin él, la propia. */
    readonly accedeCon?: string;
  },
): Perfil {
  const rut = parseRut(entrada.rut).canonico;
  const accedeCon = entrada.accedeCon === undefined ? undefined : parseRut(entrada.accedeCon).canonico;
  if (accedeCon === rut) {
    throw new ErrorMiSiiMcp('RUT_INVALIDO', `--accede-con debe ser otra identidad que ${rut}.`, { accion: 'Omite --accede-con: sin él, el contribuyente entra con su propia sesión.' });
  }
  const perfil: Perfil = {
    rut,
    alias: entrada.alias.trim() || rut,
    tipo: entrada.tipo,
    representa: (entrada.representa ?? []).map((r) => parseRut(r).canonico),
    razonSocial: deps.store.contribuyente(rut)?.razonSocial ?? null,
    ...(accedeCon ? { accedeCon } : {}),
  };
  deps.store.guardarContribuyente(perfil);
  return perfil;
}

export function listarPerfiles(deps: DepsApp): PerfilConSesion[] {
  return deps.store.contribuyentes().map((p) => {
    const cuenta = cuentaDe(deps, p.rut);
    return { ...p, sesion: deps.sesiones.estado(p.rut), ...(cuenta ? { cuenta } : {}) };
  });
}

/** Como `listarPerfiles`, y además dice si cada sesión se renueva sola (consulta el llavero sin leer la clave hacia afuera). */
export async function listarPerfilesConRenovacion(deps: DepsApp): Promise<PerfilConSesion[]> {
  const consultar = deps.sesiones.claveGuardada?.bind(deps.sesiones);
  return Promise.all(
    listarPerfiles(deps).map(async (p) => {
      if (!consultar || !p.sesion.tieneSesion) return p;
      const renuevaSola = p.sesion.origen !== 'navegador' && (await consultar(p.rut));
      return { ...p, sesion: { ...p.sesion, renuevaSola } };
    }),
  );
}

/** Tras un login: crea el perfil si no existe o completa su razón social. */
export function registrarIdentidad(deps: DepsApp, identidad: IdentidadSii): Perfil {
  const existente = deps.store.contribuyente(identidad.rut);
  const perfil: Perfil = existente
    ? { ...existente, razonSocial: identidad.razonSocial ?? existente.razonSocial }
    : { rut: identidad.rut, alias: identidad.nombre || identidad.rut, tipo: identidad.tipo, representa: [], razonSocial: identidad.razonSocial };
  deps.store.guardarContribuyente(perfil);
  return perfil;
}
