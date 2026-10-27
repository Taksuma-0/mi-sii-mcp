import type { FilaHistorialF29, PaginaDocumentos, ResumenIva } from '../app/consultas.js';
import type { CuentaSii, ResultadoCuenta } from '../app/cuenta.js';
import type { PerfilConSesion } from '../app/perfiles.js';
import type { ResultadoReleerF29, ResultadoRelectura } from '../app/releer-f29.js';
import type { AnioRenta, ResultadoAnioRenta, ResultadoRenta, ResumenRenta } from '../app/renta.js';
import { SINCRONIZACION_CANCELADA, type ResultadoPeriodo, type ResultadoSync } from '../app/sincronizar.js';
import { reintentoDe, type Reintento } from '../domain/errores.js';
import { formatearClp, nombreTipoDocumento } from '../domain/formato.js';
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
  const empresas =
    r.empresas === null || r.empresasActivas === null
      ? 'empresas autorizadas sin leer'
      : `${plural(r.empresasActivas, 'empresa activa', 'empresas activas')}, ${plural(r.empresas - r.empresasActivas, 'desautorizada', 'desautorizadas')}`;
  const lineas = [`Cuenta ${r.rut}: ${perfil} · ${empresas}`];
  if (r.empresas !== null) lineas.push(`Representa a ${plural(r.representa.length, 'empresa', 'empresas')}${r.representa.length > 0 ? `: ${r.representa.join(', ')}` : ''}`);
  if (r.errores.length > 0) lineas.push(`Errores: ${r.errores.map((e) => `${e.superficie} ${e.codigo}`).join(', ')}`);
  if (r.abortado) {
    lineas.push(r.abortado.codigo === SINCRONIZACION_CANCELADA.codigo ? r.abortado.mensaje : `Sincronización detenida: [${r.abortado.codigo}] ${r.abortado.mensaje}`);
  }
  return lineas.join('\n');
}

function lineaAnioRenta(a: ResultadoAnioRenta): string {
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
  if (a.errores.length > 0) partes.push(`errores: ${a.errores.map((e) => `${e.superficie} ${e.codigo}`).join(', ')}`);
  return `AT${a.anioTributario}: ${partes.join(' · ')}`;
}

/** Resultado de traer la renta (F22) del SII, año tributario por año. */
export function textoRenta(r: ResultadoRenta): string {
  const lineas = [`Renta (F22) ${r.rut}:`, ...r.anios.map(lineaAnioRenta)];
  if (r.abortado) {
    lineas.push(r.abortado.codigo === SINCRONIZACION_CANCELADA.codigo ? r.abortado.mensaje : `Sincronización detenida: [${r.abortado.codigo}] ${r.abortado.mensaje}`);
  }
  return lineas.join('\n');
}

function lineasAnioRenta(a: AnioRenta): string[] {
  if (a.folio === null) return [`AT${a.anioTributario} · sin folio vigente (${plural(a.declaraciones, 'declaración', 'declaraciones')})`];
  const marca = a.vigente === true ? 'vigente' : 'la más reciente; el SII no la marcó vigente';
  const cabecera = [
    `AT${a.anioTributario} · folio ${a.folio} (${marca}) de ${plural(a.declaraciones, 'declaración', 'declaraciones')}`,
    ...(a.fechaIngreso ? [`ingreso ${a.fechaIngreso}`] : []),
    ...(a.conclusion ? [a.conclusion] : a.codigoConclusion ? [`conclusión ${a.codigoConclusion}`] : []),
  ].join(' · ');
  const montos = [
    `Impuesto pagado ${monto(a.impuestoPagado)}`,
    `giro ${monto(a.montoGiro)}`,
    `remanente solicitado ${monto(a.remanenteSolicitado)}`,
    `devuelto ${monto(a.remanenteDevuelto)}`,
    ...(a.tipoImpugnado ? [`tipo impugnado ${a.tipoImpugnado}`] : []),
  ].join(' · ');
  return [
    cabecera,
    `  ${montos}`,
    ...a.codigosClave.map((c) => `  ${c.codigo} ${c.glosa ?? 'sin glosa'}: ${monto(c.valor)}`),
    ...a.observaciones.map((o) => `  Observación ${o.codigo}: ${o.descripcion ?? 'sin descripción'}`),
    ...a.eventos.map((e) => `  Evento ${e.fecha ?? 'sin fecha'}: ${e.nombre ?? e.codigoEvento ?? 'sin nombre'}`),
    a.codigos === 0 ? '  Sin detalle guardado del folio' : `  ${plural(a.codigos, 'código guardado', 'códigos guardados')} (todos en f22_valor)`,
  ];
}

/** Renta (F22) guardada por año tributario: folio vigente, conclusión, códigos clave, observaciones y eventos. */
export function textoResumenRenta(r: ResumenRenta): string {
  if (r.anios.length === 0) {
    return `No hay renta (F22) guardada de ${r.rut}. Tráela con renta_sincronizar (o \`impuestocl renta sync <rut> --desde AAAA\`); el año tributario es el año comercial + 1.`;
  }
  return [`Renta (F22) ${r.rut} — ${plural(r.anios.length, 'año tributario guardado', 'años tributarios guardados')}`, ...r.anios.flatMap(lineasAnioRenta)].join('\n');
}

function lineaCuenta(c: CuentaSii): string {
  const activas = c.empresas.filter((e) => e.activa).length;
  const partes = [
    `día 20: ${TEXTO_DIA20(c.autorizadoDia20)}`,
    ...(c.segmento ? [`segmento ${c.segmento}`] : []),
    ...(c.empresas.length > 0 ? [plural(activas, 'empresa activa', 'empresas activas')] : []),
  ];
  return ` · ${partes.join(' · ')}`;
}

export function textoPerfiles(perfiles: readonly PerfilConSesion[]): string {
  if (perfiles.length === 0) return 'No hay perfiles. Agrega uno con `impuestocl perfil agregar <rut> --alias <nombre> --tipo empresa`.';
  return perfiles
    .map((p) => {
      const navegador = p.sesion.origen === 'navegador' ? ' (navegador, sin renovación automática)' : '';
      const sesion = p.sesion.bloqueado ? 'BLOQUEADA (clave rechazada)' : p.sesion.tieneSesion ? `guardada ${p.sesion.guardadaEn}${navegador}` : 'sin sesión';
      const acceso = p.accedeCon ? ` · accede con ${p.accedeCon}` : '';
      return `${p.rut}  ${p.alias} (${p.tipo})${p.razonSocial ? ` — ${p.razonSocial}` : ''} · sesión: ${sesion}${acceso}${p.cuenta ? lineaCuenta(p.cuenta) : ''}`;
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
