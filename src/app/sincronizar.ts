import { ERRORES_FATALES, ErrorImpuestocl, esErrorImpuestocl, type CodigoError } from '../domain/errores.js';
import { declaracionVigente, f29Presentada } from '../domain/f29.js';
import { rangoPeriodos, type Periodo } from '../domain/periodo.js';
import { parseRut } from '../domain/rut.js';
import { ESTADOS_RCV, type DocumentoRcv, type EstadoRcv, type F29Declaracion, type Lado, type RcvResumen, type RespuestaCruda } from '../domain/tipos.js';
import type { SiiReader } from '../ports/index.js';
import type { DepsApp } from './deps.js';

export type Superficie = 'rcv' | 'f29';

export interface ErrorSuperficie {
  readonly superficie: string;
  readonly codigo: string;
  readonly mensaje: string;
}

export interface ResultadoPeriodo {
  periodo: string;
  errores: ErrorSuperficie[];
  avisos: string[];
  documentos: number;
  f29Folio: number | null;
}

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
const CODIGO_DATOS_INCOMPLETOS: CodigoError = 'DATOS_INCOMPLETOS';
const DATOS_INCOMPLETOS_RCV = Symbol('DATOS_INCOMPLETOS');

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

/** Motivo de término cuando quien pidió la sincronización la cancela (p. ej. Esc en el cliente MCP). */
export const SINCRONIZACION_CANCELADA: ErrorSuperficie = {
  superficie: 'cancelacion',
  codigo: 'CANCELADO',
  mensaje: 'Sincronización cancelada; se conservan los meses ya traídos.',
};

const DETALLE_SUPERFICIE_CANCELADA = 'La cancelación cortó la consulta al SII; esta superficie no escribió datos.';

/** Aviso del mes que la cancelación dejó a medias: sus superficies guardadas están completas, pero faltan otras. */
export const AVISO_MES_CANCELADO = 'incompleto: la sincronización se canceló antes de terminar este mes';

/**
 * Se lanza entre superficies o cuando la cancelación corta una consulta en curso; en ese caso la superficie no escribe
 * nada: lo ya guardado queda completo.
 */
class Cancelada extends Error {}

const revisarCancelacion = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw new Cancelada();
};

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
      if (superficies.includes('rcv')) {
        for (const lado of LADOS) {
          revisarCancelacion(signal);
          await registrar(deps, rut, `rcv.${lado}`, periodo.texto, buffer, res, signal, async (id, ahora) => {
            const { resumenes, documentos, avisos } = await traerRcv(sii, rut, periodo, lado, (aviso) => res.avisos.push(aviso));
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
        res.f29Folio = f29?.vigente?.folio ?? null;
        const vigente = f29?.vigente;
        if (f29 && vigente && vigente.codigoInterno !== null) {
          revisarCancelacion(signal);
          await registrar(deps, rut, 'f29.valores', periodo.texto, buffer, res, signal, async (id, ahora) => {
            const v = await sii.f29Valores(rut, vigente);
            const otrosValores = f29.valoresPrevios.filter((anterior) => anterior.folio !== vigente.folio);
            deps.store.guardarF29(id, rut, periodo.texto, f29.declaraciones, [...otrosValores, v], ahora);
          });
        }
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

/**
 * Ejecuta una superficie dentro de su registro de sincronización. Devuelve null si falló de forma no fatal. Si la
 * superficie falla con `signal` cancelada, su registro queda como `CANCELADO` y se lanza `Cancelada`.
 */
async function registrar<T>(
  deps: DepsApp,
  rut: string,
  superficie: string,
  periodo: string,
  buffer: RespuestaCruda[],
  res: ResultadoPeriodo,
  signal: AbortSignal | undefined,
  trabajo: (sincronizacionId: number, ahora: string) => Promise<T | typeof DATOS_INCOMPLETOS_RCV>,
): Promise<T | null> {
  const ahora = deps.reloj.ahora().toISOString();
  const id = deps.store.iniciarSincronizacion(rut, superficie, periodo, ahora);
  buffer.length = 0;
  try {
    const valor = await trabajo(id, ahora);
    volcar(deps, id, buffer);
    if (valor === DATOS_INCOMPLETOS_RCV) {
      const mensaje = 'El detalle RCV está incompleto; se conserva el último conjunto completo de este lado, si existe.';
      deps.store.terminarSincronizacion(id, deps.reloj.ahora().toISOString(), 'error', { codigo: CODIGO_DATOS_INCOMPLETOS, detalle: mensaje });
      res.errores.push({ superficie, codigo: CODIGO_DATOS_INCOMPLETOS, mensaje });
      return null;
    }
    deps.store.terminarSincronizacion(id, deps.reloj.ahora().toISOString(), 'ok');
    return valor;
  } catch (e) {
    volcar(deps, id, buffer);
    if (signal?.aborted) {
      deps.store.terminarSincronizacion(id, deps.reloj.ahora().toISOString(), 'error', { codigo: SINCRONIZACION_CANCELADA.codigo, detalle: DETALLE_SUPERFICIE_CANCELADA });
      throw new Cancelada();
    }
    if (!esErrorImpuestocl(e)) {
      deps.store.terminarSincronizacion(id, deps.reloj.ahora().toISOString(), 'error', { codigo: 'ERROR_INTERNO', detalle: String(e) });
      throw e;
    }
    deps.store.terminarSincronizacion(id, deps.reloj.ahora().toISOString(), 'error', { codigo: e.codigo, detalle: e.message });
    if (e.codigo === 'PORTAL_CAMBIO') {
      deps.diagnostico?.(`${rut}-${periodo}-${superficie}.json`, JSON.stringify({ error: e.toJSON(), detalle: e.detalle ?? null, respuestas: buffer }, null, 2));
    }
    if (ERRORES_FATALES.has(e.codigo)) throw e;
    res.errores.push({ superficie, codigo: e.codigo, mensaje: e.message });
    return null;
  }
}

function volcar(deps: DepsApp, sincronizacionId: number, buffer: readonly RespuestaCruda[]): void {
  for (const r of buffer) deps.store.guardarRespuestaCruda(sincronizacionId, r);
}
