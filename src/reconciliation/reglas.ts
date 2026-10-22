import { formatearClp } from '../domain/formato.js';
import { periodoAnterior, type Periodo } from '../domain/periodo.js';
import type { DocumentoRcv, F29Declaracion, F29Valores, Hallazgo, RcvResumen, SnapshotRcv, TipoContribuyente } from '../domain/tipos.js';
import { CODIGO_F29, creditoDocumentosF29, creditoRcv, debitoF29, debitoRcv, valorF29 } from './mapeo-f29.js';

export interface EntradaConciliacion {
  readonly rut: string;
  readonly tipo: TipoContribuyente;
  readonly periodo: Periodo;
  /** Fecha civil de hoy en Santiago (`AAAA-MM-DD`). */
  readonly hoy: string;
  readonly resumenes: readonly RcvResumen[];
  readonly documentos: readonly DocumentoRcv[];
  readonly declaraciones: readonly F29Declaracion[];
  /** Valores del F29 vigente del período, si existe. */
  readonly valores: F29Valores | null;
  /** Valores del F29 vigente del período anterior, si existe. */
  readonly valoresAnterior: F29Valores | null;
  readonly snapshots: readonly SnapshotRcv[];
  readonly toleranciaPesos: number;
}

type DatosHallazgo = Omit<Hallazgo, 'rut' | 'periodo'>;

const hallazgo = (e: EntradaConciliacion, datos: DatosHallazgo): Hallazgo => ({ rut: e.rut, periodo: e.periodo.texto, ...datos });

function comparar(e: EntradaConciliacion, regla: string, titulo: string, esperado: number, declarado: number, detalle: string, evidencia: string[]): Hallazgo[] {
  const diferencia = esperado - declarado;
  if (Math.abs(diferencia) <= e.toleranciaPesos) return [];
  return [hallazgo(e, { regla, severidad: 'critico', naturaleza: 'DERIVADO', titulo, detalle, montos: { esperado, declarado, diferencia }, evidencia })];
}

/** IVA-01: el débito de las ventas del RCV debe coincidir con el débito declarado en el F29. */
export function reglaDebito(e: EntradaConciliacion): Hallazgo[] {
  if (!e.valores) return [];
  const declarado = debitoF29(e.valores);
  if (declarado === null) {
    return [
      hallazgo(e, {
        regla: 'IVA-01',
        severidad: 'advertencia',
        naturaleza: 'HECHO',
        titulo: 'F29 sin total de débitos legible',
        detalle: `No se encontró el código ${CODIGO_F29.TOTAL_DEBITOS} en el F29 folio ${e.valores.folio}.`,
        montos: null,
        evidencia: [`F29:${e.valores.folio}`],
      }),
    ];
  }
  const esperado = debitoRcv(e.resumenes);
  return comparar(
    e,
    'IVA-01',
    'El débito del RCV no coincide con el F29',
    esperado,
    declarado,
    `Débito según ventas del RCV: ${formatearClp(esperado)}. Débito del F29 (código ${CODIGO_F29.TOTAL_DEBITOS}): ${formatearClp(declarado)}. El 538 puede incluir débitos que no vienen del RCV.`,
    [`F29:${e.valores.folio}`, `RCV:VENTA:${e.periodo.texto}`],
  );
}

/** IVA-02: el crédito de las compras registradas debe coincidir con el crédito por documentos del F29. */
export function reglaCredito(e: EntradaConciliacion): Hallazgo[] {
  if (!e.valores) return [];
  const declarado = creditoDocumentosF29(e.valores);
  if (declarado === null) {
    return [
      hallazgo(e, {
        regla: 'IVA-02',
        severidad: 'advertencia',
        naturaleza: 'HECHO',
        titulo: 'F29 sin total de créditos legible',
        detalle: `No se encontró el código ${CODIGO_F29.TOTAL_CREDITOS} en el F29 folio ${e.valores.folio}.`,
        montos: null,
        evidencia: [`F29:${e.valores.folio}`],
      }),
    ];
  }
  const esperado = creditoRcv(e.resumenes);
  return comparar(
    e,
    'IVA-02',
    'El crédito del RCV no coincide con el F29',
    esperado,
    declarado,
    `Crédito según compras registradas en el RCV: ${formatearClp(esperado)}. Crédito por documentos del F29 (${CODIGO_F29.TOTAL_CREDITOS} menos ${CODIGO_F29.REMANENTE_MES_ANTERIOR}): ${formatearClp(declarado)}.`,
    [`F29:${e.valores.folio}`, `RCV:COMPRA:${e.periodo.texto}`],
  );
}

/** IVA-03: el remanente que deja un mes (77) debe ser el que entra al siguiente (504). */
export function reglaRemanente(e: EntradaConciliacion): Hallazgo[] {
  if (!e.valores || !e.valoresAnterior) return [];
  const esperado = valorF29(e.valoresAnterior, CODIGO_F29.REMANENTE_PERIODO_SIGUIENTE) ?? 0;
  const declarado = valorF29(e.valores, CODIGO_F29.REMANENTE_MES_ANTERIOR) ?? 0;
  return comparar(
    e,
    'IVA-03',
    'El remanente no calza con el mes anterior',
    esperado,
    declarado,
    `F29 de ${periodoAnterior(e.periodo).texto} (código ${CODIGO_F29.REMANENTE_PERIODO_SIGUIENTE}): ${formatearClp(esperado)}. F29 de ${e.periodo.texto} (código ${CODIGO_F29.REMANENTE_MES_ANTERIOR}): ${formatearClp(declarado)}.`,
    [`F29:${e.valoresAnterior.folio}`, `F29:${e.valores.folio}`],
  );
}
