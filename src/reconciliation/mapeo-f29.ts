import type { F29Valores, Lado, RcvResumen } from '../domain/tipos.js';

export const VERSION_REGLAS = 'iva-2026.10.6';

export const CODIGO_F29 = {
  TOTAL_DEBITOS: '538',
  TOTAL_CREDITOS: '537',
  REMANENTE_MES_ANTERIOR: '504',
  REMANENTE_PERIODO_SIGUIENTE: '77',
  TOTAL_A_PAGAR: '91',
  IVA_DETERMINADO: '89',
  TOTAL_DETERMINADO: '547',
  RETENCION_HONORARIOS: '151',
} as const;

/** Códigos que suman en el 538 pero no vienen del RCV. Se calibra con un F29 real (Tarea 23). */
export const CODIGOS_DEBITO_FUERA_RCV: readonly string[] = [];

/** Códigos que suman en el 537 pero no vienen del RCV. El remanente del mes anterior nunca viene del RCV. */
export const CODIGOS_CREDITO_FUERA_RCV: readonly string[] = [CODIGO_F29.REMANENTE_MES_ANTERIOR];

/** Notas de crédito (60, 61 y 112 de exportación): restan; todo lo demás suma. Única fuente de la regla de signo. */
export const TIPOS_DOC_NEGATIVOS: readonly number[] = [60, 61, 112];
export const signoTipoDoc = (tipoDoc: number): 1 | -1 => (TIPOS_DOC_NEGATIVOS.includes(tipoDoc) ? -1 : 1);

const ivaRegistrado = (resumenes: readonly RcvResumen[], lado: Lado): number =>
  resumenes
    .filter((r) => r.lado === lado && r.estado === 'REGISTRO')
    .flatMap((r) => r.filas)
    .reduce((suma, f) => suma + signoTipoDoc(f.tipoDoc) * f.iva, 0);

/** IVA débito según las ventas registradas en el RCV. */
export const debitoRcv = (resumenes: readonly RcvResumen[]): number => ivaRegistrado(resumenes, 'VENTA');

/** IVA crédito según las compras registradas en el RCV (los pendientes aún no dan derecho a crédito). */
export const creditoRcv = (resumenes: readonly RcvResumen[]): number => ivaRegistrado(resumenes, 'COMPRA');

/**
 * El F29 se leyó si trae al menos un código; null o vacío es un F29 sin descargar o ilegible. No es un guardia de tipo:
 * un `F29Valores` con `valores` vacío no se leyó y tampoco es null.
 */
export const f29Leido = (v: F29Valores | null): boolean => v !== null && Object.keys(v.valores).length > 0;

export interface LineasDeTotal {
  /** Líneas que suman en el total. */
  readonly suman: readonly string[];
  /** Notas de crédito que lo rebajan. */
  readonly restan: readonly string[];
  /** Líneas informativas que no se suman, pero con valor implican un total positivo (511: crédito neto por documentos). */
  readonly informativas: readonly string[];
}

/**
 * Líneas que componen cada total, verificadas en F29 reales: 538 = 502 − 510 y 537 = 520 − 528 + 532 + 504. Un total
 * ausente vale 0 solo si las notas de crédito cubren lo que suma y no viene ninguna línea informativa; si no, el PDF se
 * leyó mal y el total queda sin dato.
 */
export const LINEAS_DE_TOTALES: Readonly<Record<string, LineasDeTotal>> = {
  [CODIGO_F29.TOTAL_DEBITOS]: { suman: ['502'], restan: ['510'], informativas: [] },
  [CODIGO_F29.TOTAL_CREDITOS]: { suman: ['520', '532', CODIGO_F29.REMANENTE_MES_ANTERIOR], restan: ['528'], informativas: ['511'] },
};

/**
 * Monto de un código del F29 leído: el PDF compacto omite las líneas en cero, así que una ausente vale 0. Null si el F29
 * no se leyó, o si falta un total cuyas líneas sí vinieron (lectura fallida: sin dato, no cero).
 */
export function montoF29(v: F29Valores | null, codigo: string): number | null {
  if (v === null || !f29Leido(v)) return null;
  const monto = v.valores[codigo];
  if (monto !== undefined) return monto;
  const lineas = LINEAS_DE_TOTALES[codigo];
  if (!lineas) return 0;
  const suma = (codigos: readonly string[]): number => codigos.reduce((total, c) => total + (v.valores[c] ?? 0), 0);
  const anulado = suma(lineas.restan) >= suma(lineas.suman) && lineas.informativas.every((c) => (v.valores[c] ?? 0) === 0);
  return anulado ? 0 : null;
}

function totalMenos(v: F29Valores | null, total: string, fuera: readonly string[]): number | null {
  const base = montoF29(v, total);
  if (base === null) return null;
  return fuera.reduce((resto, codigo) => resto - (montoF29(v, codigo) ?? 0), base);
}

/** Débito del F29 comparable con el RCV: 538 menos los débitos que no vienen del RCV. */
export const debitoF29 = (v: F29Valores | null): number | null => totalMenos(v, CODIGO_F29.TOTAL_DEBITOS, CODIGOS_DEBITO_FUERA_RCV);

/** Crédito del F29 comparable con el RCV: 537 menos el remanente y otros créditos que no vienen del RCV. */
export const creditoDocumentosF29 = (v: F29Valores | null): number | null => totalMenos(v, CODIGO_F29.TOTAL_CREDITOS, CODIGOS_CREDITO_FUERA_RCV);
