import type { FilaHistorialF29, PaginaDocumentos, ResumenIva } from '../app/consultas.js';
import type { CuentaSii, ResultadoCuenta } from '../app/cuenta.js';
import { REGLA_ESTIMACION_RENTA, type FuenteOficial } from '../app/fuentes.js';
import type { PerfilConSesion } from '../app/perfiles.js';
import type { ResultadoReleerF29, ResultadoRelectura } from '../app/releer-f29.js';
import type { AnioRenta, HonorariosEmitidos, InformadoTerceros, InformanteTercero, ResultadoAnioRenta, ResultadoRenta, ResumenRenta } from '../app/renta.js';
import { SINCRONIZACION_CANCELADA, type ResultadoPeriodo, type ResultadoSync } from '../app/sincronizar.js';
import { reintentoDe, type Reintento } from '../domain/errores.js';
import { formatearClp, nombreTipoDocumento } from '../domain/formato.js';
import type { ComparacionMonto, ParCruceHonorarios } from '../domain/renta.js';
import type { Hallazgo, Plazo, Severidad } from '../domain/tipos.js';

const ETIQUETA: Readonly<Record<Severidad, string>> = { critico: 'CRÍTICO', advertencia: 'ADVERTENCIA', info: 'INFO' };
const monto = (n: number | null): string => (n === null ? 'sin dato' : formatearClp(n));

export function textoHallazgos(hallazgos: readonly Hallazgo[]): string {
  if (hallazgos.length === 0) return 'Sin hallazgos.';
  return hallazgos.map((h) => `[${ETIQUETA[h.severidad]}] ${h.regla} ${h.periodo} — ${h.titulo}\n    ${h.detalle}`).join('\n');
}

function lineaPropuesta(p: ResumenIva['propuesta']): string {
  if (p === null) return 'Propuesta del SII: sin datos';
  if (p.sinPropuesta) return 'Propuesta del SII: sin propuesta para este mes';
  const credito = p.origenCredito === '511' ? `crédito propuesto (código 511, informativo) ${monto(p.credito)}` : `crédito ${monto(p.credito)}`;
  return `Propuesta del SII: ${credito} · remanente ${monto(p.remanente)} · retención ${monto(p.retencion)}`;
}

function lineaHonorarios(h: NonNullable<ResumenIva['honorarios']>): string {
  if (h === 'sin_respuesta') return 'Boletas de honorarios recibidas: sin respuesta del SII';
  if (h.cantidad === 0) return 'Boletas de honorarios recibidas: ninguna';
  const anuladas = h.anuladas === 0 ? '' : ` (${h.anuladas} ${h.anuladas === 1 ? 'anulada' : 'anuladas'})`;
  return `Boletas de honorarios recibidas: ${h.cantidad}${anuladas} · bruto ${monto(h.bruto)} · retención ${monto(h.retencion)}`;
}

export function textoResumenIva(r: ResumenIva): string {
  const c = r.comparaciones;
  const faltantes = [!r.disponibilidad.ventasRcv && 'ventas RCV', !r.disponibilidad.comprasRcv && 'compras RCV', !r.disponibilidad.f29 && 'F29'].filter(Boolean);
  return [
    `IVA ${r.periodo} — ${r.rut}`,
    `Débito  (ventas RCV):  ${monto(c.debitoRcv)} · F29: ${monto(c.debitoF29)}`,
    `Crédito (compras RCV): ${monto(c.creditoRcv)} · F29: ${monto(c.creditoF29)}`,
    `Remanente: mes anterior (77) ${monto(c.remanenteAnterior77)} → este mes (504) ${monto(c.remanenteActual504)}`,
    r.f29
      ? `F29: folio ${r.f29.folio} (${r.f29.estado}), presentado ${r.f29.fechaPresentacion ?? 'sin fecha'}, total a pagar ${monto(r.f29.totalAPagar)}`
      : `F29: ${r.disponibilidad.f29 ? 'no presentado' : 'sin sincronizar'} — vence ${r.venceF29} con pago (${r.venceF29SinPago} sin pago)`,
    ...(r.disponibilidad.propuestaF29 ? [lineaPropuesta(r.propuesta)] : []),
    ...(r.honorarios ? [lineaHonorarios(r.honorarios)] : []),
    `Compras pendientes de aceptar o reclamar: ${r.compras.pendientes ?? 'sin dato'} · reclamadas: ${r.compras.reclamados ?? 'sin dato'}`,
    ...(faltantes.length > 0 ? [`Falta sincronizar: ${faltantes.join(', ')}`] : []),
    `Hallazgos (${r.hallazgos.length}):`,
    textoHallazgos(r.hallazgos).replace(/^/gm, '  '),
    `Datos: RCV al ${r.frescura.rcv ?? 'nunca'} · F29 al ${r.frescura.f29 ?? 'nunca'}${r.frescura.propuesta ? ` · propuesta al ${r.frescura.propuesta}` : ''}${r.frescura.bhe ? ` · boletas al ${r.frescura.bhe}` : ''}`,
  ].join('\n');
}

export function textoPlazos(plazos: readonly Plazo[]): string {
  if (plazos.length === 0) return 'Sin plazos próximos.';
  return plazos
    .map((p) => `${p.vence} (${p.diasRestantes < 0 ? `vencido hace ${-p.diasRestantes} día(s)` : `en ${p.diasRestantes} día(s)`}) — ${p.descripcion}`)
    .join('\n');
}

const plural = (n: number, singular: string, pluralTexto: string): string => `${n} ${n === 1 ? singular : pluralTexto}`;

const TEXTO_DIA20 = (autorizado: boolean | null): string => (autorizado === null ? 'sin dato' : autorizado ? 'autorizado' : 'no autorizado');

/** Resultado de leer la cuenta del SII (perfil tributario y empresas autorizadas), sin datos personales. */
export function textoCuenta(r: ResultadoCuenta): string {
  const perfil = r.perfil === 'leido' ? `día 20: ${TEXTO_DIA20(r.autorizadoDia20)}` : 'perfil tributario sin leer';
  // El SII lista también el propio RUT; las «otras» empresas activas son las que representa.
  const empresas =
    r.empresas === null || r.empresasActivas === null
      ? 'empresas autorizadas sin leer'
      : `${plural(r.representa.length, 'otra empresa activa', 'otras empresas activas')}, ${plural(r.empresas - r.empresasActivas, 'desautorizada', 'desautorizadas')}`;
  const lineas = [`Cuenta ${r.rut}: ${perfil} · ${empresas}`];
  if (r.empresas !== null) lineas.push(`Representa a ${plural(r.representa.length, 'empresa', 'empresas')}${r.representa.length > 0 ? `: ${r.representa.join(', ')}` : ''}`);
  if (r.errores.length > 0) lineas.push(`Errores: ${r.errores.map((e) => `${e.superficie} ${e.codigo}`).join(', ')}`);
  if (r.abortado) {
    lineas.push(r.abortado.codigo === SINCRONIZACION_CANCELADA.codigo ? r.abortado.mensaje : `Sincronización detenida: [${r.abortado.codigo}] ${r.abortado.mensaje}`);
  }
  return lineas.join('\n');
}

/** «3 meses leídos, 1 al día, 1 con error»: solo lo que pasó; null si el año no tenía meses con boletas. */
function textoDetalleBoletas(d: NonNullable<ResultadoAnioRenta['detalleBoletas']>): string | null {
  const partes = [
    ...(d.leidos > 0 ? [plural(d.leidos, 'mes leído', 'meses leídos')] : []),
    ...(d.omitidos > 0 ? [`${d.omitidos} al día`] : []),
    ...(d.fallidos > 0 ? [`${d.fallidos} con error`] : []),
  ];
  return partes.length === 0 ? null : `detalle por boleta: ${partes.join(', ')}`;
}

function lineasAnioSincronizado(a: ResultadoAnioRenta): string[] {
  const partes =
    a.declaraciones === null
      ? ['declaraciones sin leer']
      : a.declaraciones === 0
        ? ['sin declaraciones']
        : [
            plural(a.declaraciones, 'declaración', 'declaraciones'),
            a.folioVigente === null ? 'sin folio vigente' : `folio vigente ${a.folioVigente}`,
            ...(a.detalle === 'leido' ? ['detalle leído'] : a.detalle === 'sin_leer' ? ['detalle sin leer'] : []),
          ];
  if (a.boletasEmitidas !== null) partes.push(`${plural(a.boletasEmitidas, 'boleta emitida', 'boletas emitidas')} en ${a.anioTributario - 1}`);
  const detalle = a.detalleBoletas === null ? null : textoDetalleBoletas(a.detalleBoletas);
  if (detalle !== null) partes.push(detalle);
  // Sin lista de DJ el error ya va en «errores».
  if (a.terceros !== null) partes.push(textoTercerosSync(a.terceros));
  if (a.errores.length > 0) partes.push(`errores: ${a.errores.map((e) => `${e.superficie} ${e.codigo}`).join(', ')}`);
  return [`AT${a.anioTributario}: ${partes.join(' · ')}`, ...(a.detalleBoletas?.avisos ?? []).map((aviso) => `  Aviso: ${aviso}`)];
}

/** «2 DJ de terceros, 1 sin leer (3 informantes)» o «sin DJ de terceros». */
function textoTercerosSync(t: NonNullable<ResultadoAnioRenta['terceros']>): string {
  if (t.informadas === 0) return 'sin DJ de terceros';
  const sinLeer = t.informadas - t.leidas;
  return `${t.informadas} DJ de terceros${sinLeer > 0 ? `, ${sinLeer} sin leer` : ''} (${plural(t.filas, 'informante', 'informantes')})`;
}

/** Resultado de traer la renta (F22) del SII, año tributario por año. */
export function textoRenta(r: ResultadoRenta): string {
  const lineas = [`Renta (F22) ${r.rut}:`, ...r.anios.flatMap(lineasAnioSincronizado)];
  if (r.abortado) {
    lineas.push(r.abortado.codigo === SINCRONIZACION_CANCELADA.codigo ? r.abortado.mensaje : `Sincronización detenida: [${r.abortado.codigo}] ${r.abortado.mensaje}`);
  }
  return lineas.join('\n');
}

/** `+0,6 %`: el reajuste con un decimal y coma, como se escribe en Chile. */
const porcentaje = (p: number): string => `${p < 0 ? '-' : '+'}${Math.abs(p).toFixed(1).replace('.', ',')} %`;

const PARES_CRUCE = [
  { clave: 'bruto', etiqueta: 'bruto', pronombre: 'lo' },
  { clave: 'retencion', etiqueta: 'retención', pronombre: 'la' },
] as const;

/** Un par del cruce en palabras; null si no hay boletas ni F22 que comparar. Solo el primer `cuadra` explica el reajuste. */
function textoPar(etiqueta: string, pronombre: string, p: ParCruceHonorarios, explicar: boolean): string | null {
  const nombre = `${etiqueta} vs ${p.codigo}`;
  if (p.estado === 'sin_datos') return null;
  if (p.estado === 'sin_declarar') return `${nombre}: el F22 no ${pronombre} declara (boletas ${monto(p.boletas)})`;
  if (p.estado === 'difiere') return `${nombre} difiere (boletas ${monto(p.boletas)}, F22 ${monto(p.f22)})`;
  const reajuste = p.reajustePct === null ? '' : ` (${explicar ? 'el F22 reajusta por IPC: ' : ''}${porcentaje(p.reajustePct)})`;
  return `${nombre} cuadra${reajuste}`;
}

/** Boletas de honorarios emitidas del año comercial y su cruce con el F22; la retención propia solo si la hubo. */
function lineasHonorarios(h: HonorariosEmitidos): string[] {
  const titulo = `  Boletas de honorarios emitidas en ${h.anioComercial}`;
  if (h.vigentes + h.anuladas === 0 && h.bruto + h.retencionTerceros + h.retencionPropia === 0) return [`${titulo}: ninguna`];
  const anuladas = h.anuladas === 0 ? '' : ` (${plural(h.anuladas, 'anulada', 'anuladas')})`;
  const montos = [`bruto ${monto(h.bruto)}`, `retención ${monto(h.retencionTerceros)}`, ...(h.retencionPropia > 0 ? [`retención propia ${monto(h.retencionPropia)}`] : [])];
  const lineas = [`${titulo}: ${plural(h.vigentes, 'vigente', 'vigentes')}${anuladas} · ${montos.join(' · ')}`];
  if (h.cruceF22 !== null) {
    const cruce = h.cruceF22;
    const explicada = PARES_CRUCE.find(({ clave }) => cruce[clave].estado === 'cuadra')?.clave;
    const pares = PARES_CRUCE.flatMap(({ clave, etiqueta, pronombre }) => textoPar(etiqueta, pronombre, cruce[clave], clave === explicada) ?? []);
    if (pares.length > 0) lineas.push(`  Cruce con el F22: ${pares.join(' · ')}`);
  }
  if (h.pagadores !== null && h.pagadores.principales.length > 0) {
    const principales = h.pagadores.principales.map((p) => `${p.nombreReceptor ?? p.rutReceptor} ${monto(p.bruto)} (retención ${monto(p.retencion)})`);
    lineas.push(`  Por pagador: ${[...principales, ...(h.pagadores.otros > 0 ? [`y ${h.pagadores.otros} más`] : [])].join(' · ')}`);
  }
  return lineas;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const textoMeses = (meses: readonly number[]): string => meses.map((m) => MESES[m - 1] ?? String(m)).join(', ');

/** «cuadra (+1,1 %)» o «difiere $19.000 (la DJ trae menos)»; `explicar` agrega que la diferencia es el reajuste por IPC. */
function textoComparacion(c: ComparacionMonto, explicar = false): string {
  if (c.estado === 'cuadra') return c.reajustePct === null || c.reajustePct === 0 ? 'cuadra' : `cuadra (${explicar ? 'la DJ reajusta por IPC: ' : ''}${porcentaje(c.reajustePct)})`;
  return `difiere ${monto(Math.abs(c.diferencia))} (la DJ trae ${c.diferencia > 0 ? 'más' : 'menos'})`;
}

/** Montos de un informante: los que se reconocen por su cabecera o, si ninguno, los distintos de 0 con su cabecera del SII. */
function montosInformante(i: InformanteTercero): string[] {
  const conocidos = [
    ...(i.retencionHonorarios !== undefined ? [`retención ${monto(i.retencionHonorarios)}`] : []),
    ...(i.rentaSueldo !== undefined ? [`renta ${monto(i.rentaSueldo)}`] : []),
    ...(i.impuestoUnicoRetenido !== undefined ? [`impuesto único ${monto(i.impuestoUnicoRetenido)}`] : []),
  ];
  if (conocidos.length > 0) return conocidos;
  return Object.entries(i.montos).flatMap(([c, v]) => (v === null || v === 0 ? [] : [`${c.split(' / ').at(-1)} ${monto(v)}`]));
}

/** Una línea por informante (y otra con su cruce con las boletas, si hay) y la retención de la 1879 contra boletas y F22. */
function lineasTerceros(t: InformadoTerceros): string[] {
  const lineas = [`  Informado por terceros (DJ): ${plural(t.informantes.length, 'informante', 'informantes')}`];
  for (const i of t.informantes) {
    const quien = i.informanteNombre === null ? i.informanteRut : `${i.informanteNombre} (${i.informanteRut})`;
    // Observada: el SII observó la declaración del informante; es un aviso, nunca un hallazgo crítico.
    const estado = i.observada ? [`Aviso: ${i.estado ?? 'Observada'} (el SII observó la declaración de este informante)`] : i.estado ? [i.estado] : [];
    lineas.push(`    ${[`DJ ${i.dj}`, quien, i.meses.length === 0 ? 'sin meses' : textoMeses(i.meses), ...montosInformante(i), ...estado].join(' · ')}`);
    const b = i.cruceBoletas;
    if (b === null) continue;
    const partes = [
      `Boletas emitidas a ese RUT: ${b.boletas}`,
      textoMeses(b.mesesBoletas),
      ...(b.soloDj.length > 0 ? [`meses solo en la DJ: ${textoMeses(b.soloDj)}`] : []),
      ...(b.soloBoletas.length > 0 ? [`solo en boletas: ${textoMeses(b.soloBoletas)}`] : []),
      ...(b.retencion === null ? [] : [`retención ${textoComparacion(b.retencion)}`]),
    ];
    lineas.push(`      ${partes.join(' · ')}`);
  }
  const c = t.cruceRetencion;
  if (c !== null) {
    const f22 = c.f22 === null ? [] : [`vs F22 492: ${c.f22.otro === null ? 'el F22 no la declara' : textoComparacion(c.f22)}`];
    const boletas = c.boletas === null ? [] : [`vs boletas emitidas: ${textoComparacion(c.boletas, true)}`];
    lineas.push(`  ${[`Retención informada en la DJ ${c.dj}: ${monto(c.informada)}`, ...boletas, ...f22].join(' · ')}`);
  }
  return lineas;
}

function lineasAnioRenta(a: AnioRenta): string[] {
  const honorarios = [...(a.honorariosEmitidos === null ? [] : lineasHonorarios(a.honorariosEmitidos)), ...(a.terceros === null ? [] : lineasTerceros(a.terceros))];
  // Un año solo con boletas emitidas guardadas (p. ej. el año en curso, que aún no tiene F22).
  if (a.declaraciones === 0) return [`AT${a.anioTributario} · sin F22 guardado`, ...honorarios];
  if (a.folio === null) return [`AT${a.anioTributario} · sin folio vigente (${plural(a.declaraciones, 'declaración', 'declaraciones')})`, ...honorarios];
  const marca = a.vigente === true ? 'vigente' : 'la más reciente; el SII no la marcó vigente';
  const cabecera = [
    `AT${a.anioTributario} · folio ${a.folio} (${marca}) de ${plural(a.declaraciones, 'declaración', 'declaraciones')}`,
    ...(a.fechaIngreso ? [`ingreso ${a.fechaIngreso}`] : []),
    ...(a.conclusion ? [a.conclusion] : a.codigoConclusion ? [`conclusión ${a.codigoConclusion}`] : []),
  ].join(' · ');
  // Solo los montos que el SII informó: «sin dato» en cada línea vacía tapaba lo importante. Tipo impugnado "0" es sin impugnación.
  const montos = (
    [
      ['Impuesto pagado', a.impuestoPagado],
      ['giro', a.montoGiro],
      ['remanente solicitado', a.remanenteSolicitado],
      ['devuelto', a.remanenteDevuelto],
    ] as const
  )
    .filter(([, valor]) => valor !== null)
    .map(([etiqueta, valor]) => `${etiqueta} ${monto(valor)}`);
  if (a.tipoImpugnado && a.tipoImpugnado !== '0') montos.push(`tipo impugnado ${a.tipoImpugnado}`);
  const sinMonto = a.codigosClave.filter((c) => c.valor === null).map((c) => c.codigo);
  return [
    cabecera,
    ...(montos.length > 0 ? [`  ${montos.join(' · ')}`] : []),
    ...a.codigosClave.filter((c) => c.valor !== null).map((c) => `  ${c.codigo} ${c.glosa ?? 'sin glosa'}: ${monto(c.valor)}`),
    ...(sinMonto.length > 0 ? [`  Sin monto en el folio: ${sinMonto.join(', ')}`] : []),
    ...a.observaciones.map((o) => `  Observación ${o.codigo}: ${o.descripcion ?? 'sin descripción'}`),
    ...a.eventos.map((e) => `  Evento ${e.fecha ?? 'sin fecha'}: ${e.nombre ?? e.codigoEvento ?? 'sin nombre'}`),
    a.codigos === 0 ? '  Sin detalle guardado del folio' : `  ${plural(a.codigos, 'código guardado', 'códigos guardados')} (todos en f22_valor)`,
    ...honorarios,
  ];
}

/** Renta (F22) guardada por año tributario: folio vigente, conclusión, códigos clave, observaciones y eventos. */
export function textoResumenRenta(r: ResumenRenta): string {
  if (r.anios.length === 0) {
    return `No hay renta (F22) guardada de ${r.rut}. Tráela con renta_sincronizar (o \`mi-sii-mcp renta sync <rut> --desde AAAA\`); el año tributario es el año comercial + 1.`;
  }
  return [`Renta (F22) ${r.rut} — ${plural(r.anios.length, 'año tributario guardado', 'años tributarios guardados')}`, ...r.anios.flatMap(lineasAnioRenta)].join('\n');
}

/** Día 20, segmento y las otras empresas activas que puede consultar: el propio RUT, que el SII también lista, no cuenta. */
function lineaCuenta(c: CuentaSii, rut: string): string {
  const otras = c.empresas.filter((e) => e.activa && e.rut !== rut).length;
  const partes = [
    `día 20: ${TEXTO_DIA20(c.autorizadoDia20)}`,
    ...(c.segmento ? [`segmento ${c.segmento}`] : []),
    ...(otras > 0 ? [plural(otras, 'otra empresa activa', 'otras empresas activas')] : []),
  ];
  return ` · ${partes.join(' · ')}`;
}

export function textoPerfiles(perfiles: readonly PerfilConSesion[]): string {
  if (perfiles.length === 0) return 'No hay perfiles. Agrega uno con `mi-sii-mcp perfil agregar <rut> --alias <nombre> --tipo empresa`.';
  return perfiles
    .map((p) => {
      const navegador =
        p.sesion.origen === 'navegador'
          ? ' (navegador, sin renovación automática)'
          : p.sesion.renuevaSola === true
            ? ' (se renueva sola)'
            : p.sesion.renuevaSola === false
              ? ' (sin clave guardada: cuando venza, hay que conectar de nuevo en «Abrir mi-sii-mcp.cmd»)'
              : '';
      const sesion = p.sesion.bloqueado ? 'BLOQUEADA (clave rechazada)' : p.sesion.tieneSesion ? `guardada ${p.sesion.guardadaEn}${navegador}` : 'sin sesión';
      const acceso = p.accedeCon ? ` · accede con ${p.accedeCon}` : '';
      return `${p.rut}  ${p.alias} (${p.tipo})${p.razonSocial ? ` — ${p.razonSocial}` : ''} · sesión: ${sesion}${acceso}${p.cuenta ? lineaCuenta(p.cuenta, p.rut) : ''}`;
    })
    .join('\n');
}

const TEXTO_REINTENTO: Readonly<Record<Reintento, string>> = {
  inmediato: 'ahora mismo',
  mas_tarde: 'más tarde',
  no: 'no (repetirlo igual no lo resuelve; sigue la acción indicada)',
};

/** Línea que dice si conviene volver a intentar un error; `codigo` es texto porque los errores de sincronización no lo tipan. */
export const lineaReintento = (codigo: string): string => `Reintentar: ${TEXTO_REINTENTO[reintentoDe(codigo)]}`;

/** Errores de una sincronización agrupados por lo que se sincronizó (un mes, un año tributario o la cuenta, que no tiene etiqueta). */
interface GrupoErrores {
  readonly etiqueta: string | null;
  readonly errores: readonly { readonly superficie: string; readonly codigo: string }[];
}

/** Qué se puede reintentar: lo que falló con errores que se resuelven esperando y, si la sincronización se detuvo por algo reintentable, cuándo. `null` si nada. */
function textoReintentablesDe(grupos: readonly GrupoErrores[], abortado: ResultadoSync['abortado']): string | null {
  const items = grupos.flatMap((g) =>
    g.errores.filter((e) => reintentoDe(e.codigo) === 'mas_tarde').map((e) => (g.etiqueta === null ? `${e.superficie} ${e.codigo}` : `${g.etiqueta} (${e.superficie} ${e.codigo})`)),
  );
  // La cancelación la pidió la persona: no hace falta aconsejarle que reintente.
  const detenida = abortado && abortado.codigo !== SINCRONIZACION_CANCELADA.codigo && reintentoDe(abortado.codigo) !== 'no' ? lineaReintento(abortado.codigo) : null;
  const lineas = [...(items.length === 0 ? [] : [`Reintentables más tarde: ${items.join(', ')}`]), ...(detenida ? [detenida] : [])];
  return lineas.length === 0 ? null : lineas.join('\n');
}

/** Qué se puede reintentar de una sincronización: los meses con errores que se resuelven esperando y, si se detuvo por algo reintentable, cuándo. `null` si nada. */
export function textoReintentables(r: ResultadoSync): string | null {
  return textoReintentablesDe(r.periodos.map((p) => ({ etiqueta: p.periodo, errores: p.errores })), r.abortado);
}

/** Lo mismo para la sincronización de la renta: por año tributario. */
export function textoReintentablesRenta(r: ResultadoRenta): string | null {
  return textoReintentablesDe(r.anios.map((a) => ({ etiqueta: `AT${a.anioTributario}`, errores: a.errores })), r.abortado);
}

/** Lo mismo para la sincronización de la cuenta: sus lecturas no son de un mes. */
export function textoReintentablesCuenta(r: ResultadoCuenta): string | null {
  return textoReintentablesDe([{ etiqueta: null, errores: r.errores }], r.abortado);
}

const TEXTO_PROPUESTA: Readonly<Record<NonNullable<ResultadoPeriodo['propuesta']> | 'sin_traer', string>> = {
  con_datos: 'propuesta con datos',
  sin_propuesta: 'sin propuesta del SII',
  sin_respuesta: 'propuesta sin respuesta del SII',
  sin_traer: 'propuesta sin traer',
};

function textoBoletasSync(boletas: ResultadoPeriodo['boletasHonorarios']): string {
  if (boletas === undefined) return 'boletas de honorarios sin traer';
  if (boletas === null) return 'boletas de honorarios sin respuesta del SII';
  return `${boletas} ${boletas === 1 ? 'boleta' : 'boletas'} de honorarios`;
}

export function textoSync(r: ResultadoSync): string {
  const lineas = r.periodos.map((p) => {
    const partes = [
      ...(r.superficies.includes('rcv') ? [`${p.documentos} documentos RCV`] : []),
      ...(r.superficies.includes('f29') ? [`F29 ${p.f29Folio ? `folio ${p.f29Folio}` : 'sin folio informado'}`] : []),
      ...(r.superficies.includes('propuesta') ? [TEXTO_PROPUESTA[p.propuesta ?? 'sin_traer']] : []),
      ...(r.superficies.includes('bhe') ? [textoBoletasSync(p.boletasHonorarios)] : []),
    ];
    let linea = `${p.periodo}: ${partes.join(' · ')}`;
    if (p.errores.length > 0) linea += ` · errores: ${p.errores.map((e) => `${e.superficie} ${e.codigo}`).join(', ')}`;
    if (p.avisos.length > 0) linea += `\n    avisos: ${p.avisos.join(' | ')}`;
    return linea;
  });
  if (r.abortado) {
    // La cancelación la pidió la persona: basta su mensaje, sin presentarla como una falla.
    lineas.push(r.abortado.codigo === SINCRONIZACION_CANCELADA.codigo ? r.abortado.mensaje : `Sincronización detenida: [${r.abortado.codigo}] ${r.abortado.mensaje}`);
  }
  return [`Sincronización ${r.rut}`, ...lineas].join('\n');
}

const TEXTO_RELECTURA: Readonly<Record<ResultadoRelectura, string>> = {
  sin_cambios: 'sin cambios',
  actualizado: 'actualizado',
  ilegible: 'ilegible',
  incoherente_conservado: 'se conserva la lectura guardada',
  sin_declaracion: 'sin declaración guardada, no se escribió',
};

export function textoReleerF29(r: ResultadoReleerF29): string {
  if (r.folios.length === 0) return `Relectura del F29 de ${r.rut}: no hay PDF del F29 guardados en el rango; sincroniza el F29 para traerlos.`;
  return [
    `Relectura del F29 de ${r.rut} con el lector ${r.versionLector} (sin ir al SII):`,
    ...r.folios.map((f) => {
      const codigos = f.resultado === 'actualizado' ? ` (códigos ${f.codigosCambiados.join(', ')})` : '';
      return `${f.periodo} folio ${f.folio}: ${TEXTO_RELECTURA[f.resultado]}${codigos}${f.mensaje === null ? '' : ` — ${f.mensaje}`}`;
    }),
  ].join('\n');
}

export function textoHistorialF29(filas: readonly FilaHistorialF29[]): string {
  return filas
    .map((f) => {
      const linea = f.presentado
        ? `${f.periodo}: folio ${f.folio} (${f.estado}) · débitos ${monto(f.debitos)} · créditos ${monto(f.creditos)} · a pagar ${monto(f.totalAPagar)}`
        : `${f.periodo}: ${f.sincronizado ? 'no presentado' : 'sin sincronizar'}`;
      // La retención solo se muestra si se consultaron las boletas de honorarios del mes.
      if (f.retencionBoletas === null) return linea;
      const declarada = f.presentado ? ` · retención (151) ${monto(f.retencion151)}` : '';
      return `${linea}${declarada} · retención de boletas de honorarios ${monto(f.retencionBoletas)}`;
    })
    .join('\n');
}

export function textoDocumentos(p: PaginaDocumentos): string {
  return [
    `${p.total} documento(s) · página ${p.pagina}`,
    ...p.documentos.map(
      (d) =>
        `${d.lado} ${d.estado} ${nombreTipoDocumento(d.tipoDoc)} ${d.folio} · ${d.razonSocial ?? d.rutContraparte} · ${d.fechaEmision ?? 'sin fecha'} · neto ${formatearClp(d.montoNeto)} · IVA ${formatearClp(d.montoIva)} · total ${formatearClp(d.montoTotal)}`,
    ),
  ].join('\n');
}

/** Dónde consultar los datos públicos de la renta y, si se pidió, la regla para estimar el F22 de una persona. */
export function textoFuentes(fuentes: readonly FuenteOficial[], conRegla: boolean): string {
  const lineas = [
    'Datos públicos: mi-sii-mcp no los guarda. Consúltalos en la página oficial del año que se calcula y cita la fuente.',
    ...(fuentes.length === 0 ? ['Ninguna fuente calza con la búsqueda; pide la lista completa sin filtro.'] : []),
    ...fuentes.flatMap((f) => [`- ${f.parametro}: ${f.urls.join(' · ')}`, `  Qué buscar: ${f.buscar}`]),
  ];
  if (conRegla) lineas.push('Regla para estimar el F22 de una persona (sueldo y honorarios):', ...REGLA_ESTIMACION_RENTA.map((p, i) => `${i + 1}. ${p}`));
  return lineas.join('\n');
}
