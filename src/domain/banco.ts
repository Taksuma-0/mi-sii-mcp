/**
 * Movimiento de una cartola bancaria importada por la persona: abono (+) o cargo (−). De la cuenta solo se guarda el alias
 * que eligió la persona (p. ej. «corriente»), nunca su número.
 */
export interface MovimientoBancario {
  readonly rut: string;
  readonly cuenta: string;
  /** `AAAA-MM-DD`. */
  readonly fecha: string;
  readonly descripcion: string;
  /** N° de documento u operación, si la cartola lo trae. */
  readonly documento: string | null;
  /** Abono positivo, cargo negativo. */
  readonly monto: number;
  readonly saldo: number | null;
  /** Identifica el movimiento aunque se vuelva a importar en otra cartola que se solapa. */
  readonly huella: string;
}

/** Un movimiento tal como sale de leer la cartola, antes de saber de qué RUT y cuenta es. */
export type MovimientoLeido = Omit<MovimientoBancario, 'rut' | 'cuenta'>;

/** Nombres (o números desde 1) de las columnas de la cartola, cuando no se detectan solas. */
export interface MapeoColumnas {
  readonly fecha?: string;
  readonly descripcion?: string;
  readonly cargo?: string;
  readonly abono?: string;
  readonly monto?: string;
  readonly saldo?: string;
  readonly documento?: string;
}

export type ColumnaCartola = keyof MapeoColumnas;

/** Resultado de leer una cartola: sus movimientos, qué columna se usó para cada dato y cuántas filas no eran movimientos. */
export interface CartolaLeida {
  readonly movimientos: readonly MovimientoLeido[];
  readonly columnas: Readonly<Record<ColumnaCartola, string | null>>;
  /** Filas sin fecha o sin monto (preámbulo, totales, saldos iniciales). */
  readonly descartadas: number;
  readonly avisos: readonly string[];
}

/** Lo que se guarda de un archivo importado: su nombre (sin carpeta), su huella y cuántas filas trajo. */
export interface ArchivoImportado {
  readonly archivo: string;
  readonly sha256: string;
  readonly filas: number;
}

/** Con qué se concilia un movimiento: una venta, una compra, una boleta de honorarios, un F29 o una devolución del F22. */
export type TipoPartida = 'venta' | 'compra' | 'bhe_recibida' | 'bhe_emitida' | 'f29' | 'f22';

/** `monto_rut`: mismo monto y el RUT de la contraparte en la glosa; `monto_fecha`: mismo monto y la fecha más cercana. */
export type CriterioConciliacion = 'monto_rut' | 'monto_fecha' | 'manual';

/** Un movimiento y la partida con que se concilia. Una fila manual con `tipo` y `clave` null es un movimiento descartado. */
export interface ParConciliado {
  readonly huella: string;
  readonly tipo: TipoPartida | null;
  readonly clave: string | null;
  readonly criterio: CriterioConciliacion;
  /** Días entre la partida y el movimiento; null en los manuales. */
  readonly dias: number | null;
}

export interface ConciliacionGuardada extends ParConciliado {
  readonly creadoEn: string;
}
