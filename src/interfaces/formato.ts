import type { FilaHistorialF29, PaginaDocumentos, ResumenIva } from '../app/consultas.js';
import type { PerfilConSesion } from '../app/perfiles.js';
import type { ResultadoSync } from '../app/sincronizar.js';
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
  return [
    `IVA ${r.periodo} — ${r.rut}`,
    `Débito  (ventas RCV):  ${formatearClp(c.debitoRcv)} · F29: ${monto(c.debitoF29)}`,
    `Crédito (compras RCV): ${formatearClp(c.creditoRcv)} · F29: ${monto(c.creditoF29)}`,
    `Remanente: mes anterior (77) ${monto(c.remanenteAnterior77)} → este mes (504) ${monto(c.remanenteActual504)}`,
    r.f29
      ? `F29: folio ${r.f29.folio} (${r.f29.estado}), presentado ${r.f29.fechaPresentacion ?? 'sin fecha'}, total a pagar ${monto(r.f29.totalAPagar)}`
      : `F29: no presentado — vence ${r.venceF29}`,
    `Compras pendientes de aceptar o reclamar: ${r.compras.pendientes} · reclamadas: ${r.compras.reclamados}`,
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

export function textoSync(r: ResultadoSync): string {
  const lineas = r.periodos.map((p) => {
    let linea = `${p.periodo}: ${p.documentos} documentos RCV · F29 ${p.f29Folio ? `folio ${p.f29Folio}` : 'sin folio informado'}`;
    if (p.errores.length > 0) linea += ` · errores: ${p.errores.map((e) => `${e.superficie} ${e.codigo}`).join(', ')}`;
    if (p.avisos.length > 0) linea += `\n    avisos: ${p.avisos.join(' | ')}`;
    return linea;
  });
  if (r.abortado) lineas.push(`Sincronización detenida: [${r.abortado.codigo}] ${r.abortado.mensaje}`);
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
