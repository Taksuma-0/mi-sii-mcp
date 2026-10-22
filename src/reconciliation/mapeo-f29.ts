import type { F29Valores, Lado, RcvResumen } from '../domain/tipos.js';

export const VERSION_REGLAS = 'iva-2026.10.1';

export const CODIGO_F29 = {
  TOTAL_DEBITOS: '538',
  TOTAL_CREDITOS: '537',
  REMANENTE_MES_ANTERIOR: '504',
  REMANENTE_PERIODO_SIGUIENTE: '77',
  TOTAL_A_PAGAR: '91',
} as const;

/** Códigos que suman en el 538 pero no vienen del RCV. Se calibra con un F29 real (Tarea 23). */
export const CODIGOS_DEBITO_FUERA_RCV: readonly string[] = [];

/** Códigos que suman en el 537 pero no vienen del RCV. El remanente del mes anterior nunca viene del RCV. */
export const CODIGOS_CREDITO_FUERA_RCV: readonly string[] = [CODIGO_F29.REMANENTE_MES_ANTERIOR];

/** Notas de crédito (60, 61 y 112 de exportación) restan; todo lo demás suma. */
const SIGNO_TIPO_DOC: Readonly<Record<number, 1 | -1>> = { 60: -1, 61: -1, 112: -1 };
export const signoTipoDoc = (tipoDoc: number): 1 | -1 => SIGNO_TIPO_DOC[tipoDoc] ?? 1;

const ivaRegistrado = (resumenes: readonly RcvResumen[], lado: Lado): number =>
  resumenes
    .filter((r) => r.lado === lado && r.estado === 'REGISTRO')
    .flatMap((r) => r.filas)
    .reduce((suma, f) => suma + signoTipoDoc(f.tipoDoc) * f.iva, 0);

/** IVA débito según las ventas registradas en el RCV. */
export const debitoRcv = (resumenes: readonly RcvResumen[]): number => ivaRegistrado(resumenes, 'VENTA');

/** IVA crédito según las compras registradas en el RCV (los pendientes aún no dan derecho a crédito). */
export const creditoRcv = (resumenes: readonly RcvResumen[]): number => ivaRegistrado(resumenes, 'COMPRA');

export const valorF29 = (v: F29Valores | null, codigo: string): number | null =>
  v !== null && codigo in v.valores ? (v.valores[codigo] ?? null) : null;

function totalMenos(v: F29Valores | null, total: string, fuera: readonly string[]): number | null {
  const base = valorF29(v, total);
  if (base === null) return null;
  return fuera.reduce((resto, codigo) => resto - (valorF29(v, codigo) ?? 0), base);
}

/** Débito del F29 comparable con el RCV: 538 menos los débitos que no vienen del RCV. */
export const debitoF29 = (v: F29Valores | null): number | null => totalMenos(v, CODIGO_F29.TOTAL_DEBITOS, CODIGOS_DEBITO_FUERA_RCV);

/** Crédito del F29 comparable con el RCV: 537 menos el remanente y otros créditos que no vienen del RCV. */
export const creditoDocumentosF29 = (v: F29Valores | null): number | null => totalMenos(v, CODIGO_F29.TOTAL_CREDITOS, CODIGOS_CREDITO_FUERA_RCV);
