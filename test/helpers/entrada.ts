import { parsePeriodo } from '../../src/domain/periodo.js';
import type { EntradaConciliacion } from '../../src/reconciliation/reglas.js';
import { declaracion, fila, resumen, RUT_EMPRESA, valores } from './fabricas.js';

/** Mes cuadrado: débito RCV 190.000 = 538; crédito RCV 19.000 = 537 − 504; remanente anterior (77) 5.000 = 504. */
export function entrada(o: Partial<EntradaConciliacion> = {}): EntradaConciliacion {
  return {
    rut: RUT_EMPRESA,
    tipo: 'empresa',
    periodo: parsePeriodo('2026-09'),
    hoy: '2026-10-21',
    resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000, 2)] }), resumen({ lado: 'COMPRA', filas: [fila(33, 100_000, 19_000, 1)] })],
    documentos: [],
    declaraciones: [declaracion()],
    valores: valores({ '538': 190_000, '537': 24_000, '504': 5_000, '89': 166_000, '77': 0, '91': 166_000 }),
    valoresAnterior: valores({ '77': 5_000 }, { periodo: '2026-08', folio: 554_000 }),
    snapshots: [],
    toleranciaPesos: 0,
    ...o,
  };
}
