import { describe, expect, it } from 'vitest';
import { estimacionRenta } from '../../src/app/estimar-renta.js';
import type { ParametrosRenta } from '../../src/reconciliation/estimar-renta.js';
import { depsDePrueba } from '../helpers/deps.js';
import { codigoDe } from '../helpers/errores.js';
import { declaracionF22, detalleF22, informeBheEmitidas, perfilEmpresa, perfilPersona, RUT_EMPRESA, RUT_PERSONA } from '../helpers/fabricas.js';
import { T_SEMBRADO } from '../helpers/sembrar.js';

const parametros: ParametrosRenta = {
  tablaIgc: [
    { desde: 0, hasta: 10_000_000, factor: 0, rebaja: 0 },
    { desde: 10_000_000, hasta: null, factor: 0.04, rebaja: 400_000 },
  ],
  uta: 800_000,
  gastosPresuntosPct: 30,
  topeGastosPresuntosUta: 15,
  obligadoCotizar: false,
};

function preparar() {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilPersona());
  const id = p.store.iniciarSincronizacion(RUT_PERSONA, 'bhe.emitidas', 'AT2026', T_SEMBRADO);
  const informe = informeBheEmitidas(2025, { 3: { bruto: 1_000_000, retencionTerceros: 145_000, vigentes: 1 }, 9: { bruto: 500_000, retencionTerceros: 72_500, vigentes: 1 } });
  p.store.reemplazarBheEmitidas(id, RUT_PERSONA, 2025, informe.meses, T_SEMBRADO);
  const idF22 = p.store.iniciarSincronizacion(RUT_PERSONA, 'f22', 'AT2026', T_SEMBRADO);
  p.store.reemplazarF22Declaraciones(idF22, RUT_PERSONA, 2026, [declaracionF22({ rut: RUT_PERSONA, anioTributario: 2026, folio: 9 })], T_SEMBRADO);
  p.store.reemplazarF22Detalle(RUT_PERSONA, 2026, 9, detalleF22({ valores: [{ codigo: '305', valor: -217_500, glosa: 'RESULTADO LIQUIDACIÓN ANUAL IMPUESTO A LA RENTA' }] }));
  return p;
}

describe('estimacionRenta', () => {
  it('toma las boletas emitidas del año comercial y compara con el F22 presentado', () => {
    const { deps } = preparar();

    const r = estimacionRenta(deps, RUT_PERSONA, '2026', parametros);

    expect(r.datos).toMatchObject({ honorariosBrutos: 1_500_000, retencionHonorarios: 217_500, sueldos: 0 });
    expect(r.resultado).toBe(-217_500);
    expect(r.f22).toEqual({ folio: 9, resultado305: -217_500 });
    expect(r.diferenciaConF22).toBe(0);
    expect(r.supuestos).toEqual(expect.arrayContaining([expect.stringMatching(/sin actualizar por IPC/)]));
  });

  it('con los factores de actualización reajusta cada mes', () => {
    const { deps } = preparar();
    const factores = [1.03, 1.03, 1.02, 1.02, 1.02, 1.01, 1.01, 1.01, 1.0, 1.0, 1.0, 1.0];

    const r = estimacionRenta(deps, RUT_PERSONA, '2026', { ...parametros, factoresIpc: factores });

    expect(r.datos.honorariosBrutos).toBe(1_020_000 + 500_000);
  });

  it('es para personas y valida los parámetros públicos', async () => {
    const { deps, store } = preparar();
    store.guardarContribuyente(perfilEmpresa());
    expect(await codigoDe(Promise.resolve().then(() => estimacionRenta(deps, RUT_EMPRESA, '2026', parametros)))).toBe('PARAMETROS_INVALIDOS');
    expect(await codigoDe(Promise.resolve().then(() => estimacionRenta(deps, RUT_PERSONA, '2026', { ...parametros, tablaIgc: [] })))).toBe('PARAMETROS_INVALIDOS');
    expect(await codigoDe(Promise.resolve().then(() => estimacionRenta(deps, RUT_PERSONA, '2026', { ...parametros, factoresIpc: [1, 1] })))).toBe('PARAMETROS_INVALIDOS');
  });
});
