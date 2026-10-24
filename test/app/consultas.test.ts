import { describe, expect, it } from 'vitest';
import { documentos, f29Historial, hallazgos, plazos, resumenIva } from '../../src/app/consultas.js';
import { sincronizar } from '../../src/app/sincronizar.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { textoResumenIva } from '../../src/interfaces/formato.js';
import { codigoDe } from '../helpers/errores.js';
import { declaracion, documento, fila, perfilEmpresa, resumen, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { depsDePrueba } from '../helpers/deps.js';
import { sembrarMes, T_SEMBRADO, type DatosMes } from '../helpers/sembrar.js';

const SEPT: DatosMes = {
  resumenes: [
    resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000, 2)] }),
    resumen({ lado: 'COMPRA', filas: [fila(33, 100_000, 19_000, 1)] }),
    resumen({ lado: 'COMPRA', estado: 'PENDIENTE', filas: [fila(33, 50_000, 9_500, 1)] }),
  ],
  declaraciones: [declaracion()],
  valores: [valores({ '538': 190_000, '537': 24_000, '504': 5_000, '77': 0, '91': 166_000 })],
};
const AGO: DatosMes = {
  declaraciones: [declaracion({ periodo: '2026-08', folio: 554_000 })],
  valores: [valores({ '77': 5_000 }, { periodo: '2026-08', folio: 554_000 })],
};

function conEmpresa() {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilEmpresa());
  return p;
}

describe('resumenIva', () => {
  it('sólo F29 no compara RCV desconocido con cero y comunica las fuentes faltantes', async () => {
    const { deps, sii } = conEmpresa();
    sii.declaraciones.set('2026-09', [declaracion()]);
    sii.valores.set('2026-09|555001', valores({ '538': 19_000, '537': 19_000 }));
    await sincronizar(deps, RUT_EMPRESA, parsePeriodo('2026-09'), parsePeriodo('2026-09'), ['f29']);
    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');
    expect(r.hallazgos).toEqual([]);
    expect(r.comparaciones).toMatchObject({ debitoRcv: null, creditoRcv: null });
    expect(r.ventas.debito).toBeNull();
    expect(r.compras.credito).toBeNull();
    expect(r.disponibilidad).toEqual({ ventasRcv: false, comprasRcv: false, f29: true });
    expect(textoResumenIva(r)).toContain('Falta sincronizar: ventas RCV, compras RCV');
    expect(textoResumenIva(r)).toContain('sin dato');
  });

  it('sólo RCV no afirma F29 faltante hasta consultarlo, incluso vacío', async () => {
    const { deps } = conEmpresa();
    const sept = parsePeriodo('2026-09');
    await sincronizar(deps, RUT_EMPRESA, sept, sept, ['rcv']);
    const r = resumenIva(deps, RUT_EMPRESA, sept.texto);
    expect(r.hallazgos).toEqual([]);
    expect(r.comparaciones).toMatchObject({ debitoRcv: 0, creditoRcv: 0 });
    expect(r.disponibilidad).toEqual({ ventasRcv: true, comprasRcv: true, f29: false });
    expect(textoResumenIva(r)).toContain('Falta sincronizar: F29');
    expect(textoResumenIva(r)).not.toContain('no presentado');
    await sincronizar(deps, RUT_EMPRESA, sept, sept, ['f29']);
    expect(resumenIva(deps, RUT_EMPRESA, sept.texto).hallazgos.map((h) => h.regla)).toEqual(['IVA-04']);
    expect(textoResumenIva(resumenIva(deps, RUT_EMPRESA, sept.texto))).toContain('no presentado');
  });

  it('distingue ventas conocidas vacías de compras cuyo intento falló', async () => {
    const { deps, sii } = conEmpresa();
    sii.resumenes.set('2026-09|COMPRA|REGISTRO', [fila(33, 100_000, 19_000)]);
    sii.declaraciones.set('2026-09', [declaracion()]);
    sii.valores.set('2026-09|555001', valores({ '538': 19_000, '537': 19_000 }));
    await sincronizar(deps, RUT_EMPRESA, parsePeriodo('2026-09'), parsePeriodo('2026-09'));
    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');
    expect(r.disponibilidad).toEqual({ ventasRcv: true, comprasRcv: false, f29: true });
    expect(r.comparaciones).toMatchObject({ debitoRcv: 0, creditoRcv: null });
    expect(r.hallazgos.map((h) => h.regla)).toEqual(['IVA-01']);
  });
  it('resume el primer período admitido sin remanente anterior', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2000-01');
    const r = resumenIva(deps, RUT_EMPRESA, '2000-01');
    expect(r.periodo).toBe('2000-01');
    expect(r.comparaciones.remanenteAnterior77).toBeNull();
    expect(r.hallazgos.map((h) => h.regla)).toEqual(['IVA-04']);
  });

  it('resume un mes cuadrado sin hallazgos', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-08', AGO);
    sembrarMes(store, '2026-09', SEPT);
    const r = resumenIva(deps, '22.222.222-2', '2026-09');
    expect(r.ventas.debito).toBe(190_000);
    expect(r.compras).toMatchObject({ credito: 19_000, pendientes: 1, reclamados: 0 });
    expect(r.f29).toMatchObject({ folio: 555_001, estado: 'Vigente', totalAPagar: 171_000 });
    expect(r.venceF29).toBe('2026-10-20');
    expect(r.comparaciones.creditoF29).toBe(19_000);
    expect(r.hallazgos).toEqual([]);
    expect(r.frescura).toEqual({ rcv: T_SEMBRADO, f29: T_SEMBRADO });
  });

  it('guarda los hallazgos que encuentra', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-08', AGO);
    sembrarMes(store, '2026-09', { ...SEPT, valores: [valores({ '538': 200_000, '537': 24_000, '504': 5_000 })] });
    expect(resumenIva(deps, RUT_EMPRESA, '2026-09').hallazgos.map((h) => h.regla)).toEqual(['IVA-01']);
    expect(store.hallazgos(RUT_EMPRESA).map((h) => h.regla)).toEqual(['IVA-01']);
  });

  it('exige un perfil existente', async () => {
    const { deps } = depsDePrueba();
    expect(await codigoDe(Promise.resolve().then(() => resumenIva(deps, RUT_EMPRESA, '2026-09')))).toBe('PERFIL_NO_EXISTE');
  });
});

describe('hallazgos', () => {
  it('normaliza los dos extremos compactos para cálculo y lectura', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-08');
    sembrarMes(store, '2026-09');
    expect(hallazgos(deps, RUT_EMPRESA, { desde: '202609', hasta: '202609' }).map((h) => h.periodo)).toEqual(['2026-09']);
    expect(store.hallazgos(RUT_EMPRESA).map((h) => h.periodo)).toEqual(['2026-09']);
  });

  it.each([{ desde: '2026-13' }, { hasta: '2026-13' }, { desde: '202610', hasta: '2026-09' }, { desde: '' }])('rechaza filtro inválido antes de leer o recalcular: %j', async (filtro) => {
    const { deps, store, db } = conEmpresa();
    sembrarMes(store, '2026-09');
    const antes = db.prepare('SELECT total_changes() AS n').get();
    expect(await codigoDe(Promise.resolve().then(() => hallazgos(deps, RUT_EMPRESA, filtro)))).toBe('PERIODO_INVALIDO');
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(antes);
    expect(store.hallazgos(RUT_EMPRESA)).toEqual([]);
  });
  it('recalcula y guarda los hallazgos del primer período admitido', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2000-01');
    const resultado = hallazgos(deps, RUT_EMPRESA);
    expect(resultado.map((h) => `${h.periodo}:${h.regla}`)).toEqual(['2000-01:IVA-04']);
    expect(store.hallazgos(RUT_EMPRESA)).toEqual(resultado);
  });

  it('recalcula todos los períodos con datos dentro del filtro', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-08', { declaraciones: [] });
    sembrarMes(store, '2026-09', SEPT);
    expect(hallazgos(deps, RUT_EMPRESA).map((h) => `${h.periodo}:${h.regla}`)).toEqual(['2026-08:IVA-04']);
    expect(hallazgos(deps, RUT_EMPRESA, { desde: '2026-09' })).toEqual([]);
  });
});

describe('plazos', () => {
  it('lista el F29 vencido y las facturas por reclamar, ordenados por fecha', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', { resumenes: [resumen()], declaraciones: [] });
    sembrarMes(store, '2026-10', { documentos: [documento({ periodo: '2026-10', estado: 'PENDIENTE', folio: 77, fechaRecepcion: '2026-10-19 08:00:00' })], sinF29: true });
    expect(plazos(deps, RUT_EMPRESA)).toEqual([
      { rut: RUT_EMPRESA, tipo: 'F29', vence: '2026-10-20', diasRestantes: -1, descripcion: 'F29 de 2026-09 no presentado (vencido)', referencia: '2026-09' },
      {
        rut: RUT_EMPRESA,
        tipo: 'RECLAMO_FACTURA',
        vence: '2026-10-27',
        diasRestantes: 6,
        descripcion: 'Aceptar o reclamar Factura folio 77 de PROVEEDOR DEMO LTDA ($119.000)',
        referencia: 'COMPRA:33:33333333-3:77',
      },
    ]);
    expect(plazos(deps, RUT_EMPRESA, 3).map((p) => p.tipo)).toEqual(['F29']);
  });

  it('si el mes anterior no se sincronizó lo dice', () => {
    const { deps } = conEmpresa();
    expect(plazos(deps, RUT_EMPRESA)[0]?.descripcion).toContain('sin sincronizar');
  });
});

describe('historial y documentos', () => {
  it('arma el historial F29 por mes', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-08', AGO);
    sembrarMes(store, '2026-09', SEPT);
    const h = f29Historial(deps, RUT_EMPRESA, '2026-08', '2026-10');
    expect(h.map((f) => [f.periodo, f.presentado, f.folio, f.debitos])).toEqual([
      ['2026-08', true, 554_000, null],
      ['2026-09', true, 555_001, 190_000],
      ['2026-10', false, null, null],
    ]);
    expect(h[2]!.sincronizado).toBeNull();
  });

  it('pagina los documentos', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', { documentos: [documento({ folio: 1 }), documento({ folio: 2 }), documento({ folio: 3 })] });
    const p = documentos(deps, RUT_EMPRESA, '2026-09', {}, 2, 2);
    expect(p.total).toBe(3);
    expect(p.documentos.map((d) => d.folio)).toEqual([3]);
  });
});
