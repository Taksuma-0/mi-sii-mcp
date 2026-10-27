import { describe, expect, it } from 'vitest';
import { parsePeriodo } from '../../src/domain/periodo.js';
import type { SnapshotRcv } from '../../src/domain/tipos.js';
import { conciliarPeriodo } from '../../src/reconciliation/conciliar.js';
import { reglaCambiosPostF29, reglaF29Faltante, reglaIvaEspecial, reglaReclamo } from '../../src/reconciliation/reglas.js';
import { entrada } from '../helpers/entrada.js';
import { declaracion, documento, fila, resumen, valores } from '../helpers/fabricas.js';

const sinF29 = { declaraciones: [], valores: null } as const;
const snap = (sincronizacionId: number, obtenidoEn: string, filas: [string, string][]): SnapshotRcv => ({
  sincronizacionId,
  lado: 'COMPRA',
  obtenidoEn,
  filas: filas.map(([clave, sha]) => ({ clave, estado: 'REGISTRO', sha })),
});

describe('IVA-04 F29 faltante', () => {
  // Período 2026-09, autorizado al día 20 (o desconocido): con pago vence el 2026-10-20 y sin pago el 2026-10-28.
  it('es crítico después del día 28 sin pago, y cita ambas fechas', () => {
    const [h] = reglaF29Faltante(entrada({ ...sinF29, hoy: '2026-10-29' }));
    expect(h).toMatchObject({ regla: 'IVA-04', severidad: 'critico', titulo: 'F29 no presentado y vencido' });
    expect(h!.detalle).toContain('2026-10-28');
    expect(h!.detalle).toContain('2026-10-20');
    expect(h!.detalle).toContain('hace 1 día(s)');
  });

  it('entre el día de pago y el 28 es solo una advertencia de posiblemente vencido, con ambas fechas', () => {
    const [h] = reglaF29Faltante(entrada({ ...sinF29, hoy: '2026-10-21' }));
    expect(h).toMatchObject({ regla: 'IVA-04', severidad: 'advertencia', titulo: 'F29 posiblemente vencido' });
    expect(h!.detalle).toContain('posiblemente vencido: si el F29 lleva pago, venció el 2026-10-20; sin pago vence el 2026-10-28');
  });

  it.each([
    ['2026-10-21', 'advertencia', 'F29 posiblemente vencido'],
    ['2026-10-28', 'advertencia', 'F29 posiblemente vencido'],
    ['2026-10-29', 'critico', 'F29 no presentado y vencido'],
    ['2026-11-30', 'critico', 'F29 no presentado y vencido'],
  ] as const)('el 28 es el último día de la advertencia: hoy %s es %s', (hoy, severidad, titulo) => {
    expect(reglaF29Faltante(entrada({ ...sinF29, hoy }))[0]).toMatchObject({ severidad, titulo });
  });

  it('el mismo día de pago y antes sigue pendiente', () => {
    for (const hoy of ['2026-10-01', '2026-10-20']) {
      expect(reglaF29Faltante(entrada({ ...sinF29, hoy }))[0]).toMatchObject({ severidad: 'advertencia', titulo: 'F29 pendiente de presentar' });
    }
  });

  it('si el SII rechazó el folio lo dice en el detalle', () => {
    const rechazada = declaracion({ folio: 555_009, estadoId: 70, estado: 'Rechazada por pago inconcluso' });
    const [h] = reglaF29Faltante(entrada({ declaraciones: [rechazada], valores: null, hoy: '2026-10-29' }));
    expect(h).toMatchObject({ regla: 'IVA-04', severidad: 'critico' });
    expect(h!.detalle).toContain('El SII rechazó el folio 555009 (Rechazada por pago inconcluso).');
  });

  it('si solo hay una declaración guardada lo dice en el detalle', () => {
    const guardada = declaracion({ folio: 0, estadoId: 10, estado: 'Guardada' });
    const [h] = reglaF29Faltante(entrada({ declaraciones: [guardada], valores: null }));
    expect(h!.detalle).toContain('Hay una declaración guardada sin presentar.');
  });

  it('es advertencia si aún está en plazo, con ambas fechas', () => {
    const [h] = reglaF29Faltante(entrada({ ...sinF29, hoy: '2026-10-15' }));
    expect(h).toMatchObject({ severidad: 'advertencia', titulo: 'F29 pendiente de presentar' });
    expect(h!.detalle).toContain('en 5 día(s)');
    expect(h!.detalle).toContain('2026-10-20');
    expect(h!.detalle).toContain('2026-10-28');
  });

  it('sin autorización del día 20 el pago vence el 12 (13 por el feriado): después es posiblemente vencido', () => {
    const [h] = reglaF29Faltante(entrada({ ...sinF29, hoy: '2026-10-15', autorizadoDia20: false }));
    expect(h).toMatchObject({ severidad: 'advertencia', titulo: 'F29 posiblemente vencido' });
    expect(h!.detalle).toContain('venció el 2026-10-13');
    expect(h!.detalle).toContain('vence el 2026-10-28');
    expect(reglaF29Faltante(entrada({ ...sinF29, hoy: '2026-10-13', autorizadoDia20: false }))[0]).toMatchObject({ titulo: 'F29 pendiente de presentar' });
  });

  it('con la autorización desconocida se mantiene el día 20', () => {
    const a = reglaF29Faltante(entrada({ ...sinF29, hoy: '2026-10-15', autorizadoDia20: null }));
    const b = reglaF29Faltante(entrada({ ...sinF29, hoy: '2026-10-15' }));
    expect(a).toEqual(b);
    expect(a[0]).toMatchObject({ titulo: 'F29 pendiente de presentar' });
  });

  it('un F29 presentado no genera IVA-04, en ninguna ventana', () => {
    for (const hoy of ['2026-10-15', '2026-10-21', '2026-12-01']) expect(reglaF29Faltante(entrada({ hoy }))).toEqual([]);
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

  it('excluye fotos del día anterior en Santiago aunque en UTC ya sea el día de presentación', () => {
    const snapshots = [
      snap(1, '2026-10-15T01:00:00.000Z', [['A', 'antes']]),
      snap(2, '2026-10-15T16:00:00.000Z', [['A', 'despues']]),
      snap(3, '2026-10-16T16:00:00.000Z', [['A', 'despues']]),
    ];
    expect(reglaCambiosPostF29(entrada({ snapshots }))).toEqual([]);
  });

  it('muestra la fecha civil en Santiago de la foto base al detectar cambios', () => {
    const snapshots = [
      snap(1, '2026-10-16T01:00:00.000Z', [['A', 'antes']]),
      snap(2, '2026-10-17T16:00:00.000Z', [['A', 'despues']]),
    ];
    const [h] = reglaCambiosPostF29(entrada({ snapshots }));
    expect(h!.detalle).toContain('1 modificado(s) desde el 2026-10-15.');
    expect(h!.evidencia).toEqual(['A']);
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
  it('no compara el lado desconocido y mantiene las reglas de fuentes independientes', () => {
    const r = conciliarPeriodo(entrada({
      disponibilidad: { ventasRcv: false, comprasRcv: true, f29: true, propuestaF29: false, bheRecibidas: false },
      resumenes: [],
      documentos: [documento({ montoIvaNoRecuperable: 3_000 })],
      valoresAnterior: null,
    }));
    expect(r.comparaciones).toMatchObject({ debitoRcv: null, creditoRcv: 0 });
    expect(r.hallazgos.map((h) => h.regla)).toEqual(['IVA-02', 'IVA-07']);
  });

  it('no declara F29 ausente cuando esa fuente es desconocida', () => {
    const r = conciliarPeriodo(entrada({ ...sinF29, disponibilidad: { ventasRcv: true, comprasRcv: true, f29: false, propuestaF29: false, bheRecibidas: false } }));
    expect(r.hallazgos).toEqual([]);
  });
  it('un mes cuadrado no tiene hallazgos y expone las comparaciones', () => {
    const r = conciliarPeriodo(entrada());
    expect(r.hallazgos).toEqual([]);
    expect(r.versionReglas).toBe('iva-2026.10.6');
    expect(r.comparaciones).toEqual({ debitoRcv: 190_000, debitoF29: 190_000, creditoRcv: 19_000, creditoF29: 19_000, remanenteAnterior77: 5_000, remanenteActual504: 5_000 });
  });

  it('compara con cero las líneas ausentes de F29 leídos y deja sin dato los F29 no leídos', () => {
    const anterior = valores({ '91': 1 }, { periodo: '2026-08', folio: 554_000 });
    const leidos = conciliarPeriodo(entrada({ valores: valores({ '538': 190_000, '537': 19_000, '89': 171_000, '91': 171_000 }), valoresAnterior: anterior }));
    expect(leidos.comparaciones).toMatchObject({ debitoF29: 190_000, creditoF29: 19_000, remanenteAnterior77: 0, remanenteActual504: 0 });
    expect(leidos.hallazgos).toEqual([]);
    const sinLeer = conciliarPeriodo(entrada({ valores: null, valoresAnterior: null }));
    expect(sinLeer.comparaciones).toMatchObject({ debitoF29: null, creditoF29: null, remanenteAnterior77: null, remanenteActual504: null });
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
