import { ERRORES_FATALES, ErrorImpuestocl, esErrorImpuestocl } from '../domain/errores.js';
import { declaracionVigente, f29Presentada } from '../domain/f29.js';
import { rangoPeriodos, type Periodo } from '../domain/periodo.js';
import { parseRut } from '../domain/rut.js';
import { lecturaConfiable, motivoNoConfiable, verificarCoherenciaF29 } from '../reconciliation/coherencia-f29.js';
import { ESTADOS_RCV, type DocumentoRcv, type EstadoRcv, type F29Declaracion, type F29Valores, type Lado, type RcvResumen, type RespuestaCruda } from '../domain/tipos.js';
import type { SiiReader } from '../ports/index.js';
import type { DepsApp } from './deps.js';
import { Cancelada, DATOS_INCOMPLETOS_RCV, registrar, revisarCancelacion, SINCRONIZACION_CANCELADA, type ErrorSuperficie, type ResultadoPeriodo } from './registro.js';
import { motivoParaConservar } from './releer-f29.js';

export { SINCRONIZACION_CANCELADA, type ErrorSuperficie, type ResultadoPeriodo };

/**
 * `propuesta` (propuesta de F29 del SII) y `bhe` (boletas de honorarios recibidas) son opt-in: no forman parte de la
 * sincronización por defecto.
 */
export type Superficie = 'rcv' | 'f29' | 'propuesta' | 'bhe';

export interface ResultadoSync {
  readonly rut: string;
  /** Lo que se pidió traer: el texto de la sincronización solo habla de estas superficies. */
  readonly superficies: readonly Superficie[];
  readonly periodos: readonly ResultadoPeriodo[];
  readonly abortado: ErrorSuperficie | null;
}

const LADOS: readonly Lado[] = ['VENTA', 'COMPRA'];
/** Las ventas no tienen pendientes ni reclamos propios: esos estados son del receptor. */
const ESTADOS_POR_LADO: Readonly<Record<Lado, readonly EstadoRcv[]>> = { VENTA: ['REGISTRO'], COMPRA: ESTADOS_RCV };
/** Boletas y comprobantes de venta: el RCV los entrega solo como resumen. */
export const SOLO_RESUMEN_VENTA: ReadonlySet<number> = new Set([35, 38, 39, 41, 48]);

/**
 * Si un lado del RCV debe conservar lo guardado en vez de reemplazarlo: solo cuando todos sus estados vinieron vacíos,
 * alguno sin la confirmación "sin movimientos" del SII, y había datos guardados de ese lado.
 */
export function conservarRcv(nuevos: readonly RcvResumen[], guardadoTieneDatos: boolean): boolean {
  if (nuevos.some((r) => r.filas.length > 0)) return false;
  if (nuevos.every((r) => r.sinMovimientos === true)) return false;
  return guardadoTieneDatos;
}

/**
 * Si el F29 del mes debe conservar lo guardado: falta en el listado nuevo un folio presentado guardado y el listado nuevo
 * no trae ninguno presentado. Una rectificatoria (folio nuevo presentado) o un cambio de estado del mismo folio reemplazan.
 */
export function conservarF29(nuevas: readonly F29Declaracion[], guardadas: readonly F29Declaracion[]): boolean {
  if (nuevas.some(f29Presentada)) return false;
  const folios = new Set(nuevas.map((d) => d.folio));
  return guardadas.some((d) => f29Presentada(d) && !folios.has(d.folio));
}

/** Aviso del mes que la cancelación dejó a medias: sus superficies guardadas están completas, pero faltan otras. */
export const AVISO_MES_CANCELADO = 'incompleto: la sincronización se canceló antes de terminar este mes';

/**
 * `signal` se revisa antes de abrir la sesión del SII, de cada período y de cada superficie, y corta la consulta al SII en
 * curso; al cancelarse devuelve lo traído y `abortado`.
 */
export async function sincronizar(
  deps: DepsApp,
  rutTexto: string,
  desde: Periodo,
  hasta: Periodo,
  superficies: readonly Superficie[] = ['rcv', 'f29'],
  signal?: AbortSignal,
): Promise<ResultadoSync> {
  const rut = parseRut(rutTexto).canonico;
  if (!deps.store.contribuyente(rut)) throw new ErrorImpuestocl('PERFIL_NO_EXISTE', `No existe el perfil ${rut}.`);
  const periodos = rangoPeriodos(desde, hasta);
  const buffer: RespuestaCruda[] = [];
  const resultados: ResultadoPeriodo[] = [];
  /** El período en curso; null entre períodos. */
  let enCurso: ResultadoPeriodo | null = null;
  try {
    revisarCancelacion(signal);
    const sii = await deps.abrirSii(
      rut,
      (r) => {
        buffer.push(r);
      },
      signal,
    );
    for (const periodo of periodos) {
      revisarCancelacion(signal);
      const res: ResultadoPeriodo = { periodo: periodo.texto, errores: [], avisos: [], documentos: 0, f29Folio: null };
      resultados.push(res);
      enCurso = res;
      /** Si alguna consulta del RCV de este mes respondió: solo entonces vale el aviso del lector (p. ej., representación). */
      let rcvRespondio = false;
      if (superficies.includes('rcv')) {
        for (const lado of LADOS) {
          revisarCancelacion(signal);
          await registrar(deps, rut, `rcv.${lado}`, periodo.texto, buffer, res, signal, async (id, ahora) => {
            const { resumenes, documentos, avisos } = await traerRcv(sii, rut, periodo, lado, (aviso) => res.avisos.push(aviso));
            rcvRespondio = true;
            if (avisos.length > 0) return DATOS_INCOMPLETOS_RCV;
            const guardadoTieneDatos = deps.store.resumenesRcv(rut, periodo.texto).some((r) => r.lado === lado && r.filas.length > 0);
            if (conservarRcv(resumenes, guardadoTieneDatos)) {
              throw new ErrorImpuestocl(
                'RESPUESTA_VACIA',
                `RCV ${lado} ${periodo.texto}: el SII respondió vacío sin confirmar que no hay movimientos; se conservan los datos guardados.`,
              );
            }
            deps.store.reemplazarRcv(id, rut, periodo.texto, lado, resumenes, documentos, ahora);
            res.documentos += documentos.length;
          });
        }
      }
      if (rcvRespondio && sii.aviso) res.avisos.push(`RCV ${periodo.texto}: ${sii.aviso}`);
      if (superficies.includes('f29')) {
        revisarCancelacion(signal);
        const f29 = await registrar(deps, rut, 'f29', periodo.texto, buffer, res, signal, async (id, ahora) => {
          const declaraciones = await sii.f29Declaraciones(rut, periodo);
          const guardadas = deps.store.declaracionesF29(rut, periodo.texto);
          if (conservarF29(declaraciones, guardadas)) {
            const listados = new Set(declaraciones.map((d) => d.folio));
            const faltan = guardadas.filter((d) => f29Presentada(d) && !listados.has(d.folio)).map((d) => d.folio);
            const cuales = faltan.length === 1 ? 'el folio presentado' : 'los folios presentados';
            throw new ErrorImpuestocl(
              'RESPUESTA_VACIA',
              `F29 ${periodo.texto}: el SII no listó ${cuales} ${faltan.join(', ')}; se conservan las declaraciones guardadas.`,
            );
          }
          const valoresPrevios = declaraciones.flatMap((d) => {
            const valores = deps.store.valoresF29(rut, periodo.texto, d.folio);
            return valores ? [valores] : [];
          });
          deps.store.guardarF29(id, rut, periodo.texto, declaraciones, valoresPrevios, ahora);
          return { declaraciones, valoresPrevios, vigente: declaracionVigente(declaraciones) };
        });
        // Si el SII respondió vacío y se conservó lo guardado, el folio que vale es el guardado.
        const conservado = f29 === null && res.errores.some((e) => e.superficie === 'f29' && e.codigo === 'RESPUESTA_VACIA');
        res.f29Folio = f29?.vigente?.folio ?? (conservado ? declaracionVigente(deps.store.declaracionesF29(rut, periodo.texto))?.folio ?? null : null);
        const vigente = f29?.vigente;
        if (f29 && vigente && vigente.codigoInterno !== null && !yaLeido(deps, rut, periodo.texto, vigente.folio, f29.valoresPrevios)) {
          revisarCancelacion(signal);
          await registrar(deps, rut, 'f29.valores', periodo.texto, buffer, res, signal, async (id, ahora) => {
            const v = await sii.f29Valores(rut, vigente);
            const guardados = f29.valoresPrevios.find((anterior) => anterior.folio === vigente.folio) ?? null;
            const incoherencias = verificarCoherenciaF29(v);
            const conservar = motivoParaConservar(v, guardados);
            if (conservar !== null) {
              throw new ErrorImpuestocl(
                'LECTURA_INCOHERENTE',
                `F29 ${periodo.texto}: la lectura del folio ${vigente.folio} ${conservar}; se conserva la lectura guardada.`,
                { detalle: { folio: vigente.folio, incoherencias, valoresNuevos: v.valores } },
              );
            }
            // Se guarda, pero si no se puede confiar en ella (no cuadra o no se puede verificar) queda el aviso.
            const sinConfianza = motivoNoConfiable(v);
            if (sinConfianza !== null) res.avisos.push(`F29 ${periodo.texto}: la lectura ${sinConfianza}`);
            const otrosValores = f29.valoresPrevios.filter((anterior) => anterior.folio !== vigente.folio);
            const lectura = { folio: vigente.folio, versionLector: v.versionLector ?? deps.lectorPdfF29.version, origen: 'sincronizacion', leidoEn: ahora, coherente: lecturaConfiable(v) } as const;
            deps.store.guardarF29(id, rut, periodo.texto, f29.declaraciones, [...otrosValores, v], ahora, [lectura]);
          });
        }
      }
      if (superficies.includes('propuesta')) {
        revisarCancelacion(signal);
        await registrar(deps, rut, 'f29.propuesta', periodo.texto, buffer, res, signal, async (id, ahora) => {
          const propuesta = await sii.f29Propuesta(rut, periodo);
          if (propuesta === null) {
            if (deps.store.propuestaF29(rut, periodo.texto) !== null) {
              throw new ErrorImpuestocl('RESPUESTA_VACIA', `Propuesta F29 ${periodo.texto}: el SII respondió sin datos; se conservan los datos guardados.`);
            }
            res.propuesta = 'sin_respuesta';
            return;
          }
          deps.store.reemplazarPropuestaF29(id, rut, periodo.texto, propuesta, ahora);
          res.propuesta = propuesta.sinPropuesta ? 'sin_propuesta' : 'con_datos';
        });
      }
      if (superficies.includes('bhe')) {
        revisarCancelacion(signal);
        await registrar(deps, rut, 'bhe.recibidas', periodo.texto, buffer, res, signal, async (id, ahora) => {
          const informe = await sii.bheRecibidas(rut, periodo);
          if (informe === null) {
            if (deps.store.boletasHonorarios(rut, periodo.texto).length > 0) {
              throw new ErrorImpuestocl('RESPUESTA_VACIA', `Boletas de honorarios ${periodo.texto}: el SII respondió sin boletas ni total; se conservan las boletas guardadas.`);
            }
            // Sin nada guardado tampoco se sabe si el mes no tiene boletas: no cuenta como consultado.
            res.boletasHonorarios = null;
            throw new ErrorImpuestocl('RESPUESTA_VACIA', `Boletas de honorarios ${periodo.texto}: el SII respondió sin boletas ni total; no hay boletas guardadas de este mes.`);
          }
          deps.store.reemplazarBhe(id, rut, periodo.texto, informe.boletas, ahora);
          res.boletasHonorarios = informe.boletas.length;
        });
      }
      enCurso = null;
    }
    return { rut, superficies, periodos: resultados, abortado: null };
  } catch (e) {
    if (e instanceof Cancelada) {
      enCurso?.avisos.push(AVISO_MES_CANCELADO);
      return { rut, superficies, periodos: resultados, abortado: SINCRONIZACION_CANCELADA };
    }
    if (esErrorImpuestocl(e) && ERRORES_FATALES.has(e.codigo)) {
      return { rut, superficies, periodos: resultados, abortado: { superficie: 'sesion', codigo: e.codigo, mensaje: e.message } };
    }
    throw e;
  } finally {
    deps.alTerminarSync?.(rut);
  }
}

/**
 * El folio ya tiene valores leídos de forma confiable con la versión actual del lector: bajar de nuevo su PDF no
 * cambiaría nada. Con otra versión del lector, o si la lectura o los valores guardados no son confiables, se vuelve a
 * bajar: los valores se revisan aunque la lectura diga coherente, por si se escribieron por otro camino.
 */
function yaLeido(deps: DepsApp, rut: string, periodo: string, folio: number, valoresPrevios: readonly F29Valores[]): boolean {
  const lectura = deps.store.lecturaF29(rut, periodo, folio);
  if (lectura === null || !lectura.coherente || lectura.versionLector !== deps.lectorPdfF29.version) return false;
  return lecturaConfiable(valoresPrevios.find((v) => v.folio === folio) ?? null);
}

async function traerRcv(sii: SiiReader, rut: string, periodo: Periodo, lado: Lado, alAviso: (aviso: string) => void) {
  const resumenes: RcvResumen[] = [];
  const documentos: DocumentoRcv[] = [];
  const avisos: string[] = [];
  for (const estado of ESTADOS_POR_LADO[lado]) {
    const resumen = await sii.rcvResumen(rut, periodo, lado, estado);
    resumenes.push(resumen);
    for (const fila of resumen.filas) {
      if (fila.cantidad === 0) continue;
      if (lado === 'VENTA' && SOLO_RESUMEN_VENTA.has(fila.tipoDoc)) continue;
      const docs = await sii.rcvDetalle(rut, periodo, lado, fila.tipoDoc, estado);
      if (docs.length < fila.cantidad) {
        const aviso = `RCV ${lado} ${estado} tipo ${fila.tipoDoc}: el detalle trajo ${docs.length} de ${fila.cantidad} documentos.`;
        avisos.push(aviso);
        alAviso(aviso);
      }
      documentos.push(...docs);
    }
  }
  return { resumenes, documentos, avisos };
}
