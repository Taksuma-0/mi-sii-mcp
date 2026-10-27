import { describe, expect, it } from 'vitest';
import { hallazgos, plazos } from '../../src/app/consultas.js';
import { panorama } from '../../src/app/panorama.js';
import { resumenRenta, sincronizarRenta } from '../../src/app/renta.js';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { codigoDe } from '../helpers/errores.js';
import { depsDePrueba } from '../helpers/deps.js';
import { boletaEmitida, declaracionF22, detalleF22, djTercero, informeBheEmitidas, perfilEmpresa, perfilPersona, RUT_EMPRESA, RUT_PERSONA } from '../helpers/fabricas.js';
import type { DjInformada } from '../../src/domain/tipos.js';

const FOLIO = 123_456_789;

function preparar() {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilEmpresa());
  p.sii.f22.set(2026, [declaracionF22(), declaracionF22({ folio: 98_765_432, vigente: false, codigoConclusion: '11', conclusion: 'Conclusión ficticia: rectificada' })]);
  p.sii.f22Detalles.set(`2026|${FOLIO}`, detalleF22());
  return p;
}

const bitacora = (db: ReturnType<typeof depsDePrueba>['db']) => db.prepare('SELECT superficie, periodo, estado, error_codigo FROM sincronizacion ORDER BY id').all();

describe('sincronizarRenta', () => {
  it('guarda las declaraciones del año y el detalle del folio vigente, con registros f22 y f22.folio en AT<AAAA>', async () => {
    const { deps, store, sii, db } = preparar();

    const r = await sincronizarRenta(deps, '22.222.222-2', '2026');

    expect(sii.llamadas).toEqual(['f22|2026', `f22detalle|2026|${FOLIO}`, 'terceros|2026']);
    expect(r).toEqual({ rut: RUT_EMPRESA, anios: [{ anioTributario: 2026, declaraciones: 2, folioVigente: FOLIO, detalle: 'leido', boletasEmitidas: null, detalleBoletas: null, terceros: { informadas: 0, leidas: 0, filas: 0 }, errores: [] }], abortado: null });
    expect(store.declaracionesF22(RUT_EMPRESA, 2026).map((d) => d.folio)).toEqual([98_765_432, FOLIO]);
    expect(store.detalleF22(RUT_EMPRESA, 2026, FOLIO).valores).toHaveLength(3);
    expect(bitacora(db)).toEqual([
      { superficie: 'f22', periodo: 'AT2026', estado: 'ok', error_codigo: null },
      { superficie: 'f22.folio', periodo: 'AT2026', estado: 'ok', error_codigo: null },
      { superficie: 'terceros', periodo: 'AT2026', estado: 'ok', error_codigo: null },
    ]);
  });

  it('recorre el rango de años en orden; un año sin declaraciones queda ok y sin detalle', async () => {
    const { deps, sii } = preparar();

    const r = await sincronizarRenta(deps, RUT_EMPRESA, '2024', '2026');

    expect(sii.llamadas).toEqual(['f22|2024', 'terceros|2024', 'f22|2025', 'terceros|2025', 'f22|2026', `f22detalle|2026|${FOLIO}`, 'terceros|2026']);
    expect(r.anios.map((a) => [a.anioTributario, a.declaraciones, a.detalle])).toEqual([
      [2024, 0, 'sin_vigente'],
      [2025, 0, 'sin_vigente'],
      [2026, 2, 'leido'],
    ]);
  });

  it('rechaza años inválidos, un rango invertido o de más de 10 años antes de ir al SII', async () => {
    const { deps, sii } = preparar();
    expect(await codigoDe(sincronizarRenta(deps, RUT_EMPRESA, '2026-04'))).toBe('PERIODO_INVALIDO');
    expect(await codigoDe(sincronizarRenta(deps, RUT_EMPRESA, '2026', '2025'))).toBe('PERIODO_INVALIDO');
    expect(await codigoDe(sincronizarRenta(deps, RUT_EMPRESA, '2016', '2026'))).toBe('PERIODO_INVALIDO');
    expect((await sincronizarRenta(deps, RUT_EMPRESA, '2017', '2026')).anios).toHaveLength(10);
    sii.llamadas.length = 0;
    const sinPerfil = depsDePrueba();
    expect(await codigoDe(sincronizarRenta(sinPerfil.deps, RUT_EMPRESA, '2026'))).toBe('PERFIL_NO_EXISTE');
    expect(sinPerfil.sii.llamadas).toEqual([]);
  });

  it('si el SII responde sin declaraciones y había guardadas, las conserva con RESPUESTA_VACIA', async () => {
    const { deps, store, sii, db } = preparar();
    await sincronizarRenta(deps, RUT_EMPRESA, '2026');
    sii.f22.set(2026, []);

    const r = await sincronizarRenta(deps, RUT_EMPRESA, '2026');

    expect(r.anios[0]).toMatchObject({ declaraciones: null, folioVigente: null, detalle: 'sin_leer', errores: [{ superficie: 'f22', codigo: 'RESPUESTA_VACIA' }] });
    expect(store.declaracionesF22(RUT_EMPRESA, 2026)).toHaveLength(2);
    expect(store.detalleF22(RUT_EMPRESA, 2026, FOLIO).valores).toHaveLength(3);
    expect(bitacora(db).at(-2)).toEqual({ superficie: 'f22', periodo: 'AT2026', estado: 'error', error_codigo: 'RESPUESTA_VACIA' });
  });

  it('un detalle sin códigos no reemplaza al guardado y queda como RESPUESTA_VACIA', async () => {
    const { deps, store, sii } = preparar();
    await sincronizarRenta(deps, RUT_EMPRESA, '2026');
    sii.f22Detalles.set(`2026|${FOLIO}`, { valores: [], observaciones: [], eventos: [] });

    const r = await sincronizarRenta(deps, RUT_EMPRESA, '2026');

    expect(r.anios[0]).toMatchObject({ declaraciones: 2, folioVigente: FOLIO, detalle: 'sin_leer', errores: [{ superficie: 'f22.folio', codigo: 'RESPUESTA_VACIA' }] });
    expect(store.detalleF22(RUT_EMPRESA, 2026, FOLIO).valores).toHaveLength(3);
  });

  it('si falla el detalle, las declaraciones quedan guardadas y el error en su superficie; sigue con el año siguiente', async () => {
    const { deps, store, sii } = preparar();
    sii.f22.set(2025, [declaracionF22({ anioTributario: 2025, folio: 7 })]);
    sii.fallas.set('f22detalle|2025|7', new ErrorImpuestocl('PORTAL_CAMBIO', 'El F22 cambió.'));

    const r = await sincronizarRenta(deps, RUT_EMPRESA, '2025', '2026');

    expect(r.anios[0]).toEqual({ anioTributario: 2025, declaraciones: 1, folioVigente: 7, detalle: 'sin_leer', boletasEmitidas: null, detalleBoletas: null, terceros: { informadas: 0, leidas: 0, filas: 0 }, errores: [{ superficie: 'f22.folio', codigo: 'PORTAL_CAMBIO', mensaje: 'El F22 cambió.' }] });
    expect(r.anios[1]?.detalle).toBe('leido');
    expect(store.declaracionesF22(RUT_EMPRESA, 2025)).toHaveLength(1);
  });

  it('un error de sesión detiene la renta; cancelada conserva lo traído', async () => {
    const sesion = preparar();
    sesion.sii.fallas.set('f22|2025', new ErrorImpuestocl('SESION_REQUERIDA', 'La sesión expiró.'));
    const r1 = await sincronizarRenta(sesion.deps, RUT_EMPRESA, '2024', '2026');
    expect(r1.abortado).toEqual({ superficie: 'sesion', codigo: 'SESION_REQUERIDA', mensaje: 'La sesión expiró.' });
    expect(sesion.sii.llamadas).toEqual(['f22|2024', 'terceros|2024', 'f22|2025']);
    expect(r1.anios.map((a) => a.anioTributario)).toEqual([2024]);

    const cancelada = preparar();
    const control = new AbortController();
    cancelada.sii.alLlamar = (llamada) => {
      if (llamada === 'f22|2025') control.abort();
    };
    const r2 = await sincronizarRenta(cancelada.deps, RUT_EMPRESA, '2024', '2026', control.signal);
    expect(r2.abortado).toMatchObject({ codigo: 'CANCELADO' });
    expect(cancelada.sii.llamadas).toEqual(['f22|2024', 'terceros|2024', 'f22|2025']);
    expect(cancelada.persistidos).toEqual([RUT_EMPRESA]);
  });

  it('la renta anual no aparece como mes en el panorama, los hallazgos ni los plazos', async () => {
    const { deps, store } = preparar();
    await sincronizarRenta(deps, RUT_EMPRESA, '2026');

    expect(store.periodosConDatos(RUT_EMPRESA)).toEqual([]);
    expect(panorama(deps, RUT_EMPRESA).periodos).toEqual([]);
    expect(hallazgos(deps, RUT_EMPRESA)).toEqual([]);
    expect(plazos(deps, RUT_EMPRESA, 365).every((p) => !JSON.stringify(p).includes('AT2026'))).toBe(true);
  });
});

describe('sincronizarRenta: boletas de honorarios emitidas (personas)', () => {
  /** Informe sintético de 2025: 3 boletas vigentes y 1 anulada; bruto 2.000.000 y retención de terceros 290.000. */
  const EMITIDAS_2025 = informeBheEmitidas(2025, {
    3: { bruto: 1_200_000, retencionTerceros: 174_000, vigentes: 2, anuladas: 1, folioInicial: 1, folioFinal: 3 },
    8: { bruto: 800_000, retencionTerceros: 116_000, vigentes: 1, folioInicial: 4, folioFinal: 4 },
  });

  /** Detalle que calza con el informe anual: marzo 2 vigentes (1.200.000) y 1 anulada; agosto 1 vigente (800.000). */
  const MARZO = [
    boletaEmitida({ periodo: '2025-03', folio: 1, rutReceptor: '33333333-3', nombreReceptor: 'Cliente Uno SpA', bruto: 500_000, retencionReceptor: 72_500 }),
    boletaEmitida({ periodo: '2025-03', folio: 2, rutReceptor: '44444444-4', nombreReceptor: null, bruto: 700_000, retencionReceptor: 101_500 }),
    boletaEmitida({ periodo: '2025-03', folio: 3, rutReceptor: '55555555-5', bruto: 90_000, anulada: true, fechaAnulacion: '2025-03-20' }),
  ];
  const AGOSTO = [boletaEmitida({ periodo: '2025-08', folio: 4, rutReceptor: '33333333-3', nombreReceptor: 'Cliente Uno SpA', bruto: 800_000, retencionReceptor: 116_000 })];

  function prepararPersona(o: { ahora?: string } = {}) {
    const p = depsDePrueba(o);
    p.store.guardarContribuyente(perfilPersona());
    p.sii.f22.set(2026, [declaracionF22({ rut: RUT_PERSONA })]);
    p.sii.f22Detalles.set(
      `2026|${FOLIO}`,
      detalleF22({
        valores: [
          { codigo: '547', valor: 2_012_600, glosa: 'Total ingresos brutos ficticio' },
          { codigo: '492', valor: 291_827, glosa: 'Retención de honorarios ficticia' },
        ],
      }),
    );
    p.sii.bheEmitidas.set(2025, EMITIDAS_2025);
    p.sii.bheEmitidasDetalle.set('2025-03', { total: 3, boletas: MARZO });
    p.sii.bheEmitidasDetalle.set('2025-08', { total: 1, boletas: AGOSTO });
    return p;
  }

  it('a una persona le lee además el informe anual del año comercial (AT − 1), registrado como bhe.emitidas en AT<AAAA>', async () => {
    const { deps, store, sii, db } = prepararPersona();

    const r = await sincronizarRenta(deps, RUT_PERSONA, '2026');

    expect(sii.llamadas.slice(0, 3)).toEqual(['f22|2026', `f22detalle|2026|${FOLIO}`, 'bheemitidas|2025']);
    expect(r.anios).toEqual([
      { anioTributario: 2026, declaraciones: 1, folioVigente: FOLIO, detalle: 'leido', boletasEmitidas: 3, detalleBoletas: { leidos: 2, omitidos: 0, fallidos: 0, avisos: [] }, terceros: { informadas: 0, leidas: 0, filas: 0 }, errores: [] },
    ]);
    expect(store.bheEmitidas(RUT_PERSONA, 2025)).toHaveLength(12);
    expect(bitacora(db).find((f) => (f as { superficie: string }).superficie === 'bhe.emitidas')).toEqual({ superficie: 'bhe.emitidas', periodo: 'AT2026', estado: 'ok', error_codigo: null });
  });

  it('trae el detalle boleta por boleta solo de los meses con boletas según el informe anual, como bhe.emitidas.detalle en AAAA-MM', async () => {
    const { deps, store, sii, db } = prepararPersona();

    await sincronizarRenta(deps, RUT_PERSONA, '2026');

    expect(sii.llamadas.slice(3)).toEqual(['bheemitidasmes|2025-03', 'bheemitidasmes|2025-08', 'terceros|2026']);
    expect(store.boletasEmitidasDelAnio(RUT_PERSONA, 2025).map((b) => [b.periodo, b.folio])).toEqual([['2025-03', 1], ['2025-03', 2], ['2025-03', 3], ['2025-08', 4]]);
    expect(bitacora(db).slice(-3, -1)).toEqual([
      { superficie: 'bhe.emitidas.detalle', periodo: '2025-03', estado: 'ok', error_codigo: null },
      { superficie: 'bhe.emitidas.detalle', periodo: '2025-08', estado: 'ok', error_codigo: null },
    ]);
    // El detalle es de la renta: esos meses no pasan a ser períodos de IVA.
    expect(store.periodosConDatos(RUT_PERSONA)).toEqual([]);
  });

  it('no vuelve a pedir un mes cuyo detalle guardado ya calza con el informe anual', async () => {
    const { deps, sii } = prepararPersona();
    await sincronizarRenta(deps, RUT_PERSONA, '2026');
    sii.llamadas.length = 0;

    const r = await sincronizarRenta(deps, RUT_PERSONA, '2026');

    expect(sii.llamadas.some((l) => l.startsWith('bheemitidasmes'))).toBe(false);
    expect(r.anios[0]?.detalleBoletas).toEqual({ leidos: 0, omitidos: 2, fallidos: 0, avisos: [] });
  });

  it('un detalle que no calza con el informe anual se guarda igual, con un aviso y sin error', async () => {
    const { deps, store, sii } = prepararPersona();
    sii.bheEmitidasDetalle.set('2025-08', { total: 1, boletas: [{ ...AGOSTO[0]!, bruto: 900_000 }] });

    const r = await sincronizarRenta(deps, RUT_PERSONA, '2026');

    expect(r.anios[0]?.errores).toEqual([]);
    expect(r.anios[0]?.detalleBoletas).toEqual({
      leidos: 2,
      omitidos: 0,
      fallidos: 0,
      avisos: ['Boletas emitidas 2025-08: el detalle trae 1 vigente, 0 anuladas y bruto $900.000; el informe anual dice 1 vigente, 0 anuladas y bruto $800.000.'],
    });
    expect(store.boletasEmitidas(RUT_PERSONA, '2025-08')[0]?.bruto).toBe(900_000);
  });

  it('un vacío ambiguo (o sin boletas cuando el anual informa) no borra lo guardado: RESPUESTA_VACIA en ese mes', async () => {
    const { deps, store, sii } = prepararPersona();
    sii.bheEmitidasDetalle.set('2025-08', { total: 1, boletas: [{ ...AGOSTO[0]!, bruto: 900_000 }] });
    await sincronizarRenta(deps, RUT_PERSONA, '2026');
    sii.bheEmitidasDetalle.set('2025-08', null);

    const r = await sincronizarRenta(deps, RUT_PERSONA, '2026');

    expect(r.anios[0]?.detalleBoletas).toMatchObject({ leidos: 0, omitidos: 1, fallidos: 1 });
    expect(r.anios[0]?.errores).toEqual([{ superficie: 'bhe.emitidas.detalle', codigo: 'RESPUESTA_VACIA', mensaje: expect.stringContaining('2025-08') }]);
    expect(store.boletasEmitidas(RUT_PERSONA, '2025-08')).toHaveLength(1);

    sii.bheEmitidasDetalle.set('2025-08', { total: 0, boletas: [] });
    const r2 = await sincronizarRenta(deps, RUT_PERSONA, '2026');
    expect(r2.anios[0]?.errores).toMatchObject([{ superficie: 'bhe.emitidas.detalle', codigo: 'RESPUESTA_VACIA' }]);
    expect(store.boletasEmitidas(RUT_PERSONA, '2025-08')).toHaveLength(1);
  });

  it('un mes que falla no impide los demás; el error dice de qué mes es', async () => {
    const { deps, sii } = prepararPersona();
    sii.fallas.set('bheemitidasmes|2025-03', new ErrorImpuestocl('SII_NO_DISPONIBLE', 'No responde.'));

    const r = await sincronizarRenta(deps, RUT_PERSONA, '2026');

    expect(sii.llamadas).toContain('bheemitidasmes|2025-08');
    expect(r.anios[0]?.detalleBoletas).toEqual({ leidos: 1, omitidos: 0, fallidos: 1, avisos: [] });
    expect(r.anios[0]?.errores).toEqual([{ superficie: 'bhe.emitidas.detalle', codigo: 'SII_NO_DISPONIBLE', mensaje: '2025-03: No responde.' }]);
  });

  it('se puede cancelar entre meses del detalle: conserva lo traído', async () => {
    const { deps, store, sii } = prepararPersona();
    const control = new AbortController();
    sii.alLlamar = (llamada) => {
      if (llamada === 'bheemitidasmes|2025-03') control.abort();
    };

    const r = await sincronizarRenta(deps, RUT_PERSONA, '2026', undefined, control.signal);

    expect(r.abortado).toMatchObject({ codigo: 'CANCELADO' });
    expect(sii.llamadas).not.toContain('bheemitidasmes|2025-08');
    expect(store.boletasEmitidas(RUT_PERSONA, '2025-08')).toEqual([]);
  });

  it('a una empresa no le lee boletas emitidas', async () => {
    const { deps, sii } = preparar();
    const r = await sincronizarRenta(deps, RUT_EMPRESA, '2026');
    expect(sii.llamadas.some((l) => l.startsWith('bheemitidas'))).toBe(false);
    expect(r.anios[0]?.boletasEmitidas).toBeNull();
    expect(r.anios[0]?.detalleBoletas).toBeNull();
  });

  it('un error en las boletas no impide el F22, y un error del F22 no impide las boletas', async () => {
    const boletas = prepararPersona();
    boletas.sii.fallas.set('bheemitidas|2025', new ErrorImpuestocl('PORTAL_CAMBIO', 'El informe cambió.'));
    const r1 = await sincronizarRenta(boletas.deps, RUT_PERSONA, '2026');
    expect(r1.anios[0]).toMatchObject({ declaraciones: 1, detalle: 'leido', boletasEmitidas: null, detalleBoletas: null, errores: [{ superficie: 'bhe.emitidas', codigo: 'PORTAL_CAMBIO' }] });
    // Sin informe anual no se sabe qué meses pedir: no hay detalle.
    expect(boletas.sii.llamadas.some((l) => l.startsWith('bheemitidasmes'))).toBe(false);
    expect(boletas.store.declaracionesF22(RUT_PERSONA, 2026)).toHaveLength(1);

    const f22 = prepararPersona();
    f22.sii.fallas.set('f22|2026', new ErrorImpuestocl('SII_RECHAZO', 'F22: sin datos del período.'));
    const r2 = await sincronizarRenta(f22.deps, RUT_PERSONA, '2026');
    expect(r2.anios[0]).toMatchObject({ declaraciones: null, boletasEmitidas: 3, errores: [{ superficie: 'f22', codigo: 'SII_RECHAZO' }] });
  });

  it('si el SII responde todo en cero y había boletas guardadas, las conserva con RESPUESTA_VACIA', async () => {
    const { deps, store, sii, db } = prepararPersona();
    await sincronizarRenta(deps, RUT_PERSONA, '2026');
    sii.bheEmitidas.delete(2025);

    const r = await sincronizarRenta(deps, RUT_PERSONA, '2026');

    expect(r.anios[0]).toMatchObject({ boletasEmitidas: null, detalleBoletas: null, errores: [{ superficie: 'bhe.emitidas', codigo: 'RESPUESTA_VACIA' }] });
    expect(store.bheEmitidas(RUT_PERSONA, 2025).reduce((s, m) => s + m.vigentes, 0)).toBe(3);
    expect(bitacora(db).at(-2)).toEqual({ superficie: 'bhe.emitidas', periodo: 'AT2026', estado: 'error', error_codigo: 'RESPUESTA_VACIA' });
  });

  it('un año sin boletas y sin nada guardado se guarda en cero: 0 boletas emitidas', async () => {
    const { deps, store } = prepararPersona();
    const r = await sincronizarRenta(deps, RUT_PERSONA, '2025');
    expect(r.anios[0]).toMatchObject({ declaraciones: 0, boletasEmitidas: 0, detalleBoletas: { leidos: 0, omitidos: 0, fallidos: 0, avisos: [] }, errores: [] });
    expect(store.bheEmitidas(RUT_PERSONA, 2024)).toHaveLength(12);
  });

  it('permite el año tributario siguiente al actual: trae las boletas del año en curso aunque aún no haya F22', async () => {
    const { deps, sii } = prepararPersona({ ahora: '2026-10-27T15:00:00.000Z' });
    sii.bheEmitidas.set(2026, informeBheEmitidas(2026, { 1: { bruto: 100_000, retencionTerceros: 14_500, vigentes: 1, folioInicial: 5, folioFinal: 5 } }));
    sii.bheEmitidasDetalle.set('2026-01', { total: 1, boletas: [boletaEmitida({ periodo: '2026-01', folio: 5, bruto: 100_000 })] });

    const r = await sincronizarRenta(deps, RUT_PERSONA, '2027');

    expect(sii.llamadas).toEqual(['f22|2027', 'bheemitidas|2026', 'bheemitidasmes|2026-01', 'terceros|2027']);
    expect(r.anios[0]).toMatchObject({ anioTributario: 2027, declaraciones: 0, detalle: 'sin_vigente', boletasEmitidas: 1, errores: [] });
    expect(resumenRenta(deps, RUT_PERSONA, '2027').anios[0]).toMatchObject({
      anioTributario: 2027,
      folio: null,
      declaraciones: 0,
      honorariosEmitidos: { anioComercial: 2026, vigentes: 1, bruto: 100_000, cruceF22: null },
    });
  });
});

describe('sincronizarRenta: rentas informadas por terceros', () => {
  const informada = (dj: number): DjInformada => ({ dj, titulo: `DJ ficticia ${dj}`, registros: 1, resumen: {} });
  const OBSERVADA = djTercero({ informanteRut: '44444444-4', informanteNombre: null, estado: 'Observada', observada: true, folio: 76_543, meses: [7, 9], retencionHonorarios: 130_000 });

  function prepararTerceros() {
    const p = preparar();
    p.sii.terceros.set(2026, [informada(1879), informada(1887)]);
    p.sii.tercerosDetalle.set('2026|1879', [djTercero(), OBSERVADA]);
    p.sii.tercerosDetalle.set('2026|1887', [djTercero({ dj: 1887, informanteRut: '55555555-5' })]);
    return p;
  }

  it('después del F22 lee las DJ informadas y el detalle de cada una, registradas como terceros y terceros.<dj> en AT<AAAA>', async () => {
    const { deps, store, sii, db } = prepararTerceros();

    const r = await sincronizarRenta(deps, RUT_EMPRESA, '2026');

    expect(sii.llamadas).toEqual(['f22|2026', `f22detalle|2026|${FOLIO}`, 'terceros|2026', 'tercerosdetalle|2026|1879', 'tercerosdetalle|2026|1887']);
    expect(r.anios[0]).toMatchObject({ terceros: { informadas: 2, leidas: 2, filas: 3 }, errores: [] });
    expect(store.djTerceros(RUT_EMPRESA, 2026).map((f) => [f.dj, f.informanteRut])).toEqual([[1879, '33333333-3'], [1879, '44444444-4'], [1887, '55555555-5']]);
    expect(bitacora(db).slice(2)).toEqual([
      { superficie: 'terceros', periodo: 'AT2026', estado: 'ok', error_codigo: null },
      { superficie: 'terceros.1879', periodo: 'AT2026', estado: 'ok', error_codigo: null },
      { superficie: 'terceros.1887', periodo: 'AT2026', estado: 'ok', error_codigo: null },
    ]);
    // Son de la renta: no hacen de un mes un período de IVA.
    expect(store.periodosConDatos(RUT_EMPRESA)).toEqual([]);
  });

  it('a una persona las lee después de las boletas emitidas; sin DJ con datos queda en 0', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilPersona());
    const r = await sincronizarRenta(deps, RUT_PERSONA, '2026');
    expect(sii.llamadas).toEqual(['f22|2026', 'bheemitidas|2025', 'terceros|2026']);
    expect(r.anios[0]).toMatchObject({ terceros: { informadas: 0, leidas: 0, filas: 0 }, errores: [] });
  });

  it('si el SII responde sin DJ y había guardadas, las conserva con RESPUESTA_VACIA', async () => {
    const { deps, store, sii, db } = prepararTerceros();
    await sincronizarRenta(deps, RUT_EMPRESA, '2026');
    sii.terceros.delete(2026);

    const r = await sincronizarRenta(deps, RUT_EMPRESA, '2026');

    expect(r.anios[0]).toMatchObject({ terceros: null, errores: [{ superficie: 'terceros', codigo: 'RESPUESTA_VACIA' }] });
    expect(store.djTerceros(RUT_EMPRESA, 2026)).toHaveLength(3);
    expect(bitacora(db).at(-1)).toEqual({ superficie: 'terceros', periodo: 'AT2026', estado: 'error', error_codigo: 'RESPUESTA_VACIA' });
  });

  it('un detalle vacío no borra lo guardado (RESPUESTA_VACIA) y una DJ que falla no impide las demás ni el año siguiente', async () => {
    const { deps, store, sii } = prepararTerceros();
    sii.f22.set(2027, []);
    sii.terceros.set(2027, [informada(1879)]);
    sii.tercerosDetalle.set('2027|1879', [djTercero()]);
    await sincronizarRenta(deps, RUT_EMPRESA, '2026');
    sii.tercerosDetalle.delete('2026|1879');
    sii.fallas.set('tercerosdetalle|2026|1887', new ErrorImpuestocl('PORTAL_CAMBIO', 'Tabla inesperada.'));

    const r = await sincronizarRenta(deps, RUT_EMPRESA, '2026', '2027');

    expect(r.anios[0]?.terceros).toEqual({ informadas: 2, leidas: 0, filas: 0 });
    expect(r.anios[0]?.errores).toEqual([
      { superficie: 'terceros.1879', codigo: 'RESPUESTA_VACIA', mensaje: expect.stringMatching(/DJ 1879.*se conservan/) },
      { superficie: 'terceros.1887', codigo: 'PORTAL_CAMBIO', mensaje: 'Tabla inesperada.' },
    ]);
    expect(store.djTerceros(RUT_EMPRESA, 2026)).toHaveLength(3);
    expect(r.anios[1]).toMatchObject({ anioTributario: 2027, terceros: { informadas: 1, leidas: 1, filas: 1 }, errores: [] });
  });

  it('un error de la lista no impide el F22 ni el año siguiente; se puede cancelar entre DJ', async () => {
    const falla = prepararTerceros();
    falla.sii.fallas.set('terceros|2025', new ErrorImpuestocl('SII_RECHAZO', 'Servicio no disponible.'));
    const r1 = await sincronizarRenta(falla.deps, RUT_EMPRESA, '2025', '2026');
    expect(r1.anios[0]).toMatchObject({ terceros: null, errores: [{ superficie: 'terceros', codigo: 'SII_RECHAZO' }] });
    expect(r1.anios[1]?.terceros).toEqual({ informadas: 2, leidas: 2, filas: 3 });

    const cancelada = prepararTerceros();
    const control = new AbortController();
    cancelada.sii.alLlamar = (llamada) => {
      if (llamada === 'tercerosdetalle|2026|1879') control.abort();
    };
    const r2 = await sincronizarRenta(cancelada.deps, RUT_EMPRESA, '2026', undefined, control.signal);
    expect(r2.abortado).toMatchObject({ codigo: 'CANCELADO' });
    expect(cancelada.sii.llamadas).not.toContain('tercerosdetalle|2026|1887');
    // La DJ en curso al cancelar terminó; la siguiente no se pidió ni se guardó.
    expect(cancelada.store.djTerceros(RUT_EMPRESA, 2026).map((f) => f.dj)).toEqual([1879, 1879]);
  });
});

describe('resumenRenta', () => {
  it('sin renta guardada devuelve una lista vacía', () => {
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    expect(resumenRenta(deps, RUT_EMPRESA)).toEqual({ rut: RUT_EMPRESA, anios: [] });
  });

  it('por año: folio vigente, conclusión, códigos clave con su glosa, observaciones y eventos', async () => {
    const { deps, sii } = preparar();
    sii.f22.set(2025, [declaracionF22({ anioTributario: 2025, folio: 55, codigoConclusion: '07' })]);
    sii.f22Detalles.set('2025|55', detalleF22({ valores: [{ codigo: '170', valor: 1, glosa: 'Otro' }], observaciones: [], eventos: [] }));
    await sincronizarRenta(deps, RUT_EMPRESA, '2025', '2026');

    const r = resumenRenta(deps, RUT_EMPRESA);

    expect(r.anios.map((a) => a.anioTributario)).toEqual([2026, 2025]);
    expect(r.anios[0]).toEqual({
      anioTributario: 2026,
      folio: FOLIO,
      vigente: true,
      declaraciones: 2,
      codigoConclusion: '07',
      conclusion: 'Conclusión ficticia: declaración sin observaciones',
      fechaIngreso: '2026-04-15',
      tipoImpugnado: null,
      impuestoPagado: 1_234_567,
      montoGiro: 0,
      remanenteSolicitado: 0,
      remanenteDevuelto: 0,
      fechaVencimiento: '2026-04-30',
      codigos: 3,
      codigosClave: [
        { codigo: '305', valor: -250_000, glosa: 'Resultado liquidación anual ficticio' },
        { codigo: '87', valor: 250_000, glosa: 'Monto devolución solicitada ficticia' },
      ],
      observaciones: [{ codigo: 'A01', descripcion: 'Observación ficticia' }],
      eventos: [{ orden: 1, codigoEvento: 'E01', nombre: 'Declaración recibida', fecha: '2026-04-15', tipo: 'INFO', codigoCarta: null }],
      honorariosEmitidos: null,
      terceros: null,
      obtenidoEn: '2026-10-21T15:00:00.000Z',
    });
    expect(r.anios[1]).toMatchObject({ folio: 55, codigos: 1, codigosClave: [], observaciones: [], eventos: [] });
    expect(resumenRenta(deps, RUT_EMPRESA, '2025').anios.map((a) => a.anioTributario)).toEqual([2025]);
  });

  it('un año sin folio vigente muestra sus declaraciones sin detalle', async () => {
    const { deps, sii } = preparar();
    sii.f22.set(2026, [declaracionF22({ vigente: false })]);
    await sincronizarRenta(deps, RUT_EMPRESA, '2026');

    expect(resumenRenta(deps, RUT_EMPRESA, '2026').anios[0]).toMatchObject({ folio: null, vigente: null, declaraciones: 1, codigos: 0, codigosClave: [], conclusion: null });
  });

  it('honorarios emitidos del año comercial con el cruce del bruto con el 547 y la retención con el 492', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilPersona());
    sii.f22.set(2026, [declaracionF22({ rut: RUT_PERSONA })]);
    sii.f22Detalles.set(
      `2026|${FOLIO}`,
      detalleF22({
        valores: [
          { codigo: '547', valor: 2_012_600, glosa: 'Ingresos brutos ficticios' },
          { codigo: '492', valor: 291_827, glosa: 'Retención ficticia' },
        ],
      }),
    );
    sii.bheEmitidas.set(
      2025,
      informeBheEmitidas(2025, {
        3: { bruto: 1_200_000, retencionTerceros: 174_000, vigentes: 2, anuladas: 1 },
        8: { bruto: 800_000, retencionTerceros: 116_000, retencionPropia: 5_000, vigentes: 1 },
      }),
    );
    sii.bheEmitidas.set(2023, informeBheEmitidas(2023, { 5: { bruto: 50_000, retencionTerceros: 6_000, vigentes: 1 } }));
    await sincronizarRenta(deps, RUT_PERSONA, '2024', '2026');

    const r = resumenRenta(deps, RUT_PERSONA);

    // AT2025 no tiene F22 ni boletas, pero su lectura quedó guardada (12 meses en cero): también aparece.
    expect(r.anios.map((a) => a.anioTributario)).toEqual([2026, 2025, 2024]);
    expect(r.anios[0]?.honorariosEmitidos).toEqual({
      anioComercial: 2025,
      vigentes: 3,
      anuladas: 1,
      bruto: 2_000_000,
      retencionTerceros: 290_000,
      retencionPropia: 5_000,
      cruceF22: {
        bruto: { codigo: '547', boletas: 2_000_000, f22: 2_012_600, estado: 'cuadra', reajustePct: 0.63 },
        retencion: { codigo: '492', boletas: 290_000, f22: 291_827, estado: 'cuadra', reajustePct: 0.63 },
      },
      // Sin detalle boleta por boleta guardado (el SII falso no lo trae), no hay vista por pagador.
      pagadores: null,
      obtenidoEn: '2026-10-21T15:00:00.000Z',
    });
    // Sin F22: el año aparece solo con sus boletas y sin cruce.
    expect(r.anios[2]).toMatchObject({
      anioTributario: 2024,
      folio: null,
      declaraciones: 0,
      codigos: 0,
      honorariosEmitidos: { anioComercial: 2023, vigentes: 1, cruceF22: null },
      obtenidoEn: '2026-10-21T15:00:00.000Z',
    });
    expect(resumenRenta(deps, RUT_PERSONA, '2024').anios.map((a) => a.anioTributario)).toEqual([2024]);
  });

  it('un folio vigente sin detalle guardado no se cruza; con detalle sin 547 ni 492, las boletas quedan sin declarar', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilPersona());
    sii.f22.set(2026, [declaracionF22({ rut: RUT_PERSONA })]);
    sii.bheEmitidas.set(2025, informeBheEmitidas(2025, { 1: { bruto: 100_000, retencionTerceros: 14_500, vigentes: 1 } }));
    sii.fallas.set(`f22detalle|2026|${FOLIO}`, new ErrorImpuestocl('PORTAL_CAMBIO', 'El F22 cambió.'));
    await sincronizarRenta(deps, RUT_PERSONA, '2026');
    expect(resumenRenta(deps, RUT_PERSONA).anios[0]?.honorariosEmitidos?.cruceF22).toBeNull();

    sii.fallas.clear();
    sii.f22Detalles.set(`2026|${FOLIO}`, detalleF22());
    await sincronizarRenta(deps, RUT_PERSONA, '2026');
    expect(resumenRenta(deps, RUT_PERSONA).anios[0]?.honorariosEmitidos?.cruceF22).toMatchObject({ bruto: { estado: 'sin_declarar' }, retencion: { estado: 'sin_declarar' } });
  });

  it('con detalle guardado muestra los pagadores con mayor bruto vigente del año comercial', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilPersona());
    sii.bheEmitidas.set(2025, informeBheEmitidas(2025, { 3: { bruto: 1_200_000, vigentes: 2 }, 8: { bruto: 800_000, vigentes: 1, anuladas: 1 } }));
    sii.bheEmitidasDetalle.set('2025-03', {
      total: 2,
      boletas: [
        boletaEmitida({ periodo: '2025-03', folio: 1, rutReceptor: '33333333-3', nombreReceptor: 'Cliente Uno SpA', bruto: 500_000, retencionReceptor: 72_500 }),
        boletaEmitida({ periodo: '2025-03', folio: 2, rutReceptor: '44444444-4', nombreReceptor: null, bruto: 700_000, retencionReceptor: 101_500 }),
      ],
    });
    sii.bheEmitidasDetalle.set('2025-08', {
      total: 2,
      boletas: [
        boletaEmitida({ periodo: '2025-08', folio: 3, rutReceptor: '33333333-3', nombreReceptor: 'Cliente Uno SpA', bruto: 800_000, retencionReceptor: 116_000 }),
        boletaEmitida({ periodo: '2025-08', folio: 4, rutReceptor: '55555555-5', bruto: 300_000, anulada: true }),
      ],
    });
    await sincronizarRenta(deps, RUT_PERSONA, '2026');

    expect(resumenRenta(deps, RUT_PERSONA).anios[0]?.honorariosEmitidos?.pagadores).toEqual({
      principales: [
        { rutReceptor: '33333333-3', nombreReceptor: 'Cliente Uno SpA', boletas: 2, bruto: 1_300_000, retencion: 188_500 },
        { rutReceptor: '44444444-4', nombreReceptor: null, boletas: 1, bruto: 700_000, retencion: 101_500 },
      ],
      otros: 0,
    });
  });

  it('informado por terceros: cada informante con su cruce con las boletas emitidas a su RUT, y la retención de la 1879 contra boletas y F22', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilPersona());
    sii.f22.set(2026, [declaracionF22({ rut: RUT_PERSONA })]);
    sii.f22Detalles.set(`2026|${FOLIO}`, detalleF22({ valores: [{ codigo: '492', valor: 170_000, glosa: 'Retención ficticia' }] }));
    sii.bheEmitidas.set(2025, informeBheEmitidas(2025, { 7: { bruto: 300_000, retencionTerceros: 43_500, vigentes: 1 }, 8: { bruto: 900_000, retencionTerceros: 130_500, vigentes: 1 } }));
    sii.bheEmitidasDetalle.set('2025-07', { total: 1, boletas: [boletaEmitida({ periodo: '2025-07', folio: 1, rutReceptor: '33333333-3', bruto: 300_000, retencionReceptor: 43_500 })] });
    sii.bheEmitidasDetalle.set('2025-08', { total: 1, boletas: [boletaEmitida({ periodo: '2025-08', folio: 2, rutReceptor: '44444444-4', bruto: 900_000, retencionReceptor: 130_500 })] });
    const uno = djTercero({ meses: [7], retencionHonorarios: 44_000 });
    const observada = djTercero({ informanteRut: '44444444-4', informanteNombre: null, estado: 'Observada', observada: true, folio: 76_543, meses: [8, 9], retencionHonorarios: 131_000 });
    const sueldo = djTercero({ dj: 1887, informanteRut: '55555555-5', montos: { 'Renta Total Neta Pagada': 9_000_000 }, rentaSueldo: 9_000_000 });
    delete (sueldo as { retencionHonorarios?: number }).retencionHonorarios;
    sii.terceros.set(2026, [{ dj: 1879, titulo: null, registros: 2, resumen: {} }, { dj: 1887, titulo: null, registros: 1, resumen: {} }]);
    sii.tercerosDetalle.set('2026|1879', [uno, observada]);
    sii.tercerosDetalle.set('2026|1887', [sueldo]);
    await sincronizarRenta(deps, RUT_PERSONA, '2026');

    const t = resumenRenta(deps, RUT_PERSONA).anios[0]?.terceros;

    expect(t?.informantes.map((i) => [i.dj, i.informanteRut, i.observada])).toEqual([[1879, '33333333-3', false], [1879, '44444444-4', true], [1887, '55555555-5', false]]);
    expect(t?.informantes[0]).toMatchObject({ informanteNombre: 'Cliente Ficticio SpA', retencionHonorarios: 44_000, cruceBoletas: { boletas: 1, soloDj: [], soloBoletas: [], retencion: { estado: 'cuadra', diferencia: 500 } } });
    expect(t?.informantes[1]?.cruceBoletas).toMatchObject({ mesesBoletas: [8], soloDj: [9], retencion: { estado: 'cuadra' } });
    // La 1887 no se cruza con boletas de honorarios.
    expect(t?.informantes[2]).toMatchObject({ rentaSueldo: 9_000_000, cruceBoletas: null });
    expect(t?.cruceRetencion).toEqual({
      dj: 1879,
      informada: 175_000,
      boletas: { otro: 174_000, estado: 'cuadra', diferencia: 1_000, reajustePct: 0.57 },
      f22: { otro: 170_000, estado: 'difiere', diferencia: 5_000, reajustePct: null },
    });
    expect(t?.obtenidoEn).toBe('2026-10-21T15:00:00.000Z');
  });

  it('un año solo con lo informado por terceros aparece, sin cruces si no hay boletas ni F22', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sii.terceros.set(2025, [{ dj: 1879, titulo: null, registros: 1, resumen: {} }]);
    sii.tercerosDetalle.set('2025|1879', [djTercero()]);
    await sincronizarRenta(deps, RUT_EMPRESA, '2025');

    const [anio] = resumenRenta(deps, RUT_EMPRESA).anios;

    expect(anio).toMatchObject({ anioTributario: 2025, declaraciones: 0, honorariosEmitidos: null, obtenidoEn: '2026-10-21T15:00:00.000Z' });
    expect(anio?.terceros).toMatchObject({ cruceRetencion: { informada: 70_000, boletas: null, f22: null } });
    expect(anio?.terceros?.informantes[0]?.cruceBoletas).toBeNull();
    expect(resumenRenta(deps, RUT_EMPRESA, '2025').anios).toHaveLength(1);
    expect(resumenRenta(deps, RUT_EMPRESA, '2026').anios).toHaveLength(0);
  });

  it('valida el año y el perfil', () => {
    const { deps, store } = depsDePrueba();
    expect(() => resumenRenta(deps, RUT_EMPRESA)).toThrow(ErrorImpuestocl);
    store.guardarContribuyente(perfilEmpresa());
    expect(() => resumenRenta(deps, RUT_EMPRESA, '26')).toThrow(/Año tributario inválido/);
  });
});
