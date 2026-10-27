import { ERRORES_FATALES, ErrorImpuestocl, esErrorImpuestocl } from '../domain/errores.js';
import { parseRut } from '../domain/rut.js';
import type { EmpresaAutorizada, PerfilTributario, RespuestaCruda } from '../domain/tipos.js';
import type { DepsApp } from './deps.js';
import { Cancelada, registrar, revisarCancelacion, SINCRONIZACION_CANCELADA, type ErrorSuperficie, type ResultadoPeriodo } from './registro.js';

/** Las lecturas de la cuenta no son de un mes: su período en la bitácora de sincronización es vacío. */
const PERIODO_CUENTA = '';

export interface ResultadoCuenta {
  readonly rut: string;
  /** Si el perfil tributario de Mi SII se leyó y guardó en esta llamada. */
  readonly perfil: 'leido' | 'sin_leer';
  /** El SII autoriza declarar y pagar el F29 hasta el día 20; null si se desconoce. */
  readonly autorizadoDia20: boolean | null;
  /** Empresas autorizadas leídas (activas y desautorizadas); null si no se leyeron. */
  readonly empresas: number | null;
  /** Las que siguen activas, incluida la propia; null si no se leyeron. */
  readonly empresasActivas: number | null;
  /** A quién representa el perfil después de esta lectura: las empresas activas sin el RUT propio. */
  readonly representa: readonly string[];
  readonly errores: readonly ErrorSuperficie[];
  readonly abortado: ErrorSuperficie | null;
}

/**
 * Lee de Mi SII el perfil tributario (lista permitida, sin datos personales) y del RCV las empresas autorizadas, y
 * actualiza a quién representa el perfil con las empresas activas, sin el RUT propio. Cada lectura es independiente: si
 * una falla, la otra sigue. Lo ya guardado de lo que falla se conserva.
 */
export async function sincronizarCuenta(deps: DepsApp, rutTexto: string, signal?: AbortSignal): Promise<ResultadoCuenta> {
  const rut = parseRut(rutTexto).canonico;
  const existente = deps.store.contribuyente(rut);
  if (!existente) throw new ErrorImpuestocl('PERFIL_NO_EXISTE', `No existe el perfil ${rut}.`);
  const buffer: RespuestaCruda[] = [];
  const res: ResultadoPeriodo = { periodo: PERIODO_CUENTA, errores: [], avisos: [], documentos: 0, f29Folio: null };
  let perfil: PerfilTributario | null = null;
  let empresas: EmpresaAutorizada[] | null = null;
  let abortado: ErrorSuperficie | null = null;
  try {
    revisarCancelacion(signal);
    const sii = await deps.abrirSii(
      rut,
      (r) => {
        buffer.push(r);
      },
      signal,
    );
    perfil = await registrar(deps, rut, 'cuenta.perfil', PERIODO_CUENTA, buffer, res, signal, async (_id, ahora) => {
      const leido = await sii.perfilTributario(rut);
      deps.store.guardarPerfilTributario(rut, leido, ahora);
      return leido;
    });
    revisarCancelacion(signal);
    empresas = await registrar(deps, rut, 'cuenta.empresas', PERIODO_CUENTA, buffer, res, signal, async (id, ahora) => {
      const lista = await sii.empresasAutorizadas();
      deps.store.reemplazarEmpresasAutorizadas(id, rut, lista, ahora);
      const representa = lista.filter((e) => e.fechaDesautorizacion === null && e.rutEmpresa !== rut).map((e) => e.rutEmpresa);
      deps.store.guardarContribuyente({ ...(deps.store.contribuyente(rut) ?? existente), representa });
      return lista;
    });
  } catch (e) {
    if (e instanceof Cancelada) abortado = SINCRONIZACION_CANCELADA;
    else if (esErrorImpuestocl(e) && ERRORES_FATALES.has(e.codigo)) abortado = { superficie: 'sesion', codigo: e.codigo, mensaje: e.message };
    else throw e;
  } finally {
    deps.alTerminarSync?.(rut);
  }
  return {
    rut,
    perfil: perfil ? 'leido' : 'sin_leer',
    autorizadoDia20: perfil?.autorizadoDia20 ?? null,
    empresas: empresas ? empresas.length : null,
    empresasActivas: empresas ? empresas.filter((e) => e.fechaDesautorizacion === null).length : null,
    representa: deps.store.contribuyente(rut)?.representa ?? [],
    errores: res.errores,
    abortado,
  };
}

export interface AtributoCuenta {
  readonly codigo: string;
  readonly descripcion: string | null;
  /** Solo para los códigos cuyo valor no es personal. */
  readonly valor?: string | null;
}

export interface EmpresaCuenta {
  readonly rut: string;
  readonly razonSocial: string | null;
  readonly privilegios: string | null;
  /** false si el SII ya la desautorizó. */
  readonly activa: boolean;
}

/** Lo guardado de la cuenta del SII de un perfil: día 20, régimen y segmento, atributos vigentes y empresas autorizadas. */
export interface CuentaSii {
  /** Instante ISO UTC de la lectura del perfil tributario; null si solo se leyeron las empresas. */
  readonly obtenidoEn: string | null;
  readonly autorizadoDia20: boolean | null;
  readonly tipo: string | null;
  readonly subtipo: string | null;
  readonly segmento: string | null;
  readonly glosaActividad: string | null;
  readonly atributos: readonly AtributoCuenta[];
  readonly empresas: readonly EmpresaCuenta[];
}

/** La cuenta guardada del RUT, o null si nunca se sincronizó (ni el perfil tributario ni las empresas). */
export function cuentaDe(deps: DepsApp, rut: string): CuentaSii | null {
  const perfil = deps.store.perfilTributario(rut);
  const empresas = deps.store.empresasAutorizadas(rut);
  if (perfil === null && empresas.length === 0) return null;
  return {
    obtenidoEn: perfil?.obtenidoEn ?? null,
    autorizadoDia20: perfil?.autorizadoDia20 ?? null,
    tipo: perfil ? (perfil.tipoDescripcion ?? perfil.tipoCodigo) : null,
    subtipo: perfil ? (perfil.subtipoDescripcion ?? perfil.subtipoCodigo) : null,
    segmento: perfil ? (perfil.segmentoDescripcion ?? perfil.segmentoCodigo) : null,
    glosaActividad: perfil?.glosaActividad ?? null,
    atributos: (perfil?.atributos ?? []).filter((a) => a.fechaTermino === null).map((a) => ({ codigo: a.codigo, descripcion: a.descripcion, ...(a.valor === undefined ? {} : { valor: a.valor }) })),
    empresas: empresas.map((e) => ({ rut: e.rutEmpresa, razonSocial: e.razonSocial, privilegios: e.privilegios, activa: e.fechaDesautorizacion === null })),
  };
}
