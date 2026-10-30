import { createHash } from 'node:crypto';
import type { ColumnaCartola, MapeoColumnas, MovimientoLeido } from '../domain/banco.js';
import { ErrorMiSiiMcp } from '../domain/errores.js';
import { perfilExistente } from './consultas.js';
import type { DepsApp } from './deps.js';

/** Tamaño máximo de una cartola: un año de movimientos de una pyme cabe con holgura. */
export const MAX_BYTES_CARTOLA = 5 * 1024 * 1024;
/** Alias de la cuenta cuando la persona no indica uno. */
export const CUENTA_POR_DEFECTO = 'principal';
const ALIAS_CUENTA = /^[\p{L}\p{N} _-]{1,40}$/u;

export interface ResultadoImportacion {
  readonly rut: string;
  readonly cuenta: string;
  /** Nombre del archivo, sin carpeta. */
  readonly archivo: string;
  readonly leidos: number;
  readonly nuevos: number;
  readonly repetidos: number;
  /** Filas que no eran movimientos: preámbulo, saldo inicial, totales. */
  readonly descartadas: number;
  readonly desde: string | null;
  readonly hasta: string | null;
  /** Qué columna de la cartola se usó para cada dato. */
  readonly columnas: Readonly<Record<ColumnaCartola, string | null>>;
  /** Si el saldo de cada fila sigue al anterior más su monto; null si la cartola no trae saldos. */
  readonly saldoCuadra: boolean | null;
  readonly avisos: readonly string[];
}

/**
 * Revisa que el saldo de cada movimiento sea el anterior más su monto, en el orden de la cartola o, si viene de la más
 * nueva a la más antigua, al revés. Devuelve los tramos en que se corta (faltan movimientos).
 */
function cortesDeSaldo(movimientos: readonly MovimientoLeido[]): { readonly cuadra: boolean | null; readonly cortes: readonly [string, string][] } {
  const conSaldo = movimientos.filter((m) => m.saldo !== null);
  if (conSaldo.length < 2) return { cuadra: null, cortes: [] };
  const ordenados = conSaldo[0]!.fecha > conSaldo.at(-1)!.fecha ? [...conSaldo].reverse() : conSaldo;
  const cortes: [string, string][] = [];
  for (let i = 1; i < ordenados.length; i++) {
    const anterior = ordenados[i - 1]!;
    const actual = ordenados[i]!;
    if (Math.abs(anterior.saldo! + actual.monto - actual.saldo!) > 1) cortes.push([anterior.fecha, actual.fecha]);
  }
  return { cuadra: cortes.length === 0, cortes };
}

/**
 * Importa una cartola bancaria (CSV o TXT) que indica la persona: la lee, guarda sus movimientos en la cuenta indicada sin
 * repetir los que ya estaban y revisa que el saldo no se corte. Solo escribe en la base local.
 */
export async function importarCartola(deps: DepsApp, rutTexto: string, ruta: string, opciones: { readonly cuenta?: string; readonly columnas?: MapeoColumnas } = {}): Promise<ResultadoImportacion> {
  const perfil = perfilExistente(deps, rutTexto);
  const cuenta = (opciones.cuenta ?? CUENTA_POR_DEFECTO).trim();
  if (!ALIAS_CUENTA.test(cuenta)) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'El alias de la cuenta debe tener entre 1 y 40 letras, números, espacios, guiones o guiones bajos.');
  const { nombre, bytes } = await deps.archivos.leer(ruta, MAX_BYTES_CARTOLA);
  const leida = deps.lectorCartola.leer(bytes, opciones.columnas);
  // La huella del lector no conoce la cuenta: con ella, la misma cartola en dos cuentas son movimientos distintos.
  const movimientos = leida.movimientos.map((m) => ({ ...m, huella: createHash('sha256').update(`${cuenta}|${m.huella}`).digest('hex') }));
  const { nuevos, repetidos } = deps.store.guardarImportacionBanco(
    perfil.rut,
    cuenta,
    { archivo: nombre, sha256: createHash('sha256').update(bytes).digest('hex'), filas: movimientos.length },
    movimientos,
    deps.reloj.ahora().toISOString(),
  );
  const fechas = movimientos.map((m) => m.fecha).sort();
  const saldo = cortesDeSaldo(movimientos);
  return {
    rut: perfil.rut,
    cuenta,
    archivo: nombre,
    leidos: movimientos.length,
    nuevos,
    repetidos,
    descartadas: leida.descartadas,
    desde: fechas[0] ?? null,
    hasta: fechas.at(-1) ?? null,
    columnas: leida.columnas,
    saldoCuadra: saldo.cuadra,
    avisos: [...leida.avisos, ...saldo.cortes.map(([desde, hasta]) => `El saldo no cuadra entre el ${desde} y el ${hasta}: faltan movimientos en la cartola.`)],
  };
}
