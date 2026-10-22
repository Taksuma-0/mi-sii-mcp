import { describe, expect, it } from 'vitest';
import { parsePeriodo } from '../../src/domain/periodo.js';
import type { SnapshotRcv } from '../../src/domain/tipos.js';
import { conciliarPeriodo } from '../../src/reconciliation/conciliar.js';
import { reglaCambiosPostF29, reglaF29Faltante, reglaIvaEspecial, reglaReclamo } from '../../src/reconciliation/reglas.js';
import { entrada } from '../helpers/entrada.js';
import { documento, fila, resumen } from '../helpers/fabricas.js';

const sinF29 = { declaraciones: [], valores: null } as const;
const snap = (sincronizacionId: number, obtenidoEn: string, filas: [string, string][]): SnapshotRcv => ({
  sincronizacionId,
  lado: 'COMPRA',
  obtenidoEn,
  filas: filas.map(([clave, sha]) => ({ clave, estado: 'REGISTRO', sha })),
});

describe('IVA-04 F29 faltante', () => {
  it('es crítico si ya venció', () => {
    const [h] = reglaF29Faltante(entrada(sinF29));
    expect(h).toMatchObject({ regla: 'IVA-04', severidad: 'critico', titulo: 'F29 no presentado y vencido' });
    expect(h!.detalle).toContain('2026-10-20');
  });

  it('es advertencia si aún está en plazo', () => {
    const [h] = reglaF29Faltante(entrada({ ...sinF29, hoy: '2026-10-15' }));
    expect(h).toMatchObject({ severidad: 'advertencia', titulo: 'F29 pendiente de presentar' });
    expect(h!.detalle).toContain('en 5 día(s)');
  });

  it('una empresa sin movimiento igual debe declarar', () => {
    expect(reglaF29Faltante(entrada({ ...sinF29, resumenes: [] }))[0]?.detalle).toContain('Aunque no haya movimiento');
  });

  it('una persona sin movimiento no tiene F29 pendiente; con movimiento sí', () => {
    expect(reglaF29Faltante(entrada({ ...sinF29, tipo: 'persona', resumenes: [] }))).toEqual([]);
    expect(reglaF29Faltante(entrada({ ...sinF29, tipo: 'persona' }))).toHaveLength(1);
  });

  it('no evalúa el período en curso', () => {
    expect(reglaF29Faltante(entrada({ ...sinF29, periodo: parsePeriodo('2026-10') }))).toEqual([]);
  });
});

describe('IVA-05 plazo de reclamo', () => {
  it('avisa las pendientes que vencen pronto o ya vencieron', () => {
    const documentos = [
      documento({ estado: 'PENDIENTE', folio: 1, fechaRecepcion: '2026-10-19 09:00:00' }),
      documento({ estado: 'PENDIENTE', folio: 2, fechaRecepcion: '2026-10-16 09:00:00' }),
      documento({ estado: 'PENDIENTE', folio: 3, fechaRecepcion: '2026-10-01 09:00:00' }),
      documento({ estado: 'REGISTRO', folio: 4, fechaRecepcion: '2026-10-16 09:00:00' }),
      documento({ lado: 'VENTA', estado: 'PENDIENTE', folio: 5, fechaRecepcion: '2026-10-16 09:00:00' }),
    ];
    const hs = reglaReclamo(entrada({ documentos }));
    expect(hs.map((h) => [h.severidad, h.evidencia[0]])).toEqual([
      ['advertencia', 'COMPRA:33:33333333-3:2'],
      ['info', 'COMPRA:33:33333333-3:3'],
    ]);
    expect(hs[0]!.detalle).toContain('quedan 3 día(s)');
    expect(hs[0]!.detalle).toContain('$119.000');
  });
});

describe('IVA-06 cambios después de presentar el F29', () => {
  it('detecta documentos nuevos y modificados desde la primera foto posterior a la presentación', () => {
    const snapshots = [
      snap(1, '2026-10-10T10:00:00.000Z', []),
      snap(2, '2026-10-16T10:00:00.000Z', [['A', 'x']]),
      snap(3, '2026-10-20T10:00:00.000Z', [['A', 'y'], ['B', 'z']]),
    ];
    const [h] = reglaCambiosPostF29(entrada({ snapshots }));
    expect(h).toMatchObject({ regla: 'IVA-06', severidad: 'advertencia' });
    expect(h!.detalle).toContain('1 documento(s) nuevo(s), 0 eliminado(s) y 1 modificado(s)');
    expect(h!.evidencia).toEqual(['B', 'A']);
  });

  it('sin cambios o con una sola foto posterior no hay hallazgo', () => {
    expect(reglaCambiosPostF29(entrada({ snapshots: [snap(2, '2026-10-16T10:00:00.000Z', [['A', 'x']]), snap(3, '2026-10-20T10:00:00.000Z', [['A', 'x']])] }))).toEqual([]);
    expect(reglaCambiosPostF29(entrada({ snapshots: [snap(1, '2026-10-10T10:00:00.000Z', []), snap(2, '2026-10-16T10:00:00.000Z', [['A', 'x']])] }))).toEqual([]);
  });
});

describe('IVA-07 IVA no recuperable o de uso común', () => {
  it('informa las compras registradas con IVA especial', () => {
    const [h] = reglaIvaEspecial(entrada({ documentos: [documento({ montoIvaNoRecuperable: 3_000 }), documento({ folio: 2 })] }));
    expect(h).toMatchObject({ regla: 'IVA-07', severidad: 'info', naturaleza: 'HECHO', evidencia: ['COMPRA:33:33333333-3:100'] });
    expect(h!.detalle).toContain('$3.000');
  });
});

describe('conciliarPeriodo', () => {
  it('un mes cuadrado no tiene hallazgos y expone las comparaciones', () => {
    const r = conciliarPeriodo(entrada());
    expect(r.hallazgos).toEqual([]);
    expect(r.versionReglas).toBe('iva-2026.10.1');
    expect(r.comparaciones).toEqual({ debitoRcv: 190_000, debitoF29: 190_000, creditoRcv: 19_000, creditoF29: 19_000, remanenteAnterior77: 5_000, remanenteActual504: 5_000 });
  });

  it('ordena los hallazgos por regla', () => {
    const r = conciliarPeriodo(
      entrada({
        resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 2_000_000, 380_000)] }), resumen({ lado: 'COMPRA', filas: [fila(33, 100_000, 19_000)] })],
        documentos: [documento({ estado: 'PENDIENTE', fechaRecepcion: '2026-10-16 09:00:00' }), documento({ folio: 9, montoIvaUsoComun: 1_000 })],
      }),
    );
    expect(r.hallazgos.map((h) => h.regla)).toEqual(['IVA-01', 'IVA-05', 'IVA-07']);
  });
});
