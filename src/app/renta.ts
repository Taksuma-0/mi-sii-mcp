import { ERRORES_FATALES, ErrorImpuestocl, esErrorImpuestocl } from '../domain/errores.js';
import { crearPeriodo } from '../domain/periodo.js';
import {
  CODIGOS_CLAVE_F22,
  cruzarHonorariosF22,
  diferenciaConAnual,
  f22Vigente,
  hayBoletasEmitidas,
  pagadoresBheEmitidas,
  parseAnioTributario,
  periodoRenta,
  rangoAnios,
  SUPERFICIE_DETALLE_BHE_EMITIDAS,
  totalesBheEmitidas,
  type CruceHonorariosF22,
  type PagadorBhe,
  type TotalesBheEmitidas,
} from '../domain/renta.js';
import { parseRut } from '../domain/rut.js';
import type { BoletaHonorariosEmitida, F22Evento, F22Valor, InformeBheEmitidas, RespuestaCruda } from '../domain/tipos.js';
import type { BheEmitidaMesGuardado, SiiReader } from '../ports/index.js';
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
  /** Boletas de honorarios emitidas vigentes del año comercial (AT − 1); null si no se leyeron o el perfil no es una persona. */
  readonly boletasEmitidas: number | null;
  /** Detalle boleta por boleta de los meses con boletas emitidas; null si no se leyó el informe anual o el perfil no es una persona. */
  readonly detalleBoletas: DetalleBoletasAnio | null;
  readonly errores: readonly ErrorSuperficie[];
}

/** Cómo terminó el detalle boleta por boleta de los meses en que el informe anual informa boletas emitidas. */
export interface DetalleBoletasAnio {
  /** Meses leídos y guardados. */
  readonly leidos: number;
  /** Meses que no se pidieron: lo guardado ya calzaba con el informe anual. */
  readonly omitidos: number;
  /** Meses que fallaron; el error queda en `errores`, con el mes en el mensaje. */
  readonly fallidos: number;
  /** Meses guardados cuyo detalle no calza con el informe anual (cantidades o bruto de las vigentes). */
  readonly avisos: readonly string[];
}

export interface ResultadoRenta {
  readonly rut: string;
  /** Años terminados, en orden; el año en curso cuando se detuvo la sincronización no aparece. */
  readonly anios: readonly ResultadoAnioRenta[];
  readonly abortado: ErrorSuperficie | null;
}

/**
 * Detalle boleta por boleta de las boletas emitidas: solo de los meses en que el informe anual informa boletas (vigentes o
 * anuladas) y cuyo detalle guardado no calza ya con ese mes. Cada mes va en su registro (período AAAA-MM); uno que falla
 * no impide los demás. Un detalle sin boletas (vacío ambiguo, o ninguna cuando el anual informa) no reemplaza lo guardado
 * (RESPUESTA_VACIA); uno que no calza con el anual se guarda igual, con un aviso. La cancelación se revisa entre meses.
 */
async function detalleBoletasEmitidas(
  deps: DepsApp,
  sii: SiiReader,
  rut: string,
  anual: InformeBheEmitidas,
  buffer: RespuestaCruda[],
  res: ResultadoPeriodo,
  signal: AbortSignal | undefined,
): Promise<DetalleBoletasAnio> {
  let leidos = 0;
  let omitidos = 0;
  let fallidos = 0;
  const avisos: string[] = [];
  for (const mes of anual.meses) {
    if (mes.vigentes + mes.anuladas === 0) continue;
    const periodo = crearPeriodo(anual.anioComercial, mes.mes);
    if (diferenciaConAnual(periodo.texto, mes, deps.store.boletasEmitidas(rut, periodo.texto)) === null) {
      omitidos++;
      continue;
    }
    revisarCancelacion(signal);
    const delMes: ResultadoPeriodo = { periodo: periodo.texto, errores: [], avisos: [], documentos: 0, f29Folio: null };
    const leidas = await registrar(deps, rut, SUPERFICIE_DETALLE_BHE_EMITIDAS, periodo.texto, buffer, delMes, signal, async (id, ahora) => {
      const informe = await sii.bheEmitidasMes(rut, periodo);
      if (informe === null || informe.boletas.length === 0) {
        const guardadas = deps.store.boletasEmitidas(rut, periodo.texto).length > 0;
        throw new ErrorImpuestocl(
          'RESPUESTA_VACIA',
          `Boletas emitidas ${periodo.texto}: el SII respondió el detalle sin boletas y el informe anual informa ${mes.vigentes + mes.anuladas}; ${guardadas ? 'se conservan las guardadas' : 'no hay boletas guardadas de ese mes'}.`,
        );
      }
      deps.store.reemplazarBoletasEmitidas(id, rut, periodo.texto, informe.boletas, ahora);
      return informe.boletas;
    });
    // El registro del año es por AT: el mes va en el mensaje para saber cuál falló.
    for (const e of delMes.errores) res.errores.push(e.mensaje.includes(periodo.texto) ? e : { ...e, mensaje: `${periodo.texto}: ${e.mensaje}` });
    if (leidas === null) {
      fallidos++;
      continue;
    }
    leidos++;
    const aviso = diferenciaConAnual(periodo.texto, mes, leidas);
    if (aviso !== null) avisos.push(aviso);
  }
  return { leidos, omitidos, fallidos, avisos };
}

/**
 * Trae del SII la renta anual (F22) de un rango de años tributarios (`AAAA`, máximo 10): las declaraciones del año y el
 * detalle del folio vigente (códigos, observaciones y eventos). A una persona le trae además el informe anual de boletas
 * de honorarios emitidas del año comercial (AT − 1) y, de los meses con boletas, su detalle boleta por boleta; un error
 * ahí no impide el F22 ni al revés. El año tributario
 * siguiente al actual sirve para ver las boletas del año en curso, aunque aún no haya F22. Si el SII responde sin
 * declaraciones, sin códigos o con las boletas todas en 0 y había datos guardados, se conservan (RESPUESTA_VACIA).
 * `signal` se revisa antes de abrir la sesión, de cada año y de cada lectura; al cancelarse devuelve lo traído y `abortado`.
 */
export async function sincronizarRenta(deps: DepsApp, rutTexto: string, desde: string, hasta?: string, signal?: AbortSignal): Promise<ResultadoRenta> {
  const rut = parseRut(rutTexto).canonico;
  const perfil = deps.store.contribuyente(rut);
  if (!perfil) throw new ErrorImpuestocl('PERFIL_NO_EXISTE', `No existe el perfil ${rut}.`);
  // Solo una persona emite boletas de honorarios.
  const conBoletas = perfil.tipo === 'persona';
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
      let anual: InformeBheEmitidas | null = null;
      let detalleBoletas: DetalleBoletasAnio | null = null;
      if (conBoletas) {
        revisarCancelacion(signal);
        const anioComercial = anio - 1;
        anual = await registrar(deps, rut, 'bhe.emitidas', periodo, buffer, res, signal, async (id, ahora) => {
          const informe = await sii.bheEmitidasAnual(rut, anioComercial);
          if (!hayBoletasEmitidas(totalesBheEmitidas(informe.meses)) && hayBoletasEmitidas(totalesBheEmitidas(deps.store.bheEmitidas(rut, anioComercial)))) {
            throw new ErrorImpuestocl('RESPUESTA_VACIA', `Renta ${periodo}: el SII respondió las boletas de honorarios emitidas de ${anioComercial} en cero; se conservan las guardadas.`);
          }
          deps.store.reemplazarBheEmitidas(id, rut, anioComercial, informe.meses, ahora);
          return informe;
        });
        // Sin el informe anual de esta lectura no se sabe qué meses pedir: no hay detalle.
        if (anual !== null) detalleBoletas = await detalleBoletasEmitidas(deps, sii, rut, anual, buffer, res, signal);
      }
      const boletasEmitidas = anual === null ? null : totalesBheEmitidas(anual.meses).vigentes;
      resultados.push({ anioTributario: anio, declaraciones: declaraciones?.length ?? null, folioVigente: vigente?.folio ?? null, detalle, boletasEmitidas, detalleBoletas, errores: res.errores });
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

/** Boletas de honorarios emitidas guardadas del año comercial de un año tributario (AT − 1), montos nominales. */
export interface HonorariosEmitidos extends TotalesBheEmitidas {
  readonly anioComercial: number;
  /** Bruto con el 547 y retención de terceros con el 492 del folio vigente; null si el año no tiene folio vigente con detalle guardado. */
  readonly cruceF22: CruceHonorariosF22 | null;
  /** Los 5 receptores con mayor bruto vigente según el detalle guardado, y cuántos más hay; null si no hay detalle guardado del año. */
  readonly pagadores: { readonly principales: readonly PagadorBhe[]; readonly otros: number } | null;
  /** Instante ISO UTC de la lectura del informe anual. */
  readonly obtenidoEn: string;
}

/**
 * Lo guardado de la renta de un año tributario; los datos del folio son null si el año no tiene uno vigente (o solo
 * tiene boletas emitidas guardadas: entonces `declaraciones` es 0).
 */
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
  /** Boletas de honorarios emitidas del año comercial; null si no hay guardadas (solo se leen para personas). */
  readonly honorariosEmitidos: HonorariosEmitidos | null;
  /** Instante ISO UTC de la lectura de las declaraciones del año; sin declaraciones, la del informe de boletas. */
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
  // Las boletas se guardan por año comercial: el del año tributario AT es AT − 1.
  const emitidas = deps.store.bheEmitidas(perfil.rut, filtro === undefined ? undefined : filtro - 1);
  const anios = [...new Set([...declaraciones.map((d) => d.anioTributario), ...emitidas.map((m) => m.anioComercial + 1)])].sort((a, b) => b - a);
  return {
    rut: perfil.rut,
    anios: anios.map((a): AnioRenta => {
      const delAnio = declaraciones.filter((d) => d.anioTributario === a);
      const v = f22Vigente(delAnio);
      const detalle = v === null ? null : deps.store.detalleF22(perfil.rut, a, v.folio);
      const porCodigo = new Map((detalle?.valores ?? []).map((x) => [x.codigo, x]));
      const meses = emitidas.filter((m) => m.anioComercial === a - 1);
      const honorariosEmitidos = meses.length === 0 ? null : honorariosDe(a - 1, meses, detalle?.valores.length ? detalle.valores : null, deps.store.boletasEmitidasDelAnio(perfil.rut, a - 1));
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
        honorariosEmitidos,
        obtenidoEn: (v ?? delAnio[0])?.obtenidoEn ?? honorariosEmitidos!.obtenidoEn,
      };
    }),
  };
}

/**
 * Totales de las boletas emitidas de un año comercial; si hay códigos del folio vigente, su cruce con el F22, y si hay
 * detalle boleta por boleta, los principales pagadores.
 */
function honorariosDe(
  anioComercial: number,
  meses: readonly BheEmitidaMesGuardado[],
  valoresF22: readonly F22Valor[] | null,
  boletas: readonly BoletaHonorariosEmitida[],
): HonorariosEmitidos {
  const totales = totalesBheEmitidas(meses);
  return {
    anioComercial,
    ...totales,
    cruceF22: valoresF22 === null ? null : cruzarHonorariosF22({ bruto: totales.bruto, retencion: totales.retencionTerceros }, valoresF22),
    pagadores: boletas.length === 0 ? null : pagadoresBheEmitidas(boletas),
    obtenidoEn: meses[0]!.obtenidoEn,
  };
}
