import { describe, expect, it } from 'vitest';
import { proyeccionCierre, simulacionRegimen } from '../../src/app/simuladores.js';
import type { TramoIgc } from '../../src/reconciliation/estimar-renta.js';
import { depsDePrueba } from '../helpers/deps.js';
import { codigoDe } from '../helpers/errores.js';
import { declaracion, declaracionF22, detalleF22, documento, perfilEmpresa, perfilTributario, RUT_CLIENTE, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { sembrarMes, T_SEMBRADO } from '../helpers/sembrar.js';

const TABLA: TramoIgc[] = [
  { desde: 0, hasta: 10_000_000, factor: 0, rebaja: 0 },
  { desde: 10_000_000, hasta: 50_000_000, factor: 0.1, rebaja: 1_000_000 },
  { desde: 50_000_000, hasta: null, factor: 0.3, rebaja: 11_000_000 },
];

/** Hoy es 2026-10-21: los meses cerrados del año son de enero a septiembre, y solo agosto y septiembre tienen datos. */
function conDosMeses() {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilEmpresa());
  for (const [periodo, folio] of [['2026-08', 1], ['2026-09', 2]] as const) {
    sembrarMes(p.store, periodo, {
      documentos: [
        documento({ periodo, lado: 'VENTA', rutContraparte: RUT_CLIENTE, folio, razonSocial: 'CLIENTE DEMO SPA', fechaEmision: `${periodo}-03`, montoNeto: 1_000_000, montoIva: 190_000, montoTotal: 1_190_000 }),
        documento({ periodo, folio: 100 + folio, fechaEmision: `${periodo}-05`, montoNeto: 100_000, montoIva: 19_000, montoTotal: 119_000 }),
      ],
      declaraciones: [declaracion({ periodo, folio: 900 + folio })],
      valores: [valores({ '62': 10_000 }, { periodo, folio: 900 + folio })],
    });
  }
  return p;
}

describe('proyección del cierre del año', () => {
  it('proyecta lo acumulado al ritmo de los meses con datos y lo compara con los PPM pagados', () => {
    const { deps } = conDosMeses();

    const r = proyeccionCierre(deps, RUT_EMPRESA, '2026', 12.5);

    expect(r.base).toMatchObject({ desde: '2026-01', hasta: '2026-09', criterio: 'devengado', mesesConDatos: 2 });
    expect(r.base.sinDatos).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
    expect(r).toMatchObject({ baseAcumulada: 1_800_000, baseProyectada: 10_800_000, ppmPagados: 20_000, ppmProyectados: 120_000, idpcEstimado: 1_350_000, saldoAbril: 1_230_000 });
    expect(r.notas.join(' ')).toContain('ahorro_oportunidades');
    expect(r.regimen).toBeNull();
  });

  it('en el Pro Pyme Transparente no estima Primera Categoría y lo explica', () => {
    const { deps, store } = conDosMeses();
    store.guardarPerfilTributario(RUT_EMPRESA, perfilTributario(), T_SEMBRADO);

    const r = proyeccionCierre(deps, RUT_EMPRESA, '2026', 12.5);

    expect(r.regimen).toEqual({ tipo: 'pro_pyme_transparente', descripcion: 'Régimen Pro Pyme Transparente 14 D N°8' });
    expect(r.idpcEstimado).toBeNull();
    expect(r.faltantes).toEqual([]);
    expect(r.notas.join(' ')).toContain('no paga Primera Categoría');
  });

  it('de un año ya declarado muestra la base del F22, que manda sobre la proyección', () => {
    const { deps, store } = conDosMeses();
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f22', 'AT2027', T_SEMBRADO);
    store.reemplazarF22Declaraciones(id, RUT_EMPRESA, 2027, [declaracionF22({ anioTributario: 2027, folio: 7 })], T_SEMBRADO);
    store.reemplazarF22Detalle(RUT_EMPRESA, 2027, 7, detalleF22({ valores: [{ codigo: '1630', valor: -8_000_000, glosa: 'Base imponible a asignar a propietarios' }] }));

    const r = proyeccionCierre(deps, RUT_EMPRESA, '2026');

    expect(r.f22).toEqual({ anioTributario: 2027, folio: 7, base: -8_000_000 });
    expect(r.notas.join(' ')).toContain('-$8.000.000');
  });

  it('rechaza un año futuro y pide sincronizar un año sin datos', async () => {
    const { deps } = conDosMeses();

    expect(await codigoDe(Promise.resolve().then(() => proyeccionCierre(deps, RUT_EMPRESA, '2027')))).toBe('PARAMETROS_INVALIDOS');
    expect(await codigoDe(Promise.resolve().then(() => proyeccionCierre(deps, RUT_EMPRESA, '2025')))).toBe('SIN_DATOS_LOCALES');
  });
});

describe('simulación de régimen', () => {
  it('con la base informada no necesita datos guardados', () => {
    const { deps } = conDosMeses();

    const r = simulacionRegimen(deps, RUT_EMPRESA, '2025', { base: 40_000_000, socios: [{ participacion: 100, otrasRentas: 0 }], tasaIdpc: 12.5, tablaIgc: TABLA });

    expect(r.origenBase).toBe('informada');
    expect(r.general.total).toBe(3_000_000);
    expect(r.transparente.total).toBe(3_000_000);
    expect(r.requisitos.join(' ')).toContain('30 de abril');
  });

  it('sin base usa la del año proyectada y lo anota', () => {
    const { deps } = conDosMeses();

    const r = simulacionRegimen(deps, RUT_EMPRESA, '2026', { socios: [{ participacion: 100, otrasRentas: 0 }], tasaIdpc: 12.5, tablaIgc: TABLA });

    expect(r.origenBase).toBe('proyectada');
    expect(r.base).toBe(10_800_000);
    expect(r.supuestos.join(' ')).toContain('2 meses');
  });

  it('sin base informada prefiere la declarada en el F22 del año y muestra el régimen inscrito', () => {
    const { deps, store } = conDosMeses();
    store.guardarPerfilTributario(RUT_EMPRESA, perfilTributario(), T_SEMBRADO);
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f22', 'AT2026', T_SEMBRADO);
    store.reemplazarF22Declaraciones(id, RUT_EMPRESA, 2026, [declaracionF22({ folio: 7 })], T_SEMBRADO);
    store.reemplazarF22Detalle(RUT_EMPRESA, 2026, 7, detalleF22({ valores: [{ codigo: '1630', valor: 30_000_000, glosa: 'Base imponible a asignar a propietarios' }] }));

    const r = simulacionRegimen(deps, RUT_EMPRESA, '2025', { socios: [{ participacion: 100, otrasRentas: 0 }], tasaIdpc: 12.5, tablaIgc: TABLA });

    expect(r.origenBase).toBe('f22');
    expect(r.base).toBe(30_000_000);
    expect(r.regimen?.tipo).toBe('pro_pyme_transparente');
  });

  it('exige participaciones que sumen 100 y una tasa razonable', async () => {
    const { deps } = conDosMeses();
    const base = { base: 1, tasaIdpc: 12.5, tablaIgc: TABLA };

    expect(await codigoDe(Promise.resolve().then(() => simulacionRegimen(deps, RUT_EMPRESA, '2026', { ...base, socios: [{ participacion: 60, otrasRentas: 0 }] })))).toBe('PARAMETROS_INVALIDOS');
    expect(await codigoDe(Promise.resolve().then(() => simulacionRegimen(deps, RUT_EMPRESA, '2026', { ...base, tasaIdpc: 0.125, socios: [{ participacion: 100, otrasRentas: 0 }] })))).toBe('PARAMETROS_INVALIDOS');
  });
});
