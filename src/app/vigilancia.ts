import { avisoDeHallazgo, avisoDePlazo, type Aviso, type AvisoCandidato } from '../domain/avisos.js';
import { ERRORES_FATALES, esErrorMiSiiMcp, type CodigoError } from '../domain/errores.js';
import { fechaEnSantiago } from '../domain/fechas.js';
import { parseRut } from '../domain/rut.js';
import { f22Vigente } from '../domain/renta.js';
import { parsePeriodo, periodoAnterior, periodoDeFecha, restarPeriodos } from '../domain/periodo.js';
import { avisosDeSituacion } from '../domain/situacion-sii.js';
import { esMasNueva } from '../domain/version.js';
import type { Perfil } from '../domain/tipos.js';
import { hallazgos, plazos } from './consultas.js';
import type { DepsApp } from './deps.js';
import { mantenimientoDiario, type ResumenMantenimiento } from './mantenimiento.js';
import { SII_CAIDO } from './registro.js';
import { anioDeRenta, esSuperficieVigente, SUPERFICIE_DE_REGISTRO } from './superficies.js';
import { sincronizarRenta } from './renta.js';
import { sincronizar, type Superficie } from './sincronizar.js';

export interface RevisionCuenta {
  readonly rut: string;
  readonly estado: 'ok' | 'sin_sesion' | 'error';
  readonly detalle?: string;
  /** Períodos que fallaron antes por el SII y se volvieron a traer en esta revisión; solo si hubo alguno. */
  readonly reintentados?: number;
}

export interface ResultadoVigilancia {
  readonly revisadas: readonly RevisionCuenta[];
  /** Avisos que aparecieron en esta revisión; los ya conocidos no se repiten. */
  readonly nuevos: readonly Aviso[];
  /** Poda, integridad y respaldo de la base al final de la revisión. */
  readonly mantenimiento: ResumenMantenimiento;
}

/** Días hacia adelante en que un vencimiento ya merece aviso. */
const DIAS_AVISO_PLAZO = 10;
/** Meses hacia atrás en que se revisan los hallazgos de la conciliación. */
const MESES_HALLAZGOS = 12;
/** Meses en que se sigue la renta del año en curso (presentación, observaciones y devolución). */
const MESES_RENTA = new Set([4, 5, 6]);
/** Días hacia atrás en que se buscan fallas del SII para reintentar, y cuántos períodos se reintentan por cuenta y por día. */
const DIAS_COLA_REINTENTOS = 30;
const MAX_REINTENTOS_POR_CUENTA = 6;
const PERIODO_RENTA = /^AT(\d{4})$/;
/**
 * Vuelve a traer lo que falló antes por una causa del SII que se arregla esperando (la bitácora lo sabe), sin repetir lo
 * que esta misma revisión ya trajo ni lo que el lector actual ya no pide. Hasta `MAX_REINTENTOS_POR_CUENTA` períodos, los
 * más nuevos primero; un error de sesión detiene los reintentos de la cuenta. Devuelve cuántos períodos se reintentaron.
 */
async function reintentarPendientes(deps: DepsApp, rut: string, yaTraidos: ReadonlySet<string>, signal: AbortSignal | undefined): Promise<number> {
  const desde = new Date(deps.reloj.ahora().getTime() - DIAS_COLA_REINTENTOS * 86_400_000).toISOString();
  const meses = new Map<string, Set<Superficie>>();
  const anios = new Set<string>();
  for (const p of deps.store.pendientesDeReintento(rut, desde)) {
    if (!esSuperficieVigente(p.superficie, p.periodo)) continue;
    const anio = anioDeRenta(p.superficie, p.periodo);
    if (anio !== null) {
      if (!yaTraidos.has(`AT${anio}`)) anios.add(`AT${anio}`);
      continue;
    }
    const superficie = SUPERFICIE_DE_REGISTRO[p.superficie];
    if (superficie && !yaTraidos.has(p.periodo)) meses.set(p.periodo, (meses.get(p.periodo) ?? new Set<Superficie>()).add(superficie));
  }
  const tareas = [...meses.keys(), ...anios].sort((a, b) => b.localeCompare(a)).slice(0, MAX_REINTENTOS_POR_CUENTA);
  let hechos = 0;
  for (const periodo of tareas) {
    const anio = PERIODO_RENTA.exec(periodo)?.[1];
    const abortado = anio
      ? (await sincronizarRenta(deps, rut, anio, undefined, signal)).abortado
      : (await sincronizar(deps, rut, parsePeriodo(periodo), parsePeriodo(periodo), [...meses.get(periodo)!], signal)).abortado;
    hechos += 1;
    if (abortado && (ERRORES_FATALES.has(abortado.codigo as CodigoError) || abortado.codigo === SII_CAIDO.codigo)) break;
  }
  return hechos;
}

const avisoSinSesion = (perfil: Perfil, guardadaEn: string | null): AvisoCandidato => ({
  rut: perfil.rut,
  clave: `S:${guardadaEn ?? 'nunca'}`,
  tipo: 'sesion',
  severidad: 'advertencia',
  titulo: `${perfil.alias}: sin sesión del SII`,
  detalle: 'La revisión diaria no pudo consultar el SII: conecta la cuenta en la página de mi-sii-mcp (pídele a tu asistente «conecta mi cuenta»; con «Mantener conectada» se renueva sola).',
});

/** Superficies que vale la pena traer cada día: las que el perfil ya usa. Una persona sin RCV no declara IVA. */
function superficiesDe(deps: DepsApp, perfil: Perfil, mesAnterior: string): Superficie[] {
  const d = deps.store.disponibilidadFuentes(perfil.rut, mesAnterior);
  const usaIva = perfil.tipo === 'empresa' || d.ventasRcv || d.comprasRcv;
  return [...(usaIva ? (['rcv', 'f29'] as const) : []), ...(d.propuestaF29 ? (['propuesta'] as const) : []), ...(d.bheRecibidas ? (['bhe'] as const) : [])];
}

async function revisarCuenta(deps: DepsApp, perfil: Perfil, signal: AbortSignal | undefined): Promise<{ readonly revision: RevisionCuenta; readonly candidatos: AvisoCandidato[] }> {
  const sesion = deps.sesiones.estado(perfil.rut);
  // Una empresa que entra con la sesión de quien la representa no tiene sesión propia, pero sí se puede consultar.
  if (!sesion.tieneSesion && !perfil.accedeCon) return { revision: { rut: perfil.rut, estado: 'sin_sesion' }, candidatos: [avisoSinSesion(perfil, sesion.guardadaEn)] };
  const hoy = fechaEnSantiago(deps.reloj.ahora());
  const actual = periodoDeFecha(hoy);
  const anterior = periodoAnterior(actual);
  const superficies = superficiesDe(deps, perfil, anterior.texto);
  /** Con el SII caído no tiene sentido reintentar lo pendiente: cada intento esperaría sus plazos completos. */
  let siiCaido = false;
  if (superficies.length > 0) {
    const sync = await sincronizar(deps, perfil.rut, anterior, actual, superficies, signal);
    if (sync.abortado && ERRORES_FATALES.has(sync.abortado.codigo as CodigoError)) {
      return { revision: { rut: perfil.rut, estado: 'sin_sesion', detalle: sync.abortado.mensaje }, candidatos: [avisoSinSesion(perfil, sesion.guardadaEn)] };
    }
    siiCaido = sync.abortado?.codigo === SII_CAIDO.codigo;
  }
  const yaTraidos = new Set([...(superficies.length > 0 ? [anterior.texto, actual.texto] : []), ...(MESES_RENTA.has(actual.mes) ? [`AT${actual.anio}`] : [])]);
  const reintentados = siiCaido ? 0 : await reintentarPendientes(deps, perfil.rut, yaTraidos, signal);
  const candidatos: AvisoCandidato[] = [
    ...hallazgos(deps, perfil.rut, { desde: restarPeriodos(actual, MESES_HALLAZGOS).texto })
      .filter((h) => h.severidad !== 'info')
      .map(avisoDeHallazgo),
    // El F29 por presentar ya lo avisa su hallazgo (IVA-04), con más detalle: aquí quedan el reclamo de facturas y el F22.
    ...plazos(deps, perfil.rut, DIAS_AVISO_PLAZO).filter((p) => p.tipo !== 'F29').map(avisoDePlazo),
  ];
  // Anotaciones vigentes y requisitos incumplidos de Mi SII; si no responde, la revisión sigue con lo demás.
  try {
    const sii = await deps.abrirSii(perfil.rut, () => {}, signal);
    candidatos.push(...avisosDeSituacion(perfil.rut, await sii.situacionSii(perfil.rut)));
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  if (MESES_RENTA.has(actual.mes)) {
    await sincronizarRenta(deps, perfil.rut, String(actual.anio), undefined, signal);
    const vigente = f22Vigente(deps.store.declaracionesF22(perfil.rut, actual.anio));
    for (const e of vigente ? deps.store.detalleF22(perfil.rut, actual.anio, vigente.folio).eventos : []) {
      candidatos.push({ rut: perfil.rut, clave: `R:AT${actual.anio}:${e.orden}:${e.codigoEvento ?? ''}`, tipo: 'renta', severidad: 'info', titulo: `Renta AT${actual.anio}: ${e.nombre ?? 'evento nuevo'}`, detalle: `Evento del ${e.fecha ?? 'SII'} en tu declaración de renta.` });
    }
  }
  return { revision: { rut: perfil.rut, estado: 'ok', ...(reintentados > 0 ? { reintentados } : {}) }, candidatos };
}

/**
 * Revisión diaria de todas las cuentas: trae del SII el mes anterior y el actual (solo lo que cada perfil ya usa),
 * recalcula los hallazgos, revisa los vencimientos y, entre abril y junio, sigue la renta del año. Registra solo los
 * avisos nuevos. Una cuenta sin sesión o con un error no detiene a las demás. Solo lee el SII.
 */
export async function vigilar(deps: DepsApp, opciones: { readonly signal?: AbortSignal } = {}): Promise<ResultadoVigilancia> {
  const revisadas: RevisionCuenta[] = [];
  const candidatos: AvisoCandidato[] = [];
  for (const perfil of deps.store.contribuyentes()) {
    try {
      const r = await revisarCuenta(deps, perfil, opciones.signal);
      revisadas.push(r.revision);
      candidatos.push(...r.candidatos);
    } catch (e) {
      revisadas.push({ rut: perfil.rut, estado: 'error', detalle: esErrorMiSiiMcp(e) ? `[${e.codigo}] ${e.message}` : 'Error inesperado' });
    }
  }
  candidatos.push(...(await avisoDeVersion(deps)));
  const nuevos = deps.store.registrarAvisos(candidatos, deps.reloj.ahora().toISOString());
  return { revisadas, nuevos, mantenimiento: await mantenimientoDiario(deps, deps.reloj.ahora()) };
}

/** Los avisos de la aplicación (no de una cuenta) van con este identificador en vez de un RUT. */
export const RUT_APLICACION = 'mi-sii-mcp';

/** Un aviso, una vez por versión, si hay una versión nueva de mi-sii-mcp publicada en npm. Nunca instala nada. */
async function avisoDeVersion(deps: DepsApp): Promise<AvisoCandidato[]> {
  if (!deps.versiones || !deps.versionActual) return [];
  const ultima = await deps.versiones.ultima().catch(() => null);
  if (!esMasNueva(ultima, deps.versionActual)) return [];
  return [
    {
      rut: RUT_APLICACION,
      clave: `V:${ultima}`,
      tipo: 'version',
      severidad: 'info',
      titulo: `Hay una versión nueva de mi-sii-mcp (${ultima})`,
      detalle: `Tienes la ${deps.versionActual}. Actualízala con npx -y mi-sii-mcp@latest, o con git pull y npm run build si la instalaste desde el código.`,
    },
  ];
}

/** Avisos que la persona aún no ve (de una cuenta o de todas); por defecto quedan marcados como vistos. */
export function novedades(deps: DepsApp, rutTexto?: string, marcarVistas = true): Aviso[] {
  const rut = rutTexto === undefined ? undefined : parseRut(rutTexto).canonico;
  const avisos = deps.store.avisos({ ...(rut === undefined ? {} : { rut }), sinVer: true });
  if (marcarVistas && avisos.length > 0) deps.store.marcarAvisos(avisos.map((a) => a.id), 'visto', deps.reloj.ahora().toISOString());
  return avisos;
}

/** Una fila de la cartera: cómo está cada cuenta, para quien lleva varias (un contador o una persona con su empresa). */
export interface FilaCartera {
  readonly rut: string;
  readonly alias: string;
  readonly tipo: Perfil['tipo'];
  readonly sesion: 'activa' | 'sin_sesion';
  /** Última vez que se trajo algo del SII para el mes más reciente con datos; null si nunca. */
  readonly ultimaSincronizacion: string | null;
  readonly f29PorVencer: number;
  readonly f29Vencidos: number;
  /** Período del F29 vencido más antiguo; null si no hay. */
  readonly masAntiguoVencido: string | null;
  readonly hallazgosCriticos: number;
  readonly proximoPlazo: { readonly vence: string; readonly descripcion: string } | null;
  readonly avisosSinVer: number;
  /** Movimientos del banco sin conciliar ni descartar; null si no hay cartolas. */
  readonly movimientosSinConciliar: number | null;
}

/** Días hacia adelante en que se busca el próximo plazo de cada cuenta. */
const DIAS_PROXIMO_PLAZO = 60;

/** Estado de todas las cuentas con lo guardado, sin ir al SII: lo que necesita atención en cada una. */
export function carteraEstado(deps: DepsApp): FilaCartera[] {
  const actual = periodoDeFecha(fechaEnSantiago(deps.reloj.ahora()));
  return deps.store.contribuyentes().map((perfil): FilaCartera => {
    const rut = perfil.rut;
    const listaPlazos = plazos(deps, rut, DIAS_PROXIMO_PLAZO);
    const f29 = listaPlazos.filter((p) => p.tipo === 'F29');
    const vencidos = f29.filter((p) => p.diasRestantes < 0);
    const ultimoMes = deps.store.periodosConDatos(rut).at(-1);
    const frescura = ultimoMes ? Object.values(deps.store.frescura(rut, ultimoMes)).filter((f): f is string => f !== null) : [];
    const conCartola = deps.store.cuentasBanco(rut).length > 0;
    const proximo = listaPlazos.find((p) => p.diasRestantes >= 0);
    return {
      rut,
      alias: perfil.alias,
      tipo: perfil.tipo,
      sesion: deps.sesiones.estado(rut).tieneSesion ? 'activa' : 'sin_sesion',
      ultimaSincronizacion: frescura.length > 0 ? frescura.sort().at(-1)! : null,
      f29PorVencer: f29.length - vencidos.length,
      f29Vencidos: vencidos.length,
      masAntiguoVencido: vencidos.map((p) => p.referencia ?? p.vence).sort()[0] ?? null,
      hallazgosCriticos: hallazgos(deps, rut, { desde: restarPeriodos(actual, MESES_HALLAZGOS).texto, severidad: 'critico' }).length,
      proximoPlazo: proximo ? { vence: proximo.vence, descripcion: proximo.descripcion } : null,
      avisosSinVer: deps.store.avisos({ rut, sinVer: true }).length,
      movimientosSinConciliar: conCartola ? deps.store.movimientosBanco(rut).length - deps.store.conciliaciones(rut).length : null,
    };
  });
}
