import { describe, expect, it } from 'vitest';
import { registrar, type ResultadoPeriodo } from '../../src/app/registro.js';
import type { RespuestaCruda } from '../../src/domain/tipos.js';
import { depsDePrueba } from '../helpers/deps.js';
import { perfilEmpresa, RUT_EMPRESA } from '../helpers/fabricas.js';

const respuesta = (superficie: string, cuerpo: unknown): RespuestaCruda => ({ superficie, parametros: {}, cuerpo: JSON.stringify(cuerpo), obtenidoEn: '2026-11-02T03:00:00.000Z' });
const resultado = (): ResultadoPeriodo => ({ periodo: '2026-09', errores: [], avisos: [], documentos: 0, f29Folio: null });

describe('huellas al guardar las respuestas de una superficie', () => {
  it('guarda la forma de cada respuesta y anota solo los campos nuevos, sin avisos', async () => {
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    const buffer: RespuestaCruda[] = [];

    await registrar(deps, RUT_EMPRESA, 'rcv.COMPRA', '2026-09', buffer, resultado(), undefined, async () => {
      buffer.push(respuesta('rcv.detalle.COMPRA.REGISTRO.33', { data: [{ detNroDoc: 1, detMntNeto: 10 }] }));
    });
    await registrar(deps, RUT_EMPRESA, 'rcv.COMPRA', '2026-10', buffer, resultado(), undefined, async () => {
      buffer.push(respuesta('rcv.detalle.COMPRA.REGISTRO.61', { data: [{ detNroDoc: 2, detMntNeto: 20, detCampoNuevo: 'x' }] }));
    });

    expect(store.huellasPortal().map((h) => h.superficie)).toEqual(['rcv.detalle.COMPRA.REGISTRO.N']);
    expect(store.cambiosPortal().map((c) => [c.superficie, c.tipo, c.detalle])).toEqual([['rcv.detalle.COMPRA.REGISTRO.N', 'aditivo', { rutas: ['data[].detCampoNuevo'] }]]);
    expect(store.avisos()).toEqual([]);
  });

  it('la primera vez arma la forma conocida con las respuestas que ya estaban guardadas', async () => {
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'rcv.VENTA', '2026-08', '2026-11-01T03:00:00.000Z');
    store.guardarRespuestaCruda(id, respuesta('rcv.detalle.VENTA.REGISTRO.33', { data: [{ detNroDoc: 1, detMntNeto: 10, detMntIVA: 2 }] }));
    store.terminarSincronizacion(id, '2026-11-01T03:00:01.000Z', 'ok');
    const buffer: RespuestaCruda[] = [];

    await registrar(deps, RUT_EMPRESA, 'rcv.VENTA', '2026-09', buffer, resultado(), undefined, async () => {
      buffer.push(respuesta('rcv.detalle.VENTA.REGISTRO.33', { data: [{ detNroDoc: 3, detMntIVA: 4 }] }));
    });

    expect(store.huellasPortal()[0]!.rutas).toEqual(['data', 'data[]', 'data[].detMntIVA', 'data[].detMntNeto', 'data[].detNroDoc']);
    expect(store.cambiosPortal()).toEqual([]);
  });

  it('una respuesta que no se puede describir no rompe la superficie', async () => {
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    const buffer: RespuestaCruda[] = [];

    const valor = await registrar(deps, RUT_EMPRESA, 'f29.valores', '2026-09', buffer, resultado(), undefined, async () => {
      buffer.push({ superficie: 'f29.formCompacto', parametros: {}, cuerpo: 'JVBERi0xLjQK', obtenidoEn: '2026-11-02T03:00:00.000Z' });
      return 'ok';
    });

    expect(valor).toBe('ok');
    expect(store.huellasPortal()).toEqual([]);
  });
});
