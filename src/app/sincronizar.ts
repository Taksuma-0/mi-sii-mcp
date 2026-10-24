import { ERRORES_FATALES, ErrorImpuestocl, esErrorImpuestocl } from '../domain/errores.js';
import { declaracionVigente } from '../domain/f29.js';
import { rangoPeriodos, type Periodo } from '../domain/periodo.js';
import { parseRut } from '../domain/rut.js';
import { ESTADOS_RCV, type DocumentoRcv, type EstadoRcv, type Lado, type RcvResumen, type RespuestaCruda } from '../domain/tipos.js';
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
  readonly periodos: readonly ResultadoPeriodo[];
  readonly abortado: ErrorSuperficie | null;
}

const LADOS: readonly Lado[] = ['VENTA', 'COMPRA'];
/** Las ventas no tienen pendientes ni reclamos propios: esos estados son del receptor. */
const ESTADOS_POR_LADO: Readonly<Record<Lado, readonly EstadoRcv[]>> = { VENTA: ['REGISTRO'], COMPRA: ESTADOS_RCV };
/** Boletas y comprobantes de venta: el RCV los entrega solo como resumen. */
const SOLO_RESUMEN_VENTA: ReadonlySet<number> = new Set([35, 38, 39, 41, 48]);
const DATOS_INCOMPLETOS = Symbol('DATOS_INCOMPLETOS');

export async function sincronizar(
  deps: DepsApp,
  rutTexto: string,
  desde: Periodo,
  hasta: Periodo,
  superficies: readonly Superficie[] = ['rcv', 'f29'],
): Promise<ResultadoSync> {
  const rut = parseRut(rutTexto).canonico;
  if (!deps.store.contribuyente(rut)) throw new ErrorImpuestocl('PERFIL_NO_EXISTE', `No existe el perfil ${rut}.`);
  const periodos = rangoPeriodos(desde, hasta);
  const buffer: RespuestaCruda[] = [];
  const resultados: ResultadoPeriodo[] = [];
  try {
    const sii = await deps.abrirSii(rut, (r) => {
      buffer.push(r);
    });
    for (const periodo of periodos) {
      const res: ResultadoPeriodo = { periodo: periodo.texto, errores: [], avisos: [], documentos: 0, f29Folio: null };
      resultados.push(res);
      if (superficies.includes('rcv')) {
        for (const lado of LADOS) {
          await registrar(deps, rut, `rcv.${lado}`, periodo.texto, buffer, res, async (id, ahora) => {
            const { resumenes, documentos, avisos } = await traerRcv(sii, rut, periodo, lado, (aviso) => res.avisos.push(aviso));
            if (avisos.length > 0) return DATOS_INCOMPLETOS;
            deps.store.reemplazarRcv(id, rut, periodo.texto, lado, resumenes, documentos, ahora);
            res.documentos += documentos.length;
          });
        }
      }
      if (superficies.includes('f29')) {
        const f29 = await registrar(deps, rut, 'f29', periodo.texto, buffer, res, async (id, ahora) => {
          const declaraciones = await sii.f29Declaraciones(rut, periodo);
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
          await registrar(deps, rut, 'f29.valores', periodo.texto, buffer, res, async (id, ahora) => {
            const v = await sii.f29Valores(rut, vigente);
            const otrosValores = f29.valoresPrevios.filter((anterior) => anterior.folio !== vigente.folio);
            deps.store.guardarF29(id, rut, periodo.texto, f29.declaraciones, [...otrosValores, v], ahora);
          });
        }
      }
    }
    return { rut, periodos: resultados, abortado: null };
  } catch (e) {
    if (esErrorImpuestocl(e) && ERRORES_FATALES.has(e.codigo)) {
      return { rut, periodos: resultados, abortado: { superficie: 'sesion', codigo: e.codigo, mensaje: e.message } };
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

/** Ejecuta una superficie dentro de su registro de sincronización. Devuelve null si falló de forma no fatal. */
async function registrar<T>(
  deps: DepsApp,
  rut: string,
  superficie: string,
  periodo: string,
  buffer: RespuestaCruda[],
  res: ResultadoPeriodo,
  trabajo: (sincronizacionId: number, ahora: string) => Promise<T | typeof DATOS_INCOMPLETOS>,
): Promise<T | null> {
  const ahora = deps.reloj.ahora().toISOString();
  const id = deps.store.iniciarSincronizacion(rut, superficie, periodo, ahora);
  buffer.length = 0;
  try {
    const valor = await trabajo(id, ahora);
    volcar(deps, id, buffer);
    if (valor === DATOS_INCOMPLETOS) {
      const mensaje = 'El detalle RCV está incompleto; se conserva el último conjunto completo de este lado, si existe.';
      deps.store.terminarSincronizacion(id, deps.reloj.ahora().toISOString(), 'error', { codigo: 'DATOS_INCOMPLETOS', detalle: mensaje });
      res.errores.push({ superficie, codigo: 'DATOS_INCOMPLETOS', mensaje });
      return null;
    }
    deps.store.terminarSincronizacion(id, deps.reloj.ahora().toISOString(), 'ok');
    return valor;
  } catch (e) {
    volcar(deps, id, buffer);
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
