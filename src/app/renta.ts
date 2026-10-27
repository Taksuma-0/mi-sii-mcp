import { ERRORES_FATALES, ErrorImpuestocl, esErrorImpuestocl } from '../domain/errores.js';
import { CODIGOS_CLAVE_F22, f22Vigente, parseAnioTributario, periodoRenta, rangoAnios } from '../domain/renta.js';
import { parseRut } from '../domain/rut.js';
import type { F22Evento, F22Valor, RespuestaCruda } from '../domain/tipos.js';
import { perfilExistente } from './consultas.js';
import type { DepsApp } from './deps.js';
import { Cancelada, registrar, revisarCancelacion, SINCRONIZACION_CANCELADA, type ErrorSuperficie, type ResultadoPeriodo } from './registro.js';

export interface ResultadoAnioRenta {
  readonly anioTributario: number;
  /** Declaraciones que trajo el SII y se guardaron; null si la lectura falló o se conservó lo guardado. */
  readonly declaraciones: number | null;
  /** Folio vigente del año según lo traído; null si no hay o no se leyó. */
  readonly folioVigente: number | null;
  /** Si se leyó y guardó el detalle del folio vigente; `sin_vigente` si el año no tiene uno. */
  readonly detalle: 'leido' | 'sin_leer' | 'sin_vigente';
  readonly errores: readonly ErrorSuperficie[];
}

export interface ResultadoRenta {
  readonly rut: string;
  /** Años terminados, en orden; el año en curso cuando se detuvo la sincronización no aparece. */
  readonly anios: readonly ResultadoAnioRenta[];
  readonly abortado: ErrorSuperficie | null;
}

/**
 * Trae del SII la renta anual (F22) de un rango de años tributarios (`AAAA`, máximo 10): las declaraciones del año y el
 * detalle del folio vigente (códigos, observaciones y eventos). Si el SII responde sin declaraciones o sin códigos y había
 * datos guardados, se conservan (RESPUESTA_VACIA). `signal` se revisa antes de abrir la sesión, de cada año y de cada
 * lectura; al cancelarse devuelve lo traído y `abortado`.
 */
export async function sincronizarRenta(deps: DepsApp, rutTexto: string, desde: string, hasta?: string, signal?: AbortSignal): Promise<ResultadoRenta> {
  const rut = parseRut(rutTexto).canonico;
  if (!deps.store.contribuyente(rut)) throw new ErrorImpuestocl('PERFIL_NO_EXISTE', `No existe el perfil ${rut}.`);
  const anios = rangoAnios(parseAnioTributario(desde), parseAnioTributario(hasta ?? desde));
  const buffer: RespuestaCruda[] = [];
  const resultados: ResultadoAnioRenta[] = [];
  try {
    revisarCancelacion(signal);
    const sii = await deps.abrirSii(
      rut,
      (r) => {
        buffer.push(r);
      },
      signal,
    );
    for (const anio of anios) {
      revisarCancelacion(signal);
      const periodo = periodoRenta(anio);
      const res: ResultadoPeriodo = { periodo, errores: [], avisos: [], documentos: 0, f29Folio: null };
      const declaraciones = await registrar(deps, rut, 'f22', periodo, buffer, res, signal, async (id, ahora) => {
        const leidas = await sii.f22Declaraciones(rut, anio);
        if (leidas.length === 0 && deps.store.declaracionesF22(rut, anio).length > 0) {
          throw new ErrorImpuestocl('RESPUESTA_VACIA', `Renta ${periodo}: el SII respondió sin declaraciones; se conservan las declaraciones guardadas.`);
        }
        deps.store.reemplazarF22Declaraciones(id, rut, anio, leidas, ahora);
        return leidas;
      });
      const vigente = declaraciones === null ? null : f22Vigente(declaraciones);
      let detalle: ResultadoAnioRenta['detalle'] = declaraciones !== null && vigente === null ? 'sin_vigente' : 'sin_leer';
      if (vigente !== null) {
        revisarCancelacion(signal);
        const leido = await registrar(deps, rut, 'f22.folio', periodo, buffer, res, signal, async () => {
          const d = await sii.f22Detalle(rut, anio, vigente.folio);
          if (d.valores.length === 0) {
            const guardado = deps.store.detalleF22(rut, anio, vigente.folio).valores.length > 0;
            throw new ErrorImpuestocl(
              'RESPUESTA_VACIA',
              `Renta ${periodo}: el SII respondió sin códigos del folio ${vigente.folio}; ${guardado ? 'se conserva el detalle guardado' : 'no hay detalle guardado de ese folio'}.`,
            );
          }
          deps.store.reemplazarF22Detalle(rut, anio, vigente.folio, d);
          return true;
        });
        if (leido) detalle = 'leido';
      }
      resultados.push({ anioTributario: anio, declaraciones: declaraciones?.length ?? null, folioVigente: vigente?.folio ?? null, detalle, errores: res.errores });
    }
    return { rut, anios: resultados, abortado: null };
  } catch (e) {
    if (e instanceof Cancelada) return { rut, anios: resultados, abortado: SINCRONIZACION_CANCELADA };
    if (esErrorImpuestocl(e) && ERRORES_FATALES.has(e.codigo)) return { rut, anios: resultados, abortado: { superficie: 'sesion', codigo: e.codigo, mensaje: e.message } };
    throw e;
  } finally {
    deps.alTerminarSync?.(rut);
  }
}

export interface ObservacionRenta {
  readonly codigo: string;
  readonly descripcion: string | null;
}

/** Lo guardado de la renta de un año tributario; los datos del folio son null si el año no tiene uno vigente. */
export interface AnioRenta {
  readonly anioTributario: number;
  readonly folio: number | null;
  readonly vigente: boolean | null;
  /** Declaraciones guardadas del año (la vigente y las anteriores). */
  readonly declaraciones: number;
  readonly codigoConclusion: string | null;
  readonly conclusion: string | null;
  readonly fechaIngreso: string | null;
  readonly tipoImpugnado: string | null;
  readonly impuestoPagado: number | null;
  readonly montoGiro: number | null;
  readonly remanenteSolicitado: number | null;
  readonly remanenteDevuelto: number | null;
  readonly fechaVencimiento: string | null;
  /** Códigos guardados del folio vigente; el resto está en f22_valor (consulta_sql). */
  readonly codigos: number;
  /** Códigos del resultado de la declaración presentes en el folio, con la glosa del SII. */
  readonly codigosClave: readonly F22Valor[];
  readonly observaciones: readonly ObservacionRenta[];
  readonly eventos: readonly F22Evento[];
  /** Instante ISO UTC de la lectura de las declaraciones del año. */
  readonly obtenidoEn: string;
}

export interface ResumenRenta {
  readonly rut: string;
  /** Del año más nuevo al más antiguo. */
  readonly anios: readonly AnioRenta[];
}

/** Renta guardada de un año tributario (`AAAA`) o de todos; no va al SII. */
export function resumenRenta(deps: DepsApp, rutTexto: string, anio?: string): ResumenRenta {
  const perfil = perfilExistente(deps, rutTexto);
  const filtro = anio === undefined ? undefined : parseAnioTributario(anio);
  const declaraciones = deps.store.declaracionesF22(perfil.rut, filtro);
  const anios = [...new Set(declaraciones.map((d) => d.anioTributario))].sort((a, b) => b - a);
  return {
    rut: perfil.rut,
    anios: anios.map((a): AnioRenta => {
      const delAnio = declaraciones.filter((d) => d.anioTributario === a);
      const v = f22Vigente(delAnio);
      const detalle = v === null ? null : deps.store.detalleF22(perfil.rut, a, v.folio);
      const porCodigo = new Map((detalle?.valores ?? []).map((x) => [x.codigo, x]));
      return {
        anioTributario: a,
        folio: v?.folio ?? null,
        vigente: v?.vigente ?? null,
        declaraciones: delAnio.length,
        codigoConclusion: v?.codigoConclusion ?? null,
        conclusion: v?.conclusion ?? null,
        fechaIngreso: v?.fechaIngreso ?? null,
        tipoImpugnado: v?.tipoImpugnado ?? null,
        impuestoPagado: v?.impuestoPagado ?? null,
        montoGiro: v?.montoGiro ?? null,
        remanenteSolicitado: v?.remanenteSolicitado ?? null,
        remanenteDevuelto: v?.remanenteDevuelto ?? null,
        fechaVencimiento: v?.fechaVencimiento ?? null,
        codigos: detalle?.valores.length ?? 0,
        codigosClave: CODIGOS_CLAVE_F22.flatMap((c) => porCodigo.get(c) ?? []),
        observaciones: (detalle?.observaciones ?? []).map((o) => ({ codigo: o.codigo, descripcion: o.descripcion })),
        eventos: detalle?.eventos ?? [],
        obtenidoEn: (v ?? delAnio[0]!).obtenidoEn,
      };
    }),
  };
}
