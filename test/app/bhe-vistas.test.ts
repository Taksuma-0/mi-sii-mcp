import { describe, expect, it } from 'vitest';
import { f29Historial, resumenIva } from '../../src/app/consultas.js';
import { panorama } from '../../src/app/panorama.js';
import { formatearClp } from '../../src/domain/formato.js';
import type { BoletaHonorarios } from '../../src/domain/tipos.js';
import { textoHistorialF29, textoResumenIva } from '../../src/interfaces/formato.js';
import { depsDePrueba } from '../helpers/deps.js';
import { boleta, declaracion, fila, perfilEmpresa, resumen, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { sembrarMes, T_SEMBRADO } from '../helpers/sembrar.js';

const SEPT = {
  resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000, 2)] }), resumen({ lado: 'COMPRA', filas: [fila(33, 100_000, 19_000, 1)] })],
  declaraciones: [declaracion()],
  valores: [valores({ '538': 190_000, '537': 24_000, '504': 5_000, '89': 166_000, '77': 0, '91': 166_000, '151': 228_750 })],
};

const BOLETAS = [
  boleta({ folio: 1, bruto: 1_000_000, retencion: 152_500, liquido: 847_500 }),
  boleta({ folio: 2, bruto: 200_000, retencion: 30_500, liquido: 169_500, anulada: true, fechaAnulacion: '2026-09-15' }),
  boleta({ folio: 3, bruto: 500_000, retencion: 76_250, liquido: 423_750 }),
];

function conEmpresa() {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilEmpresa());
  return p;
}

/** Guarda las boletas del mes como lo hace la sincronización: con su registro ok. */
function sembrarBhe(store: ReturnType<typeof depsDePrueba>['store'], periodo: string, boletas: readonly BoletaHonorarios[]): void {
  const id = store.iniciarSincronizacion(RUT_EMPRESA, 'bhe.recibidas', periodo, T_SEMBRADO);
  store.reemplazarBhe(id, RUT_EMPRESA, periodo, boletas, T_SEMBRADO);
  store.terminarSincronizacion(id, T_SEMBRADO, 'ok');
}

describe('resumenIva con las boletas de honorarios recibidas', () => {
  it('sin boletas consultadas: honorarios null y el texto no las menciona', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);

    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');

    expect(r.honorarios).toBeNull();
    expect(textoResumenIva(r)).not.toMatch(/honorarios|boletas/i);
  });

  it('con boletas consultadas muestra cantidad, anuladas, bruto y retención de las no anuladas', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    sembrarBhe(store, '2026-09', BOLETAS);

    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');

    expect(r.honorarios).toEqual({ cantidad: 3, anuladas: 1, bruto: 1_500_000, retencion: 228_750, liquido: 1_271_250 });
    expect(r.disponibilidad.bheRecibidas).toBe(true);
    const texto = textoResumenIva(r);
    expect(texto).toContain(`Boletas de honorarios recibidas: 3 (1 anulada) · bruto ${formatearClp(1_500_000)} · retención ${formatearClp(228_750)}`);
    expect(texto).toContain(`boletas al ${T_SEMBRADO}`);
  });

  it('consultadas sin boletas lo dice', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    sembrarBhe(store, '2026-09', []);

    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');

    expect(r.honorarios).toEqual({ cantidad: 0, anuladas: 0, bruto: 0, retencion: 0, liquido: 0 });
    expect(textoResumenIva(r)).toContain('Boletas de honorarios recibidas: ninguna');
  });
});

describe('panorama con las boletas de honorarios recibidas', () => {
  it('muestra los honorarios del mes solo si se consultaron', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-08', {});
    sembrarMes(store, '2026-09', SEPT);
    sembrarBhe(store, '2026-09', BOLETAS);

    const r = panorama(deps, RUT_EMPRESA);

    expect(r.periodos.map((p) => [p.periodo, p.honorarios ?? null])).toEqual([
      ['2026-08', null],
      ['2026-09', { cantidad: 3, anuladas: 1, bruto: 1_500_000, retencion: 228_750, liquido: 1_271_250 }],
    ]);
    expect('honorarios' in r.periodos[0]!).toBe(false);
  });
});

describe('f29Historial con las boletas de honorarios recibidas', () => {
  it('muestra el 151 del F29 junto a la retención de las boletas no anuladas, si se consultaron', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-08', { declaraciones: [declaracion({ periodo: '2026-08', folio: 554_000 })], valores: [valores({ '538': 0 }, { periodo: '2026-08', folio: 554_000 })] });
    sembrarMes(store, '2026-09', SEPT);
    sembrarBhe(store, '2026-09', BOLETAS);

    const h = f29Historial(deps, RUT_EMPRESA, '2026-08', '2026-09');

    expect(h.map((f) => [f.periodo, f.retencion151, f.retencionBoletas])).toEqual([
      ['2026-08', 0, null],
      ['2026-09', 228_750, 228_750],
    ]);
    const texto = textoHistorialF29(h).split('\n');
    expect(texto[0]).not.toMatch(/retención|boletas/);
    expect(texto[1]).toContain(`retención (151) ${formatearClp(228_750)} · retención de boletas de honorarios ${formatearClp(228_750)}`);
  });
});

describe('RET-01 con las boletas guardadas', () => {
  it('suma solo la retención de las boletas no anuladas del mes contra el 151', () => {
    const { deps, store } = conEmpresa();
    // 151 = 152.500 + 76.250: cuadra solo si la anulada (30.500) queda fuera.
    sembrarMes(store, '2026-09', SEPT);
    sembrarBhe(store, '2026-09', BOLETAS);

    expect(resumenIva(deps, RUT_EMPRESA, '2026-09').hallazgos.filter((h) => h.regla === 'RET-01')).toEqual([]);

    sembrarBhe(store, '2026-09', [...BOLETAS, boleta({ folio: 4, retencion: 10_000 })]);
    const [h] = resumenIva(deps, RUT_EMPRESA, '2026-09').hallazgos.filter((x) => x.regla === 'RET-01');
    expect(h).toMatchObject({ severidad: 'advertencia', montos: { esperado: 238_750, declarado: 228_750, diferencia: 10_000 } });
  });

  it('no aplica si las boletas del mes no se consultaron', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', { ...SEPT, valores: [valores({ '538': 190_000, '537': 24_000, '504': 5_000, '89': 166_000, '77': 0, '91': 166_000, '151': 50_000 })] });

    expect(resumenIva(deps, RUT_EMPRESA, '2026-09').hallazgos.some((h) => h.regla === 'RET-01')).toBe(false);
  });

  it('con boletas consultadas sin ninguna y un 151 declarado es info', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    sembrarBhe(store, '2026-09', []);

    const [h] = resumenIva(deps, RUT_EMPRESA, '2026-09').hallazgos.filter((x) => x.regla === 'RET-01');
    expect(h).toMatchObject({ severidad: 'info', montos: { esperado: 0, declarado: 228_750 } });
  });
});

describe('boletas de honorarios sin respuesta del SII', () => {
  /** Como deja la sincronización un vacío ambiguo sin boletas guardadas: el intento queda con RESPUESTA_VACIA. */
  function sembrarSinRespuesta(store: ReturnType<typeof depsDePrueba>['store'], periodo: string): void {
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'bhe.recibidas', periodo, T_SEMBRADO);
    store.terminarSincronizacion(id, T_SEMBRADO, 'error', { codigo: 'RESPUESTA_VACIA', detalle: 'sin boletas ni total' });
  }

  it('el resumen y el panorama dicen «sin respuesta del SII», nunca «ninguna», y no hay RET-01', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    sembrarSinRespuesta(store, '2026-09');

    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');

    expect(r.honorarios).toBe('sin_respuesta');
    const texto = textoResumenIva(r);
    expect(texto).toContain('Boletas de honorarios recibidas: sin respuesta del SII');
    expect(texto).not.toContain('ninguna');
    expect(r.hallazgos.some((h) => h.regla === 'RET-01')).toBe(false);
    expect(panorama(deps, RUT_EMPRESA).periodos[0]!.honorarios).toBe('sin_respuesta');
    expect(f29Historial(deps, RUT_EMPRESA, '2026-09', '2026-09')[0]!.retencionBoletas).toBeNull();
  });

  it('si antes hubo una consulta buena, se muestran las boletas guardadas', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    sembrarBhe(store, '2026-09', BOLETAS);
    sembrarSinRespuesta(store, '2026-09');

    expect(resumenIva(deps, RUT_EMPRESA, '2026-09').honorarios).toMatchObject({ cantidad: 3 });
  });

  it('otro error (no RESPUESTA_VACIA) sin consulta buena no muestra las boletas', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'bhe.recibidas', '2026-09', T_SEMBRADO);
    store.terminarSincronizacion(id, T_SEMBRADO, 'error', { codigo: 'PORTAL_CAMBIO', detalle: 'x' });

    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');

    expect(r.honorarios).toBeNull();
    expect(textoResumenIva(r)).not.toMatch(/honorarios/i);
  });
});
