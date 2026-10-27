import { describe, expect, it } from 'vitest';
import { conservarF29, conservarRcv, sincronizar } from '../../src/app/sincronizar.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { declaracion, documento, fila, perfilEmpresa, resumen, RUT_CLIENTE, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { conLector, depsDePrueba } from '../helpers/deps.js';
import { VERSION_LECTOR_PRUEBA } from '../helpers/lector-falso.js';

const SEPT = parsePeriodo('2026-09');
const VALORES = valores({ '538': 199_500, '537': 19_000, '89': 180_500 });

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

  it('un F29 conservado por respuesta vacía informa el folio vigente guardado, no "sin folio"', async () => {
    const { deps, sii } = await mesGuardado();
    sii.declaraciones.set('2026-09', []);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores.map((e) => e.codigo)).toEqual(['RESPUESTA_VACIA']);
    expect(r.periodos[0]!.f29Folio).toBe(555_001);
  });

  it('un F29 que falla por otra causa no inventa un folio', async () => {
    const { deps, sii } = await mesGuardado();
    sii.fallas.set('f29|2026-09', new ErrorImpuestocl('SII_NO_DISPONIBLE', 'caído'));

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.f29Folio).toBeNull();
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

    // Con otra versión del lector se vuelve a bajar el PDF del folio ya leído.
    const r = await sincronizar(conLector(deps, 'f29-prueba-2'), RUT_EMPRESA, SEPT, SEPT, ['f29']);

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

describe('sincronizar ante un F29 leído que no cuadra', () => {
  const INCOHERENTE = valores({ '538': 199_500, '537': 19_000, '89': 5_000 });

  /** Otra versión del lector: obliga a bajar de nuevo el PDF del folio ya leído y coherente. */
  const LECTOR_NUEVO = 'f29-prueba-2';

  it('una lectura incoherente del mismo folio no reemplaza una coherente: queda LECTURA_INCOHERENTE y un diagnóstico', async () => {
    const { deps, store, sii, db, diagnosticos } = await mesGuardado();
    const lectura = store.lecturaF29(RUT_EMPRESA, SEPT.texto, 555_001);
    sii.valores.set('2026-09|555001', INCOHERENTE);

    const r = await sincronizar(conLector(deps, LECTOR_NUEVO), RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores).toHaveLength(1);
    expect(r.periodos[0]!.errores[0]).toMatchObject({ superficie: 'f29.valores', codigo: 'LECTURA_INCOHERENTE' });
    expect(r.periodos[0]!.errores[0]!.mensaje).toContain('555001');
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(VALORES);
    expect(ultimaSync(db, 'f29.valores')).toEqual({ estado: 'error', error_codigo: 'LECTURA_INCOHERENTE' });
    expect(diagnosticos.map((d) => d.nombre)).toEqual(['22222222-2-2026-09-f29.valores.json']);
    const diagnostico = JSON.parse(diagnosticos[0]!.contenido);
    expect(diagnostico.error.codigo).toBe('LECTURA_INCOHERENTE');
    expect(diagnostico.detalle.valoresNuevos).toEqual(INCOHERENTE.valores);
    expect(store.lecturaF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(lectura);
  });

  it('una lectura nueva sin 538/537 legibles tampoco reemplaza una coherente', async () => {
    const { deps, store, sii } = await mesGuardado();
    // 538 sin dato: viene su línea 502 sin el total (lectura fallida), así que el autocontrol no aplica.
    sii.valores.set('2026-09|555001', valores({ '502': 199_500, '537': 19_000, '89': 5 }));

    const r = await sincronizar(conLector(deps, LECTOR_NUEVO), RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores).toHaveLength(1);
    expect(r.periodos[0]!.errores[0]).toMatchObject({ superficie: 'f29.valores', codigo: 'LECTURA_INCOHERENTE' });
    expect(r.periodos[0]!.errores[0]!.mensaje).toContain('538');
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(VALORES);
  });

  it('una lectura nueva que perdió el bloque de totales (sin 538 ni 537) no reemplaza la guardada que sí los traía', async () => {
    const { deps, store, sii, db } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sii.declaraciones.set('2026-09', [declaracion()]);
    const completos = valores({ '538': 199_500, '537': 19_000, '89': 180_500, '547': 180_500, '91': 180_500 });
    sii.valores.set('2026-09|555001', completos);
    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);
    sii.valores.set('2026-09|555001', valores({ '547': 180_500, '91': 180_500 }));

    const r = await sincronizar(conLector(deps, LECTOR_NUEVO), RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores).toHaveLength(1);
    expect(r.periodos[0]!.errores[0]).toMatchObject({ superficie: 'f29.valores', codigo: 'LECTURA_INCOHERENTE' });
    expect(r.periodos[0]!.errores[0]!.mensaje).toMatch(/538.*537.*lectura guardada/);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(completos);
    expect(ultimaSync(db, 'f29.valores')).toEqual({ estado: 'error', error_codigo: 'LECTURA_INCOHERENTE' });
  });

  it('avisa cuando guarda una lectura que no se puede verificar (sin 538/537 legibles)', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sii.declaraciones.set('2026-09', [declaracion()]);
    sii.valores.set('2026-09|555001', valores({ '502': 199_500, '537': 19_000, '89': 5 }));

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(r.periodos[0]!.avisos).toEqual(['F29 2026-09: la lectura no trae el 538 y el 537 legibles para verificarla']);
  });

  it('una lectura guardada sin 538/537 legibles no cuenta como coherente: la nueva incoherente la reemplaza con aviso', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sii.declaraciones.set('2026-09', [declaracion()]);
    sii.valores.set('2026-09|555001', valores({ '502': 199_500, '537': 19_000, '89': 5 }));
    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);
    expect(store.lecturaF29(RUT_EMPRESA, SEPT.texto, 555_001)?.coherente).toBe(false);
    sii.valores.set('2026-09|555001', INCOHERENTE);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(r.periodos[0]!.avisos).toHaveLength(1);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(INCOHERENTE);
  });

  it('sin lectura coherente guardada, la incoherente se guarda y avisa en el período', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sii.declaraciones.set('2026-09', [declaracion()]);
    sii.valores.set('2026-09|555001', INCOHERENTE);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(r.periodos[0]!.avisos).toHaveLength(1);
    expect(r.periodos[0]!.avisos[0]).toMatch(/^F29 2026-09: la lectura no cuadra \(el 89 /);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(INCOHERENTE);
  });

  it('una lectura coherente nueva reemplaza sin aviso, y una incoherente sobre otra incoherente también reemplaza', async () => {
    const { deps, store, sii } = await mesGuardado();
    const otra = valores({ '538': 199_500, '537': 19_000, '89': 180_500, '504': 3 });
    sii.valores.set('2026-09|555001', otra);
    const r1 = await sincronizar(conLector(deps, LECTOR_NUEVO), RUT_EMPRESA, SEPT, SEPT, ['f29']);
    expect(r1.periodos[0]!.errores).toEqual([]);
    expect(r1.periodos[0]!.avisos).toEqual([]);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(otra);

    store.guardarF29(store.iniciarSincronizacion(RUT_EMPRESA, 'f29', SEPT.texto, 't'), RUT_EMPRESA, SEPT.texto, [declaracion()], [INCOHERENTE], 't');
    const peor = valores({ '538': 199_500, '537': 19_000, '89': 7 });
    sii.valores.set('2026-09|555001', peor);
    const r2 = await sincronizar(conLector(deps, 'f29-prueba-3'), RUT_EMPRESA, SEPT, SEPT, ['f29']);
    expect(r2.periodos[0]!.errores).toEqual([]);
    expect(r2.periodos[0]!.avisos).toHaveLength(1);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(peor);
  });
});

describe('sincronizar y la lectura guardada del F29', () => {
  it('registra la lectura del folio vigente: versión del lector, origen, cantidad de códigos y si es coherente', async () => {
    const { store } = await mesGuardado();
    expect(store.lecturaF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual({
      versionLector: VERSION_LECTOR_PRUEBA,
      origen: 'sincronizacion',
      leidoEn: '2026-10-21T15:00:00.000Z',
      codigos: 3,
      coherente: true,
    });
  });

  it('no vuelve a bajar el PDF de un folio ya leído coherente con la misma versión del lector', async () => {
    const { deps, store, sii, db } = await mesGuardado();
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM sincronizacion WHERE superficie = 'f29.valores'").get() as { n: number };

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.periodos[0]).toMatchObject({ errores: [], avisos: [], f29Folio: 555_001 });
    expect(sii.llamadas).toEqual(['f29|2026-09']);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(VALORES);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sincronizacion WHERE superficie = 'f29.valores'").get()).toEqual({ n });
    expect(store.lecturaF29(RUT_EMPRESA, SEPT.texto, 555_001)?.versionLector).toBe(VERSION_LECTOR_PRUEBA);
  });

  it('vuelve a bajar el PDF si cambió la versión del lector y registra la nueva', async () => {
    const { deps, store, sii } = await mesGuardado();

    await sincronizar(conLector(deps, 'f29-prueba-2'), RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(sii.llamadas).toEqual(['f29|2026-09', 'f29valores|2026-09|555001']);
    expect(store.lecturaF29(RUT_EMPRESA, SEPT.texto, 555_001)).toMatchObject({ versionLector: 'f29-prueba-2', coherente: true });
  });

  it('vuelve a bajar el PDF si los valores guardados del folio ya no son confiables aunque la lectura diga coherente', async () => {
    const { deps, store, sii } = await mesGuardado();
    // Valores reemplazados por otro camino: f29_lectura sigue diciendo coherente con la misma versión.
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f29', SEPT.texto, 't');
    store.guardarF29(id, RUT_EMPRESA, SEPT.texto, [declaracion()], [valores({ '538': 199_500, '537': 19_000, '89': 5_000 })], 't');
    expect(store.lecturaF29(RUT_EMPRESA, SEPT.texto, 555_001)).toMatchObject({ versionLector: VERSION_LECTOR_PRUEBA, coherente: true });

    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(sii.llamadas).toEqual(['f29|2026-09', 'f29valores|2026-09|555001']);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(VALORES);
  });

  it('vuelve a bajar el PDF si la lectura guardada no era coherente', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sii.declaraciones.set('2026-09', [declaracion()]);
    sii.valores.set('2026-09|555001', valores({ '538': 199_500, '537': 19_000, '89': 5_000 }));
    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);
    expect(store.lecturaF29(RUT_EMPRESA, SEPT.texto, 555_001)?.coherente).toBe(false);
    sii.valores.set('2026-09|555001', VALORES);
    sii.llamadas.length = 0;

    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(sii.llamadas).toEqual(['f29|2026-09', 'f29valores|2026-09|555001']);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(VALORES);
    expect(store.lecturaF29(RUT_EMPRESA, SEPT.texto, 555_001)?.coherente).toBe(true);
  });
});
