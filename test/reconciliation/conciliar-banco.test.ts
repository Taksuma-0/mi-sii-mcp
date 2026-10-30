import { describe, expect, it } from 'vitest';
import type { MovimientoBancario, ParConciliado } from '../../src/domain/banco.js';
import { conciliarBanco, type Partida } from '../../src/reconciliation/conciliar-banco.js';
import { RUT_EMPRESA } from '../helpers/fabricas.js';

const mov = (huella: string, fecha: string, monto: number, descripcion = 'MOVIMIENTO'): MovimientoBancario => ({ rut: RUT_EMPRESA, cuenta: 'principal', fecha, descripcion, documento: null, monto, saldo: null, huella });
const partida = (clave: string, fecha: string, monto: number, o: Partial<Partida> = {}): Partida => ({ tipo: 'venta', clave, rutContraparte: null, nombre: null, fecha, monto, ...o });
const pares = (r: ReturnType<typeof conciliarBanco>) => r.pares.map((p) => [p.huella, p.clave, p.criterio, p.dias]);

describe('conciliarBanco', () => {
  it('empareja por monto exacto y fecha cercana', () => {
    const r = conciliarBanco([mov('m1', '2026-10-15', 1_190_000)], [partida('V1', '2026-10-01', 1_190_000)], []);
    expect(pares(r)).toEqual([['m1', 'V1', 'monto_fecha', 14]]);
    expect(r.pares[0]!.tipo).toBe('venta');
    expect(r.movimientosSinPar).toEqual([]);
    expect(r.partidasSinPar).toEqual([]);
  });

  it('prefiere el movimiento cuya glosa trae el RUT de la contraparte, aunque esté más lejos', () => {
    const r = conciliarBanco(
      [mov('cerca', '2026-10-02', 500_000, 'TRANSFERENCIA'), mov('con-rut', '2026-10-20', 500_000, 'TRANSF DE 76.123.456-7 CLIENTE')],
      [partida('V1', '2026-10-01', 500_000, { rutContraparte: '76123456-7' }), partida('V2', '2026-10-01', 500_000)],
      [],
    );
    expect(pares(r)).toEqual([['con-rut', 'V1', 'monto_rut', 19], ['cerca', 'V2', 'monto_fecha', 1]]);
  });

  it('dos facturas del mismo monto y fechas cercanas se emparejan igual sin importar el orden de entrada', () => {
    const movs = [mov('m1', '2026-10-02', 100_000), mov('m2', '2026-10-04', 100_000)];
    const partidas = [partida('A', '2026-10-01', 100_000), partida('B', '2026-10-03', 100_000)];
    const r = conciliarBanco(movs, partidas, []);
    expect(pares(r)).toEqual([['m1', 'A', 'monto_fecha', 1], ['m2', 'B', 'monto_fecha', 1]]);
    expect(pares(conciliarBanco([...movs].reverse(), [...partidas].reverse(), []))).toEqual(pares(r));
  });

  it('respeta lo fijado a mano y no lista como pendiente un movimiento descartado', () => {
    const fijados: ParConciliado[] = [
      { huella: 'm1', tipo: 'venta', clave: 'B', criterio: 'manual', dias: null },
      { huella: 'm2', tipo: null, clave: null, criterio: 'manual', dias: null },
    ];
    const r = conciliarBanco([mov('m1', '2026-10-02', 100_000), mov('m2', '2026-10-04', 100_000)], [partida('A', '2026-10-01', 100_000), partida('B', '2026-10-03', 100_000)], fijados);
    expect(r.pares).toEqual([]);
    expect(r.movimientosSinPar).toEqual([]);
    expect(r.partidasSinPar).toEqual(['A']);
  });

  it('no empareja fuera de la ventana: 5 días antes y 120 después; el F29 entre 3 antes y 10 después', () => {
    const r = conciliarBanco(
      [mov('antes', '2026-09-25', 1_000), mov('f29-tarde', '2026-11-25', -50_000), mov('f29-justo', '2026-10-25', -60_000)],
      [partida('V', '2026-10-01', 1_000), partida('F29:2026-10', '2026-11-12', -50_000, { tipo: 'f29' }), partida('F29:2026-09', '2026-10-15', -60_000, { tipo: 'f29' })],
      [],
    );
    expect(pares(r)).toEqual([['f29-justo', 'F29:2026-09', 'monto_fecha', 10]]);
    expect(r.partidasSinPar).toEqual(['V', 'F29:2026-10']);
    expect(r.movimientosSinPar).toEqual(['antes', 'f29-tarde']);
  });

  it('el signo cuenta: una nota de crédito de compra es un abono y no calza con un cargo', () => {
    const r = conciliarBanco([mov('cargo', '2026-10-02', -20_000), mov('abono', '2026-10-03', 20_000)], [partida('NC', '2026-10-01', 20_000, { tipo: 'compra' })], []);
    expect(pares(r)).toEqual([['abono', 'NC', 'monto_fecha', 2]]);
  });
});
