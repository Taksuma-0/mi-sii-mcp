import { ErrorMiSiiMcp } from '../domain/errores.js';
import { declaracionVigente } from '../domain/f29.js';
import { fechaEnSantiago } from '../domain/fechas.js';
import { crearPeriodo, periodoDeFecha, rangoPeriodos, restarPeriodos } from '../domain/periodo.js';
import type { TramoIgc } from '../reconciliation/estimar-renta.js';
import { CODIGO_F29 } from '../reconciliation/mapeo-f29.js';
import { proyectarCierre, simularRegimen, type ProyeccionCierre, type SimulacionRegimen, type SocioSimulado } from '../reconciliation/simuladores.js';
import { perfilExistente } from './consultas.js';
import { resultadoPeriodo } from './contabilidad.js';
import type { DepsApp } from './deps.js';
import { conRcv } from './estimar-f29.js';

/** Lo que hay guardado de un año comercial: los meses cerrados, cuáles tienen RCV y su resultado. */
export interface BaseDelAnio {
  readonly anio: number;
  readonly desde: string;
  readonly hasta: string;
  /** Percibido si las cartolas cubren del primer al último mes; si no, devengado. */
  readonly criterio: 'percibido' | 'devengado';
  readonly mesesConDatos: number;
  /** Meses cerrados del año sin RCV guardado. */
  readonly sinDatos: readonly string[];
  readonly ingresos: number;
  readonly gastos: number;
  readonly supuestos: readonly string[];
}

export interface ResultadoCierre extends ProyeccionCierre {
  readonly rut: string;
  readonly anio: number;
  readonly base: BaseDelAnio;
  readonly mesesPpm: number;
}

export interface ParametrosRegimen {
  readonly socios: readonly SocioSimulado[];
  readonly tasaIdpc: number;
  readonly tablaIgc: readonly TramoIgc[];
  /** Porcentaje de las utilidades que se retiran en el Pro Pyme General; 100 si no se informa. */
  readonly retiroPct?: number;
  /** Base imponible anual, si se conoce (con sueldos, depreciación y demás gastos); si no, la del año guardado. */
  readonly base?: number;
}

export interface ResultadoSimulacionRegimen extends SimulacionRegimen {
  readonly rut: string;
  readonly anio: number;
  readonly origenBase: 'informada' | 'del_anio' | 'proyectada';
  readonly requisitos: readonly string[];
}

export const REQUISITOS_REGIMEN = [
  'Los dos regímenes Pro Pyme exigen ingresos promedio del giro de hasta 75.000 UF en los últimos tres años (https://www.sii.cl/preguntas_frecuentes/declaracion_renta/001_140_7530.htm).',
  'El Transparente exige dueños personas naturales (o sin domicilio en Chile) y, si se abandona, no se puede volver en 5 años.',
  'El cambio de régimen se pide hasta el 30 de abril del año en que se quiere entrar (https://www.sii.cl/preguntas_frecuentes/declaracion_renta/001_140_7537.htm).',
];

const invalido = (mensaje: string): never => {
  throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', mensaje);
};

function anioComercial(deps: DepsApp, texto: string): { anio: number; ultimoMes: string } {
  const actual = periodoDeFecha(fechaEnSantiago(deps.reloj.ahora()));
  const anio = Number(texto);
  if (!/^\d{4}$/.test(texto) || anio < 2000 || anio > actual.anio) invalido(`El año comercial va entre 2000 y ${actual.anio}.`);
  const ultimo = anio === actual.anio ? restarPeriodos(actual, 1) : crearPeriodo(anio, 12);
  if (ultimo.anio < anio) invalido(`${anio} recién empieza: aún no hay meses cerrados.`);
  return { anio, ultimoMes: ultimo.texto };
}

function baseDelAnio(deps: DepsApp, rut: string, anio: number, ultimoMes: string): BaseDelAnio {
  const periodos = rangoPeriodos(crearPeriodo(anio, 1), periodoDeFecha(`${ultimoMes}-01`));
  const conDatos = periodos.filter((p) => conRcv(deps, rut, p.texto));
  if (conDatos.length === 0) {
    throw new ErrorMiSiiMcp('SIN_DATOS_LOCALES', `No hay RCV guardado de ${anio} para ${rut}: sincroniza ese año (en tramos de hasta 12 meses) antes de proyectarlo.`);
  }
  const desde = periodos[0]!.texto;
  const movimientos = deps.store.movimientosBanco(rut, { desde: `${desde}-01`, hasta: `${ultimoMes}-31` });
  const fechas = movimientos.map((m) => m.fecha).sort();
  const cubre = fechas.length > 0 && fechas[0]!.slice(0, 7) <= desde && fechas.at(-1)!.slice(0, 7) >= ultimoMes;
  const criterio = cubre ? 'percibido' : 'devengado';
  const r = resultadoPeriodo(deps, rut, desde, ultimoMes, criterio);
  const supuestos = [...r.supuestos];
  if (!cubre && movimientos.length > 0) supuestos.push('Las cartolas no cubren todo el año: se usa la base devengada.');
  return {
    anio,
    desde,
    hasta: ultimoMes,
    criterio,
    mesesConDatos: conDatos.length,
    sinDatos: periodos.filter((p) => !conDatos.includes(p)).map((p) => p.texto),
    ingresos: r.totalIngresos,
    gastos: r.totalGastos,
    supuestos,
  };
}

function ppmDelAnio(deps: DepsApp, rut: string, base: BaseDelAnio): { ppm: number; meses: number } {
  let ppm = 0;
  let meses = 0;
  for (const p of rangoPeriodos(periodoDeFecha(`${base.desde}-01`), periodoDeFecha(`${base.hasta}-01`))) {
    const vigente = declaracionVigente(deps.store.declaracionesF29(rut, p.texto));
    const valores = vigente ? deps.store.valoresF29(rut, p.texto, vigente.folio) : null;
    if (!valores) continue;
    ppm += valores.valores[CODIGO_F29.PPM] ?? 0;
    meses += 1;
  }
  return { ppm, meses };
}

function validarTasa(tasa: number): void {
  if (!(tasa >= 1 && tasa <= 40)) invalido('tasa_idpc va en porcentaje (por ejemplo 12,5), entre 1 y 40.');
}

/**
 * Proyecta el año comercial al cierre con lo guardado (RCV y, si las hay, cartolas) y los PPM pagados, para anticipar el
 * resultado de abril. Con la tasa de Primera Categoría, estima el impuesto y el saldo. Solo lee la base local.
 */
export function proyeccionCierre(deps: DepsApp, rutTexto: string, anioTexto: string, tasaIdpc?: number): ResultadoCierre {
  const rut = perfilExistente(deps, rutTexto).rut;
  if (tasaIdpc !== undefined) validarTasa(tasaIdpc);
  const { anio, ultimoMes } = anioComercial(deps, anioTexto);
  const base = baseDelAnio(deps, rut, anio, ultimoMes);
  const { ppm, meses } = ppmDelAnio(deps, rut, base);
  const proyeccion = proyectarCierre({ mesesConDatos: base.mesesConDatos, ingresos: base.ingresos, gastos: base.gastos, ppm, mesesPpm: meses, tasaIdpc: tasaIdpc ?? null });
  const notas = [...proyeccion.notas, 'Antes del 31 de diciembre revisa ahorro_oportunidades y compara regímenes con regimen_simular.'];
  return { ...proyeccion, notas, rut, anio, base, mesesPpm: meses };
}

/**
 * Simula un año en Pro Pyme General y en Pro Pyme Transparente con la base informada o la del año guardado (proyectada
 * si el año no está completo). Las tasas y la tabla son datos públicos que se informan. Simulación, no recomendación.
 */
export function simulacionRegimen(deps: DepsApp, rutTexto: string, anioTexto: string, p: ParametrosRegimen): ResultadoSimulacionRegimen {
  const rut = perfilExistente(deps, rutTexto).rut;
  validarTasa(p.tasaIdpc);
  if (p.tablaIgc.length === 0) invalido('Falta la tabla del Impuesto Global Complementario (fuentes_oficiales).');
  if (p.socios.length === 0) invalido('Indica al menos un socio con su participación.');
  if (p.socios.some((s) => !(s.participacion > 0 && s.participacion <= 100) || !(s.otrasRentas >= 0))) invalido('Cada socio va con una participación entre 0 y 100 y otras rentas no negativas.');
  if (Math.abs(p.socios.reduce((s, x) => s + x.participacion, 0) - 100) > 0.01) invalido('Las participaciones de los socios deben sumar 100.');
  const retiroPct = p.retiroPct ?? 100;
  if (!(retiroPct >= 0 && retiroPct <= 100)) invalido('retiro_pct va entre 0 y 100.');
  const anio = /^\d{4}$/.test(anioTexto) ? Number(anioTexto) : invalido('El año comercial va como AAAA.');

  let base: number;
  let origenBase: ResultadoSimulacionRegimen['origenBase'];
  const supuestos: string[] = [];
  if (p.base !== undefined) {
    base = p.base;
    origenBase = 'informada';
  } else {
    const { ultimoMes } = anioComercial(deps, anioTexto);
    const delAnio = baseDelAnio(deps, rut, anio, ultimoMes);
    const completo = delAnio.mesesConDatos === 12;
    base = completo ? delAnio.ingresos - delAnio.gastos : proyectarCierre({ mesesConDatos: delAnio.mesesConDatos, ingresos: delAnio.ingresos, gastos: delAnio.gastos, ppm: 0, mesesPpm: 0, tasaIdpc: null }).baseProyectada;
    origenBase = completo ? 'del_anio' : 'proyectada';
    supuestos.push(...delAnio.supuestos);
    if (!completo) supuestos.push(`Base proyectada a 12 meses al ritmo de ${delAnio.mesesConDatos} meses con datos (${delAnio.desde} a ${delAnio.hasta}).`);
  }
  const simulacion = simularRegimen({ base, socios: p.socios, tasaIdpc: p.tasaIdpc, tablaIgc: p.tablaIgc, retiroPct });
  supuestos.push(...simulacion.supuestos, 'Simula un solo año con la tasa y la tabla informadas; no considera créditos especiales, gastos rechazados ni los años siguientes.');
  return { ...simulacion, supuestos, rut, anio, origenBase, requisitos: REQUISITOS_REGIMEN };
}
