import type { FilaHistorialF29, PaginaDocumentos, ResumenIva } from '../app/consultas.js';
import type { PerfilConSesion } from '../app/perfiles.js';
import { SINCRONIZACION_CANCELADA, type ResultadoSync } from '../app/sincronizar.js';
import { reintentoDe, type Reintento } from '../domain/errores.js';
import { formatearClp, nombreTipoDocumento } from '../domain/formato.js';
import type { Hallazgo, Plazo, Severidad } from '../domain/tipos.js';

const ETIQUETA: Readonly<Record<Severidad, string>> = { critico: 'CRÍTICO', advertencia: 'ADVERTENCIA', info: 'INFO' };
const monto = (n: number | null): string => (n === null ? 'sin dato' : formatearClp(n));

export function textoHallazgos(hallazgos: readonly Hallazgo[]): string {
  if (hallazgos.length === 0) return 'Sin hallazgos.';
  return hallazgos.map((h) => `[${ETIQUETA[h.severidad]}] ${h.regla} ${h.periodo} — ${h.titulo}\n    ${h.detalle}`).join('\n');
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
      : `F29: ${r.disponibilidad.f29 ? 'no presentado' : 'sin sincronizar'} — vence ${r.venceF29}`,
    `Compras pendientes de aceptar o reclamar: ${r.compras.pendientes ?? 'sin dato'} · reclamadas: ${r.compras.reclamados ?? 'sin dato'}`,
    ...(faltantes.length > 0 ? [`Falta sincronizar: ${faltantes.join(', ')}`] : []),
    `Hallazgos (${r.hallazgos.length}):`,
    textoHallazgos(r.hallazgos).replace(/^/gm, '  '),
    `Datos: RCV al ${r.frescura.rcv ?? 'nunca'} · F29 al ${r.frescura.f29 ?? 'nunca'}`,
  ].join('\n');
}

export function textoPlazos(plazos: readonly Plazo[]): string {
  if (plazos.length === 0) return 'Sin plazos próximos.';
  return plazos
    .map((p) => `${p.vence} (${p.diasRestantes < 0 ? `vencido hace ${-p.diasRestantes} día(s)` : `en ${p.diasRestantes} día(s)`}) — ${p.descripcion}`)
    .join('\n');
}

export function textoPerfiles(perfiles: readonly PerfilConSesion[]): string {
  if (perfiles.length === 0) return 'No hay perfiles. Agrega uno con `impuestocl perfil agregar <rut> --alias <nombre> --tipo empresa`.';
  return perfiles
    .map((p) => {
      const sesion = p.sesion.bloqueado ? 'BLOQUEADA (clave rechazada)' : p.sesion.tieneSesion ? `guardada ${p.sesion.guardadaEn}` : 'sin sesión';
      return `${p.rut}  ${p.alias} (${p.tipo})${p.razonSocial ? ` — ${p.razonSocial}` : ''} · sesión: ${sesion}`;
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

/** Los meses con errores que se resuelven esperando, o `null` si no hay ninguno. */
export function textoReintentables(r: ResultadoSync): string | null {
  const items = r.periodos.flatMap((p) => p.errores.filter((e) => reintentoDe(e.codigo) === 'mas_tarde').map((e) => `${p.periodo} (${e.superficie} ${e.codigo})`));
  return items.length === 0 ? null : `Reintentables más tarde: ${items.join(', ')}`;
}

export function textoSync(r: ResultadoSync): string {
  const lineas = r.periodos.map((p) => {
    const partes = [
      ...(r.superficies.includes('rcv') ? [`${p.documentos} documentos RCV`] : []),
      ...(r.superficies.includes('f29') ? [`F29 ${p.f29Folio ? `folio ${p.f29Folio}` : 'sin folio informado'}`] : []),
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

export function textoHistorialF29(filas: readonly FilaHistorialF29[]): string {
  return filas
    .map((f) =>
      f.presentado
        ? `${f.periodo}: folio ${f.folio} (${f.estado}) · débitos ${monto(f.debitos)} · créditos ${monto(f.creditos)} · a pagar ${monto(f.totalAPagar)}`
        : `${f.periodo}: ${f.sincronizado ? 'no presentado' : 'sin sincronizar'}`,
    )
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
