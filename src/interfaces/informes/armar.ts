import { plazos, resumenIva } from '../../app/consultas.js';
import type { DepsApp } from '../../app/deps.js';
import { resumenRenta } from '../../app/renta.js';
import { carteraEstado } from '../../app/vigilancia.js';
import { ErrorMiSiiMcp } from '../../domain/errores.js';
import { fechaEnSantiago } from '../../domain/fechas.js';
import { parseRut } from '../../domain/rut.js';
import { informeCartera, informeIva, informeRenta, informeVencimientos } from './contenido.js';
import type { ContenidoInforme } from './plantilla.js';

export type TipoInforme = 'iva' | 'renta' | 'cartera' | 'vencimientos';

export interface PedidoInforme {
  readonly tipo: TipoInforme;
  readonly rut?: string | undefined;
  readonly periodo?: string | undefined;
  readonly anio?: string | undefined;
}

/** El contenido y el nombre del archivo, o por qué no hay informe que armar (sin datos guardados). */
export type InformeArmado = { readonly nombre: string; readonly contenido: ContenidoInforme } | { readonly sinDatos: string };

/** Días hacia adelante que cubre el informe de vencimientos. */
const DIAS_VENCIMIENTOS = 60;

const horaEnSantiago = (instante: Date): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instante);

function exigir(valor: string | undefined, mensaje: string): string {
  if (!valor) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', mensaje);
  return valor;
}

/** Arma el informe pedido solo con lo guardado: nunca va al SII. */
export function armarInforme(deps: DepsApp, p: PedidoInforme): InformeArmado {
  const ahora = deps.reloj.ahora();
  const hoy = fechaEnSantiago(ahora);
  const generado = `${hoy} ${horaEnSantiago(ahora)}`;
  switch (p.tipo) {
    case 'iva': {
      const mensaje = 'Para el informe de IVA indica rut y periodo (AAAA-MM).';
      const r = resumenIva(deps, exigir(p.rut, mensaje), exigir(p.periodo, mensaje));
      const d = r.disponibilidad;
      if (!d.ventasRcv && !d.comprasRcv && !d.f29) return { sinDatos: `No hay datos guardados de ${r.rut} para el IVA de ${r.periodo}: sincroniza primero con sincronizar.` };
      return { nombre: `iva-${r.rut}-${r.periodo}`, contenido: informeIva(r, generado) };
    }
    case 'renta': {
      const r = resumenRenta(deps, exigir(p.rut, 'Para el informe de renta indica el rut.'), p.anio);
      if (r.anios.length === 0) return { sinDatos: `No hay datos guardados de ${r.rut} para la renta: sincroniza primero con renta_sincronizar.` };
      return { nombre: `renta-${r.rut}${p.anio ? `-AT${p.anio}` : ''}`, contenido: informeRenta(r, generado) };
    }
    case 'cartera': {
      const filas = carteraEstado(deps);
      if (filas.length === 0) return { sinDatos: 'No hay cuentas guardadas: conecta una con cuenta_conectar.' };
      return { nombre: `cartera-${hoy}`, contenido: informeCartera(filas, generado) };
    }
    case 'vencimientos': {
      const rut = exigir(p.rut, 'Para el informe de vencimientos indica el rut.');
      const lista = plazos(deps, rut, DIAS_VENCIMIENTOS);
      return { nombre: `vencimientos-${parseRut(rut).canonico}-${hoy}`, contenido: informeVencimientos(lista, generado) };
    }
  }
}
