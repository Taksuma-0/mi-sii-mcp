import { describe, expect, it } from 'vitest';
import { diagnostico } from '../../src/app/diagnostico.js';
import type { DepsApp } from '../../src/app/deps.js';
import { depsDePrueba } from '../helpers/deps.js';
import { perfilEmpresa, perfilPersona, RUT_EMPRESA, RUT_PERSONA } from '../helpers/fabricas.js';

function preparar() {
  const p = depsDePrueba({ ahora: '2026-11-02T15:00:00.000Z' });
  p.store.guardarContribuyente(perfilEmpresa());
  p.store.guardarContribuyente(perfilPersona());
  const intento = (superficie: string, periodo: string, en: string, error?: string) => {
    const id = p.store.iniciarSincronizacion(RUT_EMPRESA, superficie, periodo, en);
    p.store.guardarRespuestaCruda(id, { superficie: `${superficie}.x`, parametros: {}, cuerpo: '{}', obtenidoEn: en });
    p.store.terminarSincronizacion(id, en, error ? 'error' : 'ok', error ? { codigo: error, detalle: 'x' } : undefined);
  };
  intento('rcv.VENTA', '2026-10', '2026-11-01T10:00:00.000Z');
  intento('f29', '2026-10', '2026-11-01T10:00:01.000Z', 'PORTAL_CAMBIO');
  intento('rcv.COMPRA', '2026-10', '2026-11-01T10:00:02.000Z', 'SII_NO_DISPONIBLE');
  p.store.registrarCambioPortal('rcv.detalle.COMPRA.REGISTRO.N', 'aditivo', { rutas: ['data[].detNuevo'] }, '2026-11-01T10:00:00.000Z');
  p.store.guardarAlias({ superficie: 'rcv.detalle', campo: 'montoNeto', alias: 'detMntNetoNuevo', aprendidoEn: '2026-11-01T10:00:00.000Z', evidencia: 'suma = neto del resumen' });
  p.store.registrarAvisos([{ rut: RUT_EMPRESA, clave: 'X', tipo: 'portal', severidad: 'advertencia', titulo: 't', detalle: 'd' }], '2026-11-01T10:00:00.000Z');
  const deps: DepsApp = {
    ...p.deps,
    sesiones: { estado: (rut) => ({ tieneSesion: rut === RUT_EMPRESA, guardadaEn: null, bloqueado: false }) },
    versionActual: '0.3.0',
    versiones: { ultima: async () => '0.3.1', conocida: () => '0.3.1' },
    respaldos: { crear: async () => ({ ruta: 'r', creado: true, borrados: 0 }), ultimo: () => 'C:/respaldos/mi-sii-mcp-2026-11-01.db' },
  };
  return { ...p, deps };
}

describe('diagnóstico de mi-sii-mcp', () => {
  it('reúne versión, base, cuentas y cambios del portal sin ir al SII', () => {
    const { deps } = preparar();

    const d = diagnostico(deps);

    expect(d.version).toEqual({ actual: '0.3.0', ultima: '0.3.1', hayNueva: true });
    expect(d.base).toEqual({ integridad: 'ok', respuestasCrudas: 3, ultimoRespaldo: 'C:/respaldos/mi-sii-mcp-2026-11-01.db' });
    expect(d.cuentas.map((c) => [c.rut, c.sesion, c.pendientesReintento, c.avisosSinVer])).toEqual([
      [RUT_EMPRESA, 'activa', 1, 1],
      [RUT_PERSONA, 'sin_sesion', 0, 0],
    ]);
    expect(d.cuentas.find((c) => c.rut === RUT_EMPRESA)!.ultimasOk).toEqual([{ superficie: 'rcv.VENTA', en: '2026-11-01T10:00:00.000Z' }]);
    expect(d.portal.cambios.map((c) => c.tipo)).toEqual(['aditivo']);
    expect(d.portal.alias.map((a) => a.alias)).toEqual(['detMntNetoNuevo']);
    expect(d.portal.lecturasRotas).toBe(1);
  });

  it('cuenta como rotas solo las lecturas cuyo último intento sigue fallando, de superficies que el lector actual pide', () => {
    const { deps, store } = preparar();
    const intento = (superficie: string, periodo: string, en: string, error?: string) => {
      const id = store.iniciarSincronizacion(RUT_EMPRESA, superficie, periodo, en);
      store.terminarSincronizacion(id, en, error ? 'error' : 'ok', error ? { codigo: error, detalle: 'x' } : undefined);
    };
    intento('terceros.29', 'AT2026', '2026-10-30T10:00:00.000Z', 'PORTAL_CAMBIO');
    intento('bhe.recibidas', '2026-09', '2026-10-27T10:00:00.000Z', 'PORTAL_CAMBIO');
    intento('bhe.recibidas', '2026-09', '2026-10-30T10:00:00.000Z');

    const d = diagnostico(deps);

    expect(d.portal.rotas).toEqual([{ rut: RUT_EMPRESA, superficie: 'f29', periodo: '2026-10', en: '2026-11-01T10:00:01.000Z' }]);
    expect(d.portal.lecturasRotas).toBe(1);
  });

  it('con un RUT, muestra solo esa cuenta', () => {
    const { deps } = preparar();

    expect(diagnostico(deps, '22.222.222-2').cuentas.map((c) => c.rut)).toEqual([RUT_EMPRESA]);
  });
});
