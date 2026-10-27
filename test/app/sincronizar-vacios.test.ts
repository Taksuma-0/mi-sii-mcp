import { describe, expect, it } from 'vitest';
import { conservarF29, conservarRcv, sincronizar } from '../../src/app/sincronizar.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { declaracion, documento, fila, perfilEmpresa, resumen, RUT_CLIENTE, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { depsDePrueba } from '../helpers/deps.js';

const SEPT = parsePeriodo('2026-09');
const VALORES = valores({ '538': 199_500, '537': 19_000 });

/** Un mes ya sincronizado una vez: ventas y compras con documentos, y el F29 presentado con sus valores. */
async function mesGuardado() {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilEmpresa());
  p.sii.resumenes.set('2026-09|VENTA|REGISTRO', [fila(33, 1_000_000, 190_000, 1)]);
  p.sii.detalles.set('2026-09|VENTA|REGISTRO|33', [documento({ lado: 'VENTA', rutContraparte: RUT_CLIENTE, folio: 1 })]);
  p.sii.resumenes.set('2026-09|COMPRA|REGISTRO', [fila(33, 100_000, 19_000, 1)]);
  p.sii.detalles.set('2026-09|COMPRA|REGISTRO|33', [documento({ folio: 10 })]);
  p.sii.resumenes.set('2026-09|COMPRA|PENDIENTE', [fila(33, 50_000, 9_500, 1)]);
  p.sii.detalles.set('2026-09|COMPRA|PENDIENTE|33', [documento({ folio: 11, estado: 'PENDIENTE' })]);
  p.sii.declaraciones.set('2026-09', [declaracion()]);
  p.sii.valores.set('2026-09|555001', VALORES);
  const r = await sincronizar(p.deps, RUT_EMPRESA, SEPT, SEPT);
  expect(r.periodos[0]!.errores).toEqual([]);
  p.sii.llamadas.length = 0;
  return p;
}

const ultimaSync = (db: ReturnType<typeof depsDePrueba>['db'], superficie: string) =>
  db.prepare('SELECT estado, error_codigo FROM sincronizacion WHERE superficie = ? ORDER BY id DESC LIMIT 1').get(superficie);

describe('conservarRcv', () => {
  const vacio = (o: { sinMovimientos?: true } = {}) => resumen({ lado: 'COMPRA', filas: [], ...o });

  it.each([
    ['reemplaza si algún estado trae filas', [resumen({ lado: 'COMPRA' }), vacio()], true, false],
    ['reemplaza si todos los vacíos son "sin movimientos" explícito', [vacio({ sinMovimientos: true }), vacio({ sinMovimientos: true })], true, false],
    ['reemplaza si no había nada guardado de ese lado', [vacio(), vacio()], false, false],
    ['conserva ante un vacío ambiguo con datos guardados', [vacio({ sinMovimientos: true }), vacio()], true, true],
  ] as const)('%s', (_caso, nuevos, guardadoTieneDatos, esperado) => {
    expect(conservarRcv(nuevos, guardadoTieneDatos)).toBe(esperado);
  });
});

describe('conservarF29', () => {
  const borrador = declaracion({ folio: 0, estado: 'Guardada', estadoId: 10, codigoInterno: null, fechaPresentacion: null });

  it.each([
    ['conserva si el listado nuevo viene vacío y había un folio presentado', [], [declaracion()], true],
    ['conserva si el listado nuevo solo trae un borrador y había un folio presentado', [borrador], [declaracion()], true],
    ['reemplaza con una rectificatoria: el listado nuevo trae otro folio presentado', [declaracion({ folio: 555_002 })], [declaracion()], false],
    ['reemplaza ante un cambio de estado del mismo folio', [declaracion({ estado: 'Rechazada por pago inconcluso', estadoId: 70 })], [declaracion()], false],
    ['reemplaza si solo había un borrador guardado', [], [borrador], false],
    ['reemplaza si no había nada guardado', [], [], false],
  ] as const)('%s', (_caso, nuevas, guardadas, esperado) => {
    expect(conservarF29(nuevas, guardadas)).toBe(esperado);
  });
});

describe('sincronizar ante respuestas vacías del RCV', () => {
  it('un lado con algún estado con filas se reemplaza aunque otro estado venga vacío sin marca', async () => {
    const { deps, store, sii } = await mesGuardado();
    sii.vaciosAmbiguos = true;
    sii.detalles.set('2026-09|COMPRA|REGISTRO|33', [documento({ folio: 20 })]);
    sii.resumenes.set('2026-09|COMPRA|PENDIENTE', []);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['rcv']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(store.documentosRcv(RUT_EMPRESA, SEPT.texto, { lado: 'COMPRA' }).map((d) => d.folio)).toEqual([20]);
  });

  it('un lado vacío con "sin movimientos" explícito en todos sus estados se reemplaza sin error', async () => {
    const { deps, store, sii, db } = await mesGuardado();
    sii.resumenes.set('2026-09|VENTA|REGISTRO', []);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['rcv']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(store.documentosRcv(RUT_EMPRESA, SEPT.texto, { lado: 'VENTA' })).toEqual([]);
    expect(ultimaSync(db, 'rcv.VENTA')).toEqual({ estado: 'ok', error_codigo: null });
  });

  it('un lado vacío sin marca se guarda si no había nada guardado de ese lado', async () => {
    const { deps, store, sii, db } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sii.vaciosAmbiguos = true;

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['rcv']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(ultimaSync(db, 'rcv.VENTA')).toEqual({ estado: 'ok', error_codigo: null });
    expect(store.frescura(RUT_EMPRESA, SEPT.texto).rcv).not.toBeNull();
  });

  it('un lado vacío sin marca con datos guardados conserva lo guardado y queda RESPUESTA_VACIA', async () => {
    const { deps, store, sii, db } = await mesGuardado();
    const compras = store.resumenesRcv(RUT_EMPRESA, SEPT.texto).filter((x) => x.lado === 'COMPRA');
    const docs = store.documentosRcv(RUT_EMPRESA, SEPT.texto, { lado: 'COMPRA' });
    sii.vaciosAmbiguos = true;
    sii.resumenes.delete('2026-09|COMPRA|REGISTRO');
    sii.resumenes.delete('2026-09|COMPRA|PENDIENTE');

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['rcv']);

    expect(r.periodos[0]!.errores).toEqual([
      { superficie: 'rcv.COMPRA', codigo: 'RESPUESTA_VACIA', mensaje: 'RCV COMPRA 2026-09: el SII respondió vacío sin confirmar que no hay movimientos; se conservan los datos guardados.' },
    ]);
    expect(store.resumenesRcv(RUT_EMPRESA, SEPT.texto).filter((x) => x.lado === 'COMPRA')).toEqual(compras);
    expect(store.documentosRcv(RUT_EMPRESA, SEPT.texto, { lado: 'COMPRA' })).toEqual(docs);
    expect(ultimaSync(db, 'rcv.COMPRA')).toEqual({ estado: 'error', error_codigo: 'RESPUESTA_VACIA' });
    expect(ultimaSync(db, 'rcv.VENTA')).toEqual({ estado: 'ok', error_codigo: null });
  });
});

describe('sincronizar ante respuestas vacías del F29', () => {
  it('si desaparece el folio presentado y no llega otro, conserva lo guardado, queda RESPUESTA_VACIA y no baja el PDF', async () => {
    const { deps, store, sii, db } = await mesGuardado();
    sii.declaraciones.set('2026-09', []);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores).toEqual([
      { superficie: 'f29', codigo: 'RESPUESTA_VACIA', mensaje: 'F29 2026-09: el SII no listó el folio presentado 555001; se conservan las declaraciones guardadas.' },
    ]);
    expect(store.declaracionesF29(RUT_EMPRESA, SEPT.texto)).toEqual([declaracion()]);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(VALORES);
    expect(sii.llamadas).toEqual(['f29|2026-09']);
    expect(ultimaSync(db, 'f29')).toEqual({ estado: 'error', error_codigo: 'RESPUESTA_VACIA' });
  });

  it('si el listado nuevo solo trae un borrador, conserva el folio presentado guardado', async () => {
    const { deps, store, sii } = await mesGuardado();
    sii.declaraciones.set('2026-09', [declaracion({ folio: 0, estado: 'Guardada', estadoId: 10, codigoInterno: null, fechaPresentacion: null })]);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores.map((e) => e.codigo)).toEqual(['RESPUESTA_VACIA']);
    expect(store.declaracionesF29(RUT_EMPRESA, SEPT.texto)).toEqual([declaracion()]);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(VALORES);
  });

  it('una rectificatoria con folio nuevo presentado reemplaza', async () => {
    const { deps, store, sii } = await mesGuardado();
    const rectificatoria = declaracion({ folio: 555_002, codigoInterno: 9002, fechaPresentacion: '2026-10-16' });
    sii.declaraciones.set('2026-09', [rectificatoria]);
    sii.valores.set('2026-09|555002', valores({ '538': 200_000 }, { folio: 555_002 }));

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(r.periodos[0]!.f29Folio).toBe(555_002);
    expect(store.declaracionesF29(RUT_EMPRESA, SEPT.texto)).toEqual([rectificatoria]);
  });

  it('un cambio de estado del mismo folio reemplaza', async () => {
    const { deps, store, sii } = await mesGuardado();
    const rechazada = declaracion({ estado: 'Rechazada por pago inconcluso', estadoId: 70 });
    sii.declaraciones.set('2026-09', [rechazada]);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(r.periodos[0]!.f29Folio).toBeNull();
    expect(store.declaracionesF29(RUT_EMPRESA, SEPT.texto)).toEqual([rechazada]);
  });

  it('un PDF sin códigos legibles conserva los valores guardados y deja diagnóstico', async () => {
    const { deps, store, sii, diagnosticos } = await mesGuardado();
    sii.valores.set('2026-09|555001', valores({}));

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores).toEqual([
      { superficie: 'f29.valores', codigo: 'PORTAL_CAMBIO', mensaje: 'El PDF del F29 de 2026-09 no trajo códigos legibles.' },
    ]);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(VALORES);
    expect(diagnosticos.map((d) => d.nombre)).toEqual(['22222222-2-2026-09-f29.valores.json']);
  });

  it('si solo había un borrador guardado, un listado vacío lo reemplaza', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sii.declaraciones.set('2026-09', [declaracion({ folio: 0, estado: 'Guardada', estadoId: 10, codigoInterno: null, fechaPresentacion: null })]);
    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);
    expect(store.declaracionesF29(RUT_EMPRESA, SEPT.texto)).toHaveLength(1);
    sii.declaraciones.set('2026-09', []);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(store.declaracionesF29(RUT_EMPRESA, SEPT.texto)).toEqual([]);
  });
});
