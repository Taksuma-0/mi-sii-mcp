import { describe, expect, it } from 'vitest';
import { documentos, f29Historial, hallazgos, plazos, resumenIva } from '../../src/app/consultas.js';
import { sincronizar } from '../../src/app/sincronizar.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { textoResumenIva } from '../../src/interfaces/formato.js';
import { codigoDe } from '../helpers/errores.js';
import { declaracion, documento, fila, perfilEmpresa, resumen, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { depsDePrueba } from '../helpers/deps.js';
import { sembrarMes, T_SEMBRADO, type DatosMes } from '../helpers/sembrar.js';
import { medirLecturas } from '../helpers/lecturas-sqlite.js';
import { SqliteStore } from '../../src/store/sqlite/store.js';

const SEPT: DatosMes = {
  resumenes: [
    resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000, 2)] }),
    resumen({ lado: 'COMPRA', filas: [fila(33, 100_000, 19_000, 1)] }),
    resumen({ lado: 'COMPRA', estado: 'PENDIENTE', filas: [fila(33, 50_000, 9_500, 1)] }),
  ],
  declaraciones: [declaracion()],
  valores: [valores({ '538': 190_000, '537': 24_000, '504': 5_000, '89': 166_000, '77': 0, '91': 166_000 })],
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
  it.each([{ declaraciones: [] }, { declaraciones: [declaracion({ fechaPresentacion: null })] }])('omite las fotos cuando IVA-06 no aplica: %j', ({ declaraciones }) => {
    const { deps, store, db } = conEmpresa();
    sembrarMes(store, '2026-09', { declaraciones, documentos: [documento()] });
    const medicion = medirLecturas(db);
    const r = resumenIva({ ...deps, store: new SqliteStore(medicion.db) }, RUT_EMPRESA, '2026-09');
    expect(r.f29?.fechaPresentacion ?? null).toBeNull();
    expect(r.hallazgos.map((h) => h.regla)).not.toContain('IVA-06');
    expect(medicion.lecturas.filter((l) => l.sql.includes('rcv_documento_snapshot'))).toEqual([]);
  });

  it.each([
    ['sin consultar', null],
    ['presentado sin valores leídos', { declaraciones: [declaracion({ periodo: '2026-08', folio: 554_000 })] }],
  ] as const)('con el F29 anterior %s no compara el remanente', (_caso, agosto) => {
    const { deps, store } = conEmpresa();
    if (agosto) sembrarMes(store, '2026-08', agosto);
    sembrarMes(store, '2026-09', SEPT);
    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');
    expect(r.comparaciones).toMatchObject({ remanenteAnterior77: null, remanenteActual504: 5_000 });
    expect(r.hallazgos.map((h) => h.regla)).not.toContain('IVA-03');
  });

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
    expect(r.disponibilidad).toEqual({ ventasRcv: false, comprasRcv: false, f29: true, propuestaF29: false, bheRecibidas: false });
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
    expect(r.disponibilidad).toEqual({ ventasRcv: true, comprasRcv: true, f29: false, propuestaF29: false, bheRecibidas: false });
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
    expect(r.disponibilidad).toEqual({ ventasRcv: true, comprasRcv: false, f29: true, propuestaF29: false, bheRecibidas: false });
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
    expect(r.frescura).toEqual({ rcv: T_SEMBRADO, f29: T_SEMBRADO, propuesta: null, bhe: null });
  });

  it('guarda los hallazgos que encuentra', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-08', AGO);
    sembrarMes(store, '2026-09', { ...SEPT, valores: [valores({ '538': 200_000, '537': 24_000, '504': 5_000, '89': 176_000 })] });
    expect(resumenIva(deps, RUT_EMPRESA, '2026-09').hallazgos.map((h) => h.regla)).toEqual(['IVA-01']);
    expect(store.hallazgos(RUT_EMPRESA).map((h) => h.regla)).toEqual(['IVA-01']);
  });

  it('persiste el hallazgo F29-01 cuando el F29 leído no cuadra', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-08', AGO);
    sembrarMes(store, '2026-09', { ...SEPT, valores: [valores({ '538': 190_000, '537': 24_000, '504': 5_000, '89': 100_000, '77': 0 })] });
    expect(resumenIva(deps, RUT_EMPRESA, '2026-09').hallazgos.map((h) => h.regla)).toEqual(['F29-01']);
    expect(store.hallazgos(RUT_EMPRESA)).toMatchObject([{ regla: 'F29-01', severidad: 'advertencia', naturaleza: 'HECHO', evidencia: ['F29:555001'] }]);
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

  it('si el mes anterior no se sincronizó lo dice sin nombrar un comando (sirve en la CLI y en MCP)', () => {
    const { deps } = conEmpresa();
    expect(plazos(deps, RUT_EMPRESA)[0]?.descripcion).toBe('F29 de 2026-09: sin sincronizar; sincroniza ese mes para confirmar si está presentado');
  });
});

describe('historial y documentos', () => {
  it('recupera sólo 50 documentos de un mes con 250 y conserva total y filtro', () => {
    const { deps, store, db } = conEmpresa();
    const docs = Array.from({ length: 250 }, (_, i) => documento({ folio: 250 - i, estado: 'PENDIENTE' }));
    sembrarMes(store, '2026-09', { documentos: [...docs, documento({ folio: 251 })] });
    const medicion = medirLecturas(db);
    const r = documentos({ ...deps, store: new SqliteStore(medicion.db) }, RUT_EMPRESA, '202609', { estado: 'PENDIENTE' }, 2, 50);
    expect(r).toEqual({ pagina: 2, tamano: 50, total: 250, documentos: [...docs].reverse().slice(50, 100) });
    // Perfil, total y página: la app no recupera los otros 200 documentos.
    expect(medicion.lecturas.reduce((n, l) => n + l.filas, 0)).toBe(52);
    expect(medicion.lecturas).toHaveLength(3);
  });

  it.each([
    [NaN, NaN, 1, 50],
    [Infinity, Infinity, 1, 50],
    [-Infinity, -Infinity, 1, 50],
    [-2, -3, 1, 1],
    [2.9, 300.9, 2, 200],
    [2.9, 2.9, 2, 2],
    [Number.MAX_VALUE, 200, Number.MAX_VALUE, 200],
  ])('normaliza página/tamaño %s/%s a %s/%s sin enviar no finitos a SQLite', (pagina, tamano, p, t) => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', { documentos: [documento()] });
    const r = documentos(deps, RUT_EMPRESA, '2026-09', {}, pagina, tamano);
    expect(r).toMatchObject({ pagina: p, tamano: t, total: 1 });
    expect(r.documentos).toEqual(p === 1 ? [documento()] : []);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('arma el historial F29 por mes', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-07', { declaraciones: [declaracion({ periodo: '2026-07', folio: 553_000 })] });
    sembrarMes(store, '2026-08', AGO);
    sembrarMes(store, '2026-09', SEPT);
    const h = f29Historial(deps, RUT_EMPRESA, '2026-07', '2026-10');
    // Agosto se leyó sin 538 ni 537 (el PDF compacto omite las líneas en cero); julio está presentado sin valores leídos.
    expect(h.map((f) => [f.periodo, f.presentado, f.folio, f.debitos, f.creditos])).toEqual([
      ['2026-07', true, 553_000, null, null],
      ['2026-08', true, 554_000, 0, 0],
      ['2026-09', true, 555_001, 190_000, 24_000],
      ['2026-10', false, null, null, null],
    ]);
    expect(h[3]!.sincronizado).toBeNull();
  });

  it('pagina los documentos', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', { documentos: [documento({ folio: 1 }), documento({ folio: 2 }), documento({ folio: 3 })] });
    const p = documentos(deps, RUT_EMPRESA, '2026-09', {}, 2, 2);
    expect(p.total).toBe(3);
    expect(p.documentos.map((d) => d.folio)).toEqual([3]);
  });
});

describe('filas de períodos anuales y no periódicos', () => {
  it('hallazgos() y plazos() no fallan con sincronizaciones AT2026 y sin período', () => {
    const { deps, store } = conEmpresa();
    sembrarMes(store, '2026-09', SEPT);
    for (const [superficie, periodo] of [['f22', 'AT2026'], ['cuenta.perfil', '']] as const) {
      const id = store.iniciarSincronizacion(RUT_EMPRESA, superficie, periodo, T_SEMBRADO);
      store.terminarSincronizacion(id, T_SEMBRADO, 'ok');
    }
    expect(() => hallazgos(deps, RUT_EMPRESA)).not.toThrow();
    expect(() => plazos(deps, RUT_EMPRESA)).not.toThrow();
    expect(store.periodosConDatos(RUT_EMPRESA)).toEqual(['2026-09']);
  });
});
