import { createHash } from 'node:crypto';
import type { CartolaLeida, ColumnaCartola, MapeoColumnas, MovimientoLeido } from '../../domain/banco.js';
import { ErrorMiSiiMcp } from '../../domain/errores.js';
import { numeroChileno } from '../sii/campos.js';

/** Líneas del comienzo en que se busca la cabecera: las cartolas traen antes el titular, la cuenta y el período. */
const LINEAS_PREAMBULO = 30;
const SEPARADORES = [';', ',', '\t'] as const;
/** El documento va al final: «operación» aparece también en cabeceras de montos y glosas. */
const COLUMNAS: readonly ColumnaCartola[] = ['fecha', 'saldo', 'cargo', 'abono', 'monto', 'descripcion', 'documento'];

/** Cómo se reconoce cada columna por su cabecera (sin tildes, en minúsculas); el orden de `COLUMNAS` resuelve los empates. */
const NOMBRES: Readonly<Record<ColumnaCartola, RegExp>> = {
  fecha: /fecha/,
  saldo: /saldo/,
  documento: /documento|operacion|\bnro\b|\bnumero\b|^n\s|\bfolio\b/,
  cargo: /cargo|debito|\bgiro|egreso|retiro/,
  abono: /abono|credito|deposito|ingreso/,
  monto: /monto|importe|valor/,
  descripcion: /descripcion|glosa|detalle|concepto|movimiento|referencia/,
};

const normalizar = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[°º]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** UTF-8 (con o sin BOM) y, si no es UTF-8 válido, Windows-1252: la codificación de muchas cartolas de bancos chilenos. */
function decodificar(bytes: Uint8Array): string {
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    texto = new TextDecoder('windows-1252').decode(bytes);
  }
  return texto.replace(/^﻿/, '');
}

/** Campos de una línea CSV con su separador; respeta las comillas dobles y las comillas repetidas dentro de ellas. */
function campos(linea: string, separador: string): string[] {
  const out: string[] = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]!;
    if (entreComillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else if (c === '"') entreComillas = false;
      else actual += c;
    } else if (c === '"') entreComillas = true;
    else if (c === separador) {
      out.push(actual.trim());
      actual = '';
    } else actual += c;
  }
  out.push(actual.trim());
  return out;
}

/** `dd/mm/aaaa`, `dd-mm-aaaa`, `dd/mm/aa` o `aaaa-mm-dd` → `AAAA-MM-DD`; null si no es una fecha válida. */
function fecha(valor: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(valor);
  const chilena = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/.exec(valor);
  const [anio, mes, dia] = iso ? [iso[1]!, iso[2]!, iso[3]!] : chilena ? [chilena[3]!.length === 2 ? `20${chilena[3]}` : chilena[3]!, chilena[2]!, chilena[1]!] : [];
  if (anio === undefined || mes === undefined || dia === undefined) return null;
  const m = Number(mes);
  const d = Number(dia);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${anio}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Monto chileno con `$`, espacios o paréntesis (negativo); null si la celda está vacía o no es un monto. */
function monto(valor: string | undefined): number | null {
  if (valor === undefined) return null;
  const limpio = valor.replace(/\$|CLP|\s/gi, '');
  if (limpio === '' || limpio === '-') return null;
  const negativo = /^\(.*\)$/.test(limpio);
  const n = numeroChileno(negativo ? limpio.slice(1, -1) : limpio);
  return n === null ? null : negativo ? -n : n;
}

interface Cabecera {
  readonly fila: number;
  readonly separador: string;
  readonly nombres: readonly string[];
  readonly indice: Readonly<Record<ColumnaCartola, number | null>>;
}

/** Índice de cada columna: el mapeo indicado (nombre o número desde 1) o, si no, la primera cabecera libre que la nombra. */
function indices(nombres: readonly string[], mapeo: MapeoColumnas): Record<ColumnaCartola, number | null> {
  const normales = nombres.map(normalizar);
  const usados = new Set<number>();
  const out = {} as Record<ColumnaCartola, number | null>;
  for (const columna of COLUMNAS) {
    const pedido = mapeo[columna];
    let j = -1;
    if (pedido !== undefined) {
      const numero = /^\d+$/.test(pedido.trim()) ? Number(pedido) - 1 : -1;
      j = numero >= 0 && numero < nombres.length ? numero : normales.indexOf(normalizar(pedido));
    } else {
      j = normales.findIndex((n, i) => !usados.has(i) && NOMBRES[columna].test(n));
    }
    out[columna] = j >= 0 ? j : null;
    if (j >= 0) usados.add(j);
  }
  return out;
}

const esCabecera = (i: Record<ColumnaCartola, number | null>): boolean => i.fecha !== null && ((i.cargo !== null && i.abono !== null) || i.monto !== null);

function buscarCabecera(lineas: readonly string[], mapeo: MapeoColumnas): Cabecera | null {
  for (let fila = 0; fila < Math.min(lineas.length, LINEAS_PREAMBULO); fila++) {
    const linea = lineas[fila]!;
    // El separador de la cabecera es el que más aparece en ella.
    const separador = [...SEPARADORES].sort((a, b) => linea.split(b).length - linea.split(a).length)[0]!;
    const nombres = campos(linea, separador);
    if (nombres.length < 2) continue;
    const indice = indices(nombres, mapeo);
    if (esCabecera(indice)) return { fila, separador, nombres, indice };
  }
  return null;
}

/**
 * Lee una cartola bancaria en CSV o TXT de cualquier banco: busca la cabecera, reconoce las columnas por su nombre (o usa
 * `mapeo`) y devuelve un movimiento por fila con fecha y monto (abono − cargo, o el monto con signo). Las demás filas
 * (preámbulo, saldo inicial, totales) se cuentan como descartadas. Los errores nunca muestran el contenido del archivo.
 */
export function leerCartolaCsv(bytes: Uint8Array, mapeo: MapeoColumnas = {}): CartolaLeida {
  const lineas = decodificar(bytes).split(/\r?\n/);
  const cabecera = buscarCabecera(lineas, mapeo);
  if (!cabecera) {
    throw new ErrorMiSiiMcp('ARCHIVO_INVALIDO', `No se encontró la fila de cabecera de la cartola (con fecha y cargo y abono, o monto) en las primeras ${LINEAS_PREAMBULO} líneas.`);
  }
  const { indice } = cabecera;
  const celda = (fila: readonly string[], columna: ColumnaCartola): string | undefined => {
    const j = indice[columna];
    return j === null ? undefined : fila[j];
  };
  const movimientos: MovimientoLeido[] = [];
  const repeticiones = new Map<string, number>();
  let descartadas = 0;
  for (const linea of lineas.slice(cabecera.fila + 1)) {
    if (linea.trim() === '') continue;
    const fila = campos(linea, cabecera.separador);
    const dia = fecha(celda(fila, 'fecha') ?? '');
    const cargo = monto(celda(fila, 'cargo'));
    const abono = monto(celda(fila, 'abono'));
    const importe = indice.monto !== null && cargo === null && abono === null ? monto(celda(fila, 'monto')) : cargo === null && abono === null ? null : (abono ?? 0) - Math.abs(cargo ?? 0);
    if (dia === null || importe === null) {
      descartadas++;
      continue;
    }
    const descripcion = (celda(fila, 'descripcion') ?? '').replace(/\s+/g, ' ').trim();
    const documento = celda(fila, 'documento')?.trim() || null;
    // Dos movimientos idénticos (dos cargos iguales el mismo día) se distinguen por su orden de aparición.
    const base = [dia, importe, normalizar(descripcion), documento ?? ''].join('|');
    const ordinal = repeticiones.get(base) ?? 0;
    repeticiones.set(base, ordinal + 1);
    movimientos.push({
      fecha: dia,
      descripcion,
      documento,
      monto: importe,
      saldo: monto(celda(fila, 'saldo')),
      huella: createHash('sha256').update(`${base}|${ordinal}`).digest('hex'),
    });
  }
  if (movimientos.length === 0) throw new ErrorMiSiiMcp('ARCHIVO_INVALIDO', 'La cartola tiene cabecera pero está sin movimientos con fecha y monto.');
  const columnas = Object.fromEntries(COLUMNAS.map((c) => [c, indice[c] === null ? null : cabecera.nombres[indice[c]!]!])) as Record<ColumnaCartola, string | null>;
  return { movimientos, columnas, descartadas, avisos: [] };
}
