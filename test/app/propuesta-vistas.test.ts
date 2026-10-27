import { describe, expect, it } from 'vitest';
import { resumenIva } from '../../src/app/consultas.js';
import { panorama } from '../../src/app/panorama.js';
import { formatearClp } from '../../src/domain/formato.js';
import { textoResumenIva } from '../../src/interfaces/formato.js';
import { depsDePrueba } from '../helpers/deps.js';
import { declaracion, fila, perfilEmpresa, propuesta, resumen, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { sembrarMes, T_SEMBRADO } from '../helpers/sembrar.js';

const SEPT = {
  resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000, 2)] }), resumen({ lado: 'COMPRA', filas: [fila(33, 100_000, 19_000, 1)] })],
  declaraciones: [declaracion()],
  valores: [valores({ '538': 190_000, '537': 24_000, '504': 5_000, '89': 166_000, '77': 0, '91': 166_000 })],
};

function conEmpresa() {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilEmpresa());
  return p;
}

/** Guarda la propuesta del mes como lo hace la sincronización: con su registro ok. */
function sembrarPropuesta(store: ReturnType<typeof depsDePrueba>['store'], periodo: string, p: ReturnType<typeof propuesta> | null): void {
  const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f29.propuesta', periodo, T_SEMBRADO);
  if (p) store.reemplazarPropuestaF29(id, RUT_EMPRESA, periodo, p, T_SEMBRADO);
  store.terminarSincronizacion(id, T_SEMBRADO, 'ok');
}

describe('resumenIva con la propuesta del SII', () => {
  it('sin propuesta consultada: propuesta null y el texto no la menciona', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');
    expect(r.propuesta).toBeNull();
    expect(textoResumenIva(r)).not.toContain('Propuesta del SII');
    expect(textoResumenIva(r)).not.toContain('propuesta');
  });

  it('con propuesta muestra crédito (520), remanente (504) y retención (151), y no cambia comparaciones ni hallazgos', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    const sin = resumenIva(deps, RUT_EMPRESA, '2026-09');
    sembrarPropuesta(store, '2026-09', propuesta());

    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');

    expect(r.propuesta).toEqual({ tipo: 40, sinPropuesta: false, credito: 950_000, origenCredito: '520', remanente: 120_000, retencion: 30_000 });
    expect(r.comparaciones).toEqual(sin.comparaciones);
    expect(r.hallazgos).toEqual(sin.hallazgos);
    expect(r.disponibilidad.propuestaF29).toBe(true);
    expect(r.frescura.propuesta).toBe(T_SEMBRADO);
    const texto = textoResumenIva(r);
    expect(texto).toContain(`Propuesta del SII: crédito ${formatearClp(950_000)} · remanente ${formatearClp(120_000)} · retención ${formatearClp(30_000)}`);
    expect(texto).not.toContain('Falta sincronizar: propuesta');
    expect(texto).toContain(`propuesta al ${T_SEMBRADO}`);
  });

  it('un mes sin propuesta lo dice', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    sembrarPropuesta(store, '2026-09', propuesta({ tipoPropuesta: 48, estadoCalculo: 5, propuestos: {}, administrativos: {}, sinPropuesta: true }));

    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');

    expect(r.propuesta).toEqual({ tipo: 48, sinPropuesta: true, credito: null, origenCredito: null, remanente: null, retencion: null });
    expect(textoResumenIva(r)).toContain('Propuesta del SII: sin propuesta para este mes');
  });

  it('consultada pero sin datos guardados: propuesta null y el texto lo aclara', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    sembrarPropuesta(store, '2026-09', null);

    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');

    expect(r.propuesta).toBeNull();
    expect(textoResumenIva(r)).toContain('Propuesta del SII: sin datos');
  });

  it('sin el 520 muestra el crédito del 511 como informativo y dice de qué código viene', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    sembrarPropuesta(store, '2026-09', propuesta({ propuestos: { '511': 900_000, '504': 120_000 } }));

    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');

    expect(r.propuesta).toMatchObject({ credito: 900_000, origenCredito: '511' });
    const texto = textoResumenIva(r);
    expect(texto).toContain(`Propuesta del SII: crédito propuesto (código 511, informativo) ${formatearClp(900_000)} · remanente ${formatearClp(120_000)}`);
  });

  it('con propuesta parcial muestra "sin dato" donde falta un monto', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    sembrarPropuesta(store, '2026-09', propuesta({ propuestos: { '504': 120_000 } }));
    expect(textoResumenIva(resumenIva(deps, RUT_EMPRESA, '2026-09'))).toContain(`Propuesta del SII: crédito sin dato · remanente ${formatearClp(120_000)} · retención sin dato`);
  });
});

describe('panorama con la propuesta del SII', () => {
  it('un mes sin datos de propuesta no tiene la clave propuesta', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    sembrarPropuesta(store, '2026-09', null);
    const mes = panorama(deps, RUT_EMPRESA).periodos[0]!;
    expect('propuesta' in mes).toBe(false);
  });

  it('con datos agrega la propuesta del mes: marca y los tres montos', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-08', SEPT);
    sembrarMes(store, '2026-09', SEPT);
    sembrarPropuesta(store, '2026-09', propuesta());
    const r = panorama(deps, RUT_EMPRESA);
    expect('propuesta' in r.periodos[0]!).toBe(false);
    expect(r.periodos[1]!.propuesta).toEqual({ sinPropuesta: false, credito: 950_000, origenCredito: '520', remanente: 120_000, retencion: 30_000 });
    expect(r.periodos[1]!.disponibilidad.propuestaF29).toBe(true);
  });

  it('un mes sin propuesta del SII queda marcado con montos null', () => {
    const { deps, store } = conEmpresa();
    sembrarPropuesta(store, '2026-09', propuesta({ propuestos: {}, administrativos: {}, sinPropuesta: true }));
    expect(panorama(deps, RUT_EMPRESA).periodos[0]!.propuesta).toEqual({ sinPropuesta: true, credito: null, origenCredito: null, remanente: null, retencion: null });
  });
});
