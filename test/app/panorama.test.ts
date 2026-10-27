import { describe, expect, it, vi } from 'vitest';
import { panorama } from '../../src/app/panorama.js';
import { SqliteStore } from '../../src/store/sqlite/store.js';
import { depsDePrueba } from '../helpers/deps.js';
import { declaracion, declaracionF22, detalleF22, documento, empresaAutorizada, fila, informeBheEmitidas, perfilEmpresa, perfilPersona, perfilTributario, resumen, RUT_EMPRESA, RUT_PERSONA, valores } from '../helpers/fabricas.js';
import { medirLecturas } from '../helpers/lecturas-sqlite.js';
import { sembrarMes, T_SEMBRADO } from '../helpers/sembrar.js';

function conEmpresa() {
  const p = depsDePrueba({ fallaAlAbrir: new Error('El panorama no debe abrir el SII') });
  p.store.guardarContribuyente(perfilEmpresa());
  return p;
}

describe('panorama local del SII', () => {
  it('devuelve el perfil y todos sus meses almacenados en orden ascendente, incluidos huecos mayores a 120 meses', () => {
    const { deps, store } = conEmpresa();
    store.guardarContribuyente(perfilPersona());
    sembrarMes(store, '2026-09');
    sembrarMes(store, '2000-01');
    sembrarMes(store, '2012-04');
    sembrarMes(store, '2026-08', {}, RUT_PERSONA);

    const r = panorama(deps, '22.222.222-2');

    expect(r.perfil).toEqual(perfilEmpresa());
    expect(r.periodos.map((p) => p.periodo)).toEqual(['2000-01', '2012-04', '2026-09']);
    expect(panorama(deps, RUT_PERSONA).periodos.map((p) => p.periodo)).toEqual(['2026-08']);
  });

  it('suma los totales firmados y el IVA de registros, restando notas de crédito y excluyendo otros estados', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', {
      resumenes: [
        resumen({ filas: [fila(33, 1_000_000, 190_000), fila(60, 10_000, 1_900), fila(61, 100_000, 19_000), fila(112, 50_000, 9_500), { ...fila(34, 0, 0), exento: 40_000, total: 40_000 }] }),
        resumen({ lado: 'COMPRA', filas: [fila(33, 200_000, 38_000), fila(60, 10_000, 1_900), fila(61, 20_000, 3_800), fila(112, 5_000, 950)] }),
        ...(['PENDIENTE', 'NO_INCLUIR', 'RECLAMADO'] as const).flatMap((estado) => [
          resumen({ estado, filas: [fila(33, 9_000_000, 1_710_000)] }),
          resumen({ lado: 'COMPRA', estado, filas: [fila(33, 9_000_000, 1_710_000)] }),
        ]),
      ],
    });
    store.guardarContribuyente(perfilPersona());
    sembrarMes(store, '2026-09', { resumenes: [resumen({ filas: [fila(33, 99_000_000, 18_810_000)] })] }, RUT_PERSONA);

    const r = panorama(deps, RUT_EMPRESA);

    expect(r.periodos[0]).toMatchObject({ ventas: 1_039_600, compras: 196_350, ivaDebito: 159_600, ivaCredito: 31_350 });
    expect(r.totales).toMatchObject({
      ventas: { monto: 1_039_600, mesesConDatos: 1, mesesSinDatos: 0 },
      compras: { monto: 196_350, mesesConDatos: 1, mesesSinDatos: 0 },
      ivaDebito: { monto: 159_600, mesesConDatos: 1, mesesSinDatos: 0 },
      ivaCredito: { monto: 31_350, mesesConDatos: 1, mesesSinDatos: 0 },
    });
  });

  it('distingue un mes consultado vacío de fuentes parciales sin consulta exitosa', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-08');
    const ventas = store.iniciarSincronizacion(RUT_EMPRESA, 'rcv.VENTA', '2026-09', T_SEMBRADO);
    store.reemplazarRcv(ventas, RUT_EMPRESA, '2026-09', 'VENTA', [], [], T_SEMBRADO);
    store.terminarSincronizacion(ventas, T_SEMBRADO, 'ok');
    const compras = store.iniciarSincronizacion(RUT_EMPRESA, 'rcv.COMPRA', '2026-09', T_SEMBRADO);
    store.reemplazarRcv(compras, RUT_EMPRESA, '2026-09', 'COMPRA', [resumen({ lado: 'COMPRA' })], [], T_SEMBRADO);
    store.terminarSincronizacion(compras, T_SEMBRADO, 'error');
    const f29 = store.iniciarSincronizacion(RUT_EMPRESA, 'f29', '2026-09', T_SEMBRADO);
    store.guardarF29(f29, RUT_EMPRESA, '2026-09', [declaracion()], [valores({ '91': 171_000 })], T_SEMBRADO);
    store.terminarSincronizacion(f29, T_SEMBRADO, 'error');

    const r = panorama(deps, RUT_EMPRESA);

    expect(r.periodos[0]).toEqual({
      periodo: '2026-08', disponibilidad: { ventasRcv: true, comprasRcv: true, f29: true, propuestaF29: false, bheRecibidas: false },
      frescura: { rcv: T_SEMBRADO, f29: T_SEMBRADO, propuesta: null, bhe: null }, ventas: 0, compras: 0, ivaDebito: 0, ivaCredito: 0,
      f29: { consultado: true, presentado: false, folio: null, estado: null, totalAPagar: null, valores: {} },
    });
    expect(r.periodos[1]).toEqual({
      periodo: '2026-09', disponibilidad: { ventasRcv: true, comprasRcv: false, f29: false, propuestaF29: false, bheRecibidas: false },
      frescura: { rcv: T_SEMBRADO, f29: null, propuesta: null, bhe: null }, ventas: 0, compras: null, ivaDebito: 0, ivaCredito: null,
      f29: { consultado: false, presentado: null, folio: null, estado: null, totalAPagar: null, valores: {} },
    });
    expect(r.totales).toEqual({
      ventas: { monto: 0, mesesConDatos: 2, mesesSinDatos: 0 },
      compras: { monto: 0, mesesConDatos: 1, mesesSinDatos: 1 },
      ivaDebito: { monto: 0, mesesConDatos: 2, mesesSinDatos: 0 },
      ivaCredito: { monto: 0, mesesConDatos: 1, mesesSinDatos: 1 },
      f29: { monto: null, mesesConDatos: 0, mesesSinDatos: 2 },
    });
  });

  it('usa la declaración y los valores vigentes del F29, aislados por RUT', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', {
      declaraciones: [
        declaracion({ folio: 101, totalAPagar: 123_450, fechaPresentacion: '2026-10-10' }),
        declaracion({ folio: 999, estado: 'Rectificada', totalAPagar: 999_000, fechaPresentacion: '2026-10-20' }),
        declaracion({ folio: 0, estado: 'Guardada', totalAPagar: 888_000, fechaPresentacion: null }),
      ],
      valores: [valores({ '538': 159_600, '537': 31_350, '91': 123_450 }, { folio: 101 }), valores({ '91': 999_000 }, { folio: 999 })],
    });
    store.guardarContribuyente(perfilPersona());
    sembrarMes(store, '2026-09', { declaraciones: [declaracion({ totalAPagar: 5_000_000 })], valores: [valores({ '91': 5_000_000 })] }, RUT_PERSONA);

    const r = panorama(deps, RUT_EMPRESA);

    expect(r.periodos[0]?.f29).toEqual({
      consultado: true, presentado: true, folio: 101, estado: 'Vigente', totalAPagar: 123_450,
      valores: { '538': 159_600, '537': 31_350, '91': 123_450 },
    });
    expect(r.totales.f29).toEqual({ monto: 123_450, mesesConDatos: 1, mesesSinDatos: 0 });
  });

  it('mantiene desconocido el importe de F29 consultados sin monto y cuenta un cero conocido', () => {
    const { deps, store } = conEmpresa();
    for (const [periodo, totalAPagar] of [['2026-08', null], ['2026-09', 0]] as const) {
      const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f29', periodo, T_SEMBRADO);
      store.guardarF29(id, RUT_EMPRESA, periodo, [declaracion({ periodo, totalAPagar })], [], T_SEMBRADO);
      store.terminarSincronizacion(id, T_SEMBRADO, 'ok');
    }

    const r = panorama(deps, RUT_EMPRESA);

    expect(r.periodos.map((p) => [p.ventas, p.compras, p.ivaDebito, p.ivaCredito, p.f29.consultado, p.f29.presentado, p.f29.totalAPagar])).toEqual([
      [null, null, null, null, true, true, null],
      [null, null, null, null, true, true, 0],
    ]);
    expect(r.totales.f29).toEqual({ monto: 0, mesesConDatos: 1, mesesSinDatos: 1 });
    expect(r.totales.ventas).toEqual({ monto: null, mesesConDatos: 0, mesesSinDatos: 2 });
  });

  it('devuelve totales desconocidos sin meses almacenados', () => {
    const { deps } = conEmpresa();
    const r = panorama(deps, RUT_EMPRESA);
    expect(r.periodos).toEqual([]);
    expect(Object.values(r.totales)).toEqual(Array(5).fill({ monto: null, mesesConDatos: 0, mesesSinDatos: 0 }));
  });

  it('no abre el SII, no lee documentos ni snapshots y no escribe hallazgos ni otros datos', () => {
    const { deps, store, db, sii, persistidos, diagnosticos } = conEmpresa();
    sembrarMes(store, '2026-09', { resumenes: [resumen()], documentos: [documento()], declaraciones: [declaracion()] });
    const abrirSii = vi.spyOn(deps, 'abrirSii');
    const antes = db.prepare('SELECT total_changes() AS n').get();
    const medicion = medirLecturas(db);

    panorama({ ...deps, store: new SqliteStore(medicion.db) }, RUT_EMPRESA);

    expect(abrirSii).not.toHaveBeenCalled();
    expect(sii.llamadas).toEqual([]);
    expect(medicion.lecturas.filter((l) => /\brcv_documento(?:_snapshot)?\b/i.test(l.sql))).toEqual([]);
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(antes);
    expect(store.hallazgos(RUT_EMPRESA)).toEqual([]);
    expect(persistidos).toEqual([]);
    expect(diagnosticos).toEqual([]);
  });

  it('exige un perfil existente', () => {
    const { deps } = depsDePrueba();
    expect(() => panorama(deps, RUT_EMPRESA)).toThrow(expect.objectContaining({ codigo: 'PERFIL_NO_EXISTE' }));
  });
});

describe('panorama: cuenta del SII', () => {
  it('no trae el bloque cuenta si no se ha leído, y lo trae aparte del perfil si se leyó', () => {
    const { deps, store } = conEmpresa();
    expect('cuenta' in panorama(deps, RUT_EMPRESA)).toBe(false);

    store.guardarPerfilTributario(RUT_EMPRESA, perfilTributario({ autorizadoDia20: false }), T_SEMBRADO);
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'cuenta.empresas', '', T_SEMBRADO);
    store.reemplazarEmpresasAutorizadas(id, RUT_EMPRESA, [empresaAutorizada()], T_SEMBRADO);
    store.terminarSincronizacion(id, T_SEMBRADO, 'ok');

    const r = panorama(deps, RUT_EMPRESA);
    expect(r.perfil).toEqual(perfilEmpresa());
    expect(r.cuenta).toMatchObject({ autorizadoDia20: false, obtenidoEn: T_SEMBRADO, empresas: [{ rut: '33333333-3', activa: true }] });
    expect(r.periodos).toEqual([]);
  });
});

describe('panorama: renta F22', () => {
  it('no trae el bloque renta si no hay F22 guardado; si lo hay, uno por año con vigente, conclusión y observaciones', () => {
    const { deps, store } = conEmpresa();
    expect('renta' in panorama(deps, RUT_EMPRESA)).toBe(false);

    for (const anio of [2025, 2026]) {
      const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f22', `AT${anio}`, T_SEMBRADO);
      store.reemplazarF22Declaraciones(id, RUT_EMPRESA, anio, [declaracionF22({ anioTributario: anio, folio: anio })], T_SEMBRADO);
      store.terminarSincronizacion(id, T_SEMBRADO, 'ok');
    }
    store.reemplazarF22Detalle(RUT_EMPRESA, 2026, 2026, detalleF22());

    const r = panorama(deps, RUT_EMPRESA);
    expect(r.renta).toEqual([
      { anioTributario: 2026, folio: 2026, vigente: true, conclusion: 'Conclusión ficticia: declaración sin observaciones', observaciones: [{ codigo: 'A01', descripcion: 'Observación ficticia' }] },
      { anioTributario: 2025, folio: 2025, vigente: true, conclusion: 'Conclusión ficticia: declaración sin observaciones', observaciones: [] },
    ]);
    expect(r.periodos).toEqual([]);
  });

  it('un año que solo tiene boletas de honorarios emitidas guardadas no aparece como renta (no hay F22)', () => {
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilPersona());
    const id = store.iniciarSincronizacion(RUT_PERSONA, 'bhe.emitidas', 'AT2027', T_SEMBRADO);
    store.reemplazarBheEmitidas(id, RUT_PERSONA, 2026, informeBheEmitidas(2026, { 1: { bruto: 100_000, vigentes: 1 } }).meses, T_SEMBRADO);
    store.terminarSincronizacion(id, T_SEMBRADO, 'ok');

    expect('renta' in panorama(deps, RUT_PERSONA)).toBe(false);
  });
});
