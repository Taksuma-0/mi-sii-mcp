import { ErrorMiSiiMcp } from '../domain/errores.js';
import { aCsv, nombreTipoDocumento, type CeldaCsv } from '../domain/formato.js';
import { parsePeriodo, periodoSiguiente, rangoPeriodos, type Periodo } from '../domain/periodo.js';
import { sumarDias } from '../domain/fechas.js';
import { signoTipoDoc } from '../reconciliation/mapeo-f29.js';
import { perfilExistente } from './consultas.js';
import type { DepsApp } from './deps.js';
import { SOLO_RESUMEN_VENTA } from './sincronizar.js';

export type TipoLibro = 'compras' | 'ventas' | 'honorarios_recibidos' | 'honorarios_emitidos' | 'banco';

/** Un libro como tabla: columnas, filas (fechas `AAAA-MM-DD`, montos con su signo) y totales. */
export interface Libro {
  readonly rut: string;
  readonly tipo: TipoLibro;
  readonly desde: string;
  readonly hasta: string;
  readonly columnas: readonly string[];
  readonly filas: readonly (readonly CeldaCsv[])[];
  readonly totales: Readonly<Record<string, number>>;
}

const COLUMNAS: Readonly<Record<TipoLibro, readonly string[]>> = {
  compras: ['Fecha', 'Período', 'Tipo', 'Folio', 'RUT', 'Razón social', 'Exento', 'Neto', 'IVA', 'IVA no recuperable', 'IVA uso común', 'Total', 'Estado', 'Tipo de compra'],
  ventas: ['Fecha', 'Período', 'Tipo', 'Folio', 'RUT', 'Razón social', 'Exento', 'Neto', 'IVA', 'Total', 'Estado'],
  honorarios_recibidos: ['Fecha', 'Período', 'Folio', 'RUT emisor', 'Nombre', 'Bruto', 'Retención', 'Líquido', 'Estado'],
  honorarios_emitidos: ['Fecha', 'Período', 'Folio', 'RUT receptor', 'Nombre', 'Bruto', 'Retención', 'Líquido', 'Estado'],
  banco: ['Fecha', 'Cuenta', 'Descripción', 'Documento', 'Cargo', 'Abono', 'Saldo', 'Conciliado'],
};

const sumar = (filas: readonly (readonly CeldaCsv[])[], columna: number): number => filas.reduce((s, f) => s + (typeof f[columna] === 'number' ? (f[columna] as number) : 0), 0);
/** Orden por fecha (columna 0) y luego por folio (en la columna indicada). */
const porFechaYFolio =
  (folio: number) =>
  (a: readonly CeldaCsv[], b: readonly CeldaCsv[]): number =>
    String(a[0] ?? '').localeCompare(String(b[0] ?? '')) || Number(a[folio] ?? 0) - Number(b[folio] ?? 0);

function documentosRcv(deps: DepsApp, rut: string, periodos: readonly Periodo[], lado: 'COMPRA' | 'VENTA'): CeldaCsv[][] {
  return periodos.flatMap((p) =>
    deps.store.documentosRcv(rut, p.texto, { lado, estado: 'REGISTRO' }).map((d): CeldaCsv[] => {
      const s = signoTipoDoc(d.tipoDoc);
      const base: CeldaCsv[] = [d.fechaEmision?.slice(0, 10) ?? null, d.periodo, nombreTipoDocumento(d.tipoDoc), d.folio, d.rutContraparte, d.razonSocial, s * d.montoExento, s * d.montoNeto, s * d.montoIva];
      return lado === 'COMPRA' ? [...base, s * d.montoIvaNoRecuperable, s * d.montoIvaUsoComun, s * d.montoTotal, d.estado, d.tipoCompra] : [...base, s * d.montoTotal, d.estado];
    }),
  );
}

/** Boletas y comprobantes de venta: el RCV los entrega solo como resumen del mes, una fila por tipo. */
function resumenesBoletas(deps: DepsApp, rut: string, periodos: readonly Periodo[]): CeldaCsv[][] {
  return periodos.flatMap((p) =>
    deps.store
      .resumenesRcv(rut, p.texto)
      .filter((r) => r.lado === 'VENTA' && r.estado === 'REGISTRO')
      .flatMap((r) => r.filas.filter((f) => SOLO_RESUMEN_VENTA.has(f.tipoDoc) && f.cantidad > 0))
      .map((f): CeldaCsv[] => [null, p.texto, `${nombreTipoDocumento(f.tipoDoc)} (resumen de ${f.cantidad})`, null, null, null, f.exento, f.neto, f.iva, f.total, 'REGISTRO']),
  );
}

/**
 * Libro de un rango de meses (`AAAA-MM`) con lo guardado: compras o ventas del RCV (registradas; las notas de crédito
 * restan), boletas de honorarios recibidas o emitidas, o los movimientos de las cartolas con su conciliación.
 */
export function libro(deps: DepsApp, rutTexto: string, tipo: TipoLibro, desde: string, hasta: string): Libro {
  const perfil = perfilExistente(deps, rutTexto);
  const periodos = rangoPeriodos(parsePeriodo(desde), parsePeriodo(hasta), 240);
  const rut = perfil.rut;
  let filas: CeldaCsv[][];
  let totales: Record<string, number>;
  if (tipo === 'compras' || tipo === 'ventas') {
    const lado = tipo === 'compras' ? 'COMPRA' : 'VENTA';
    const documentos = documentosRcv(deps, rut, periodos, lado);
    filas = [...documentos.sort(porFechaYFolio(3)), ...(tipo === 'ventas' ? resumenesBoletas(deps, rut, periodos) : [])];
    const total = tipo === 'compras' ? 11 : 9;
    totales = { documentos: documentos.length, exento: sumar(filas, 6), neto: sumar(filas, 7), iva: sumar(filas, 8), total: sumar(filas, total) };
  } else if (tipo === 'honorarios_recibidos' || tipo === 'honorarios_emitidos') {
    filas = periodos
      .flatMap((p) =>
        tipo === 'honorarios_recibidos'
          ? deps.store.boletasHonorarios(rut, p.texto).map((b): CeldaCsv[] => [b.fecha, b.periodo, b.folio, b.rutEmisor, b.nombreEmisor, b.bruto, b.retencion, b.liquido, b.anulada ? 'Anulada' : 'Vigente'])
          : deps.store.boletasEmitidas(rut, p.texto).map((b): CeldaCsv[] => [b.fecha, b.periodo, b.folio, b.rutReceptor, b.nombreReceptor, b.bruto, b.retencionEmisor + b.retencionReceptor, b.liquido, b.anulada ? 'Anulada' : 'Vigente']),
      )
      .sort(porFechaYFolio(2));
    const vigentes = filas.filter((f) => f[8] === 'Vigente');
    totales = { boletas: vigentes.length, bruto: sumar(vigentes, 5), retencion: sumar(vigentes, 6), liquido: sumar(vigentes, 7) };
  } else {
    if (deps.store.cuentasBanco(rut).length === 0) throw new ErrorMiSiiMcp('SIN_DATOS_LOCALES', `No hay cartolas importadas de ${rut}: importa una con banco_importar.`);
    const primerDia = `${periodos[0]!.texto}-01`;
    const ultimoDia = sumarDias(`${periodoSiguiente(periodos.at(-1)!).texto}-01`, -1);
    const conciliacion = new Map(deps.store.conciliaciones(rut, primerDia, ultimoDia).map((c) => [c.huella, c.clave === null ? 'descartado' : 'sí']));
    filas = deps.store
      .movimientosBanco(rut, { desde: primerDia, hasta: ultimoDia })
      .map((m): CeldaCsv[] => [m.fecha, m.cuenta, m.descripcion, m.documento, m.monto < 0 ? -m.monto : null, m.monto > 0 ? m.monto : null, m.saldo, conciliacion.get(m.huella) ?? 'no']);
    totales = { movimientos: filas.length, cargos: sumar(filas, 4), abonos: sumar(filas, 5) };
  }
  return { rut, tipo, desde: periodos[0]!.texto, hasta: periodos.at(-1)!.texto, columnas: COLUMNAS[tipo], filas, totales };
}

/** Exporta el libro a un CSV para Excel en la carpeta de exportaciones y devuelve su ruta. */
export async function exportarLibro(deps: DepsApp, l: Libro): Promise<string> {
  return deps.archivos.exportar(`libro-${l.tipo.replace('_', '-')}-${l.rut}-${l.desde}-${l.hasta}.csv`, aCsv(l.columnas, l.filas));
}
