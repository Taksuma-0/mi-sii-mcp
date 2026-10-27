import { describe, expect, it } from 'vitest';
import { hallazgos, plazos } from '../../src/app/consultas.js';
import { panorama } from '../../src/app/panorama.js';
import { resumenRenta, sincronizarRenta } from '../../src/app/renta.js';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { codigoDe } from '../helpers/errores.js';
import { depsDePrueba } from '../helpers/deps.js';
import { declaracionF22, detalleF22, perfilEmpresa, RUT_EMPRESA } from '../helpers/fabricas.js';

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

    expect(sii.llamadas).toEqual(['f22|2026', `f22detalle|2026|${FOLIO}`]);
    expect(r).toEqual({ rut: RUT_EMPRESA, anios: [{ anioTributario: 2026, declaraciones: 2, folioVigente: FOLIO, detalle: 'leido', errores: [] }], abortado: null });
    expect(store.declaracionesF22(RUT_EMPRESA, 2026).map((d) => d.folio)).toEqual([98_765_432, FOLIO]);
    expect(store.detalleF22(RUT_EMPRESA, 2026, FOLIO).valores).toHaveLength(3);
    expect(bitacora(db)).toEqual([
      { superficie: 'f22', periodo: 'AT2026', estado: 'ok', error_codigo: null },
      { superficie: 'f22.folio', periodo: 'AT2026', estado: 'ok', error_codigo: null },
    ]);
  });

  it('recorre el rango de años en orden; un año sin declaraciones queda ok y sin detalle', async () => {
    const { deps, sii } = preparar();

    const r = await sincronizarRenta(deps, RUT_EMPRESA, '2024', '2026');

    expect(sii.llamadas).toEqual(['f22|2024', 'f22|2025', 'f22|2026', `f22detalle|2026|${FOLIO}`]);
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
    expect(bitacora(db).at(-1)).toEqual({ superficie: 'f22', periodo: 'AT2026', estado: 'error', error_codigo: 'RESPUESTA_VACIA' });
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

    expect(r.anios[0]).toEqual({ anioTributario: 2025, declaraciones: 1, folioVigente: 7, detalle: 'sin_leer', errores: [{ superficie: 'f22.folio', codigo: 'PORTAL_CAMBIO', mensaje: 'El F22 cambió.' }] });
    expect(r.anios[1]?.detalle).toBe('leido');
    expect(store.declaracionesF22(RUT_EMPRESA, 2025)).toHaveLength(1);
  });

  it('un error de sesión detiene la renta; cancelada conserva lo traído', async () => {
    const sesion = preparar();
    sesion.sii.fallas.set('f22|2025', new ErrorImpuestocl('SESION_REQUERIDA', 'La sesión expiró.'));
    const r1 = await sincronizarRenta(sesion.deps, RUT_EMPRESA, '2024', '2026');
    expect(r1.abortado).toEqual({ superficie: 'sesion', codigo: 'SESION_REQUERIDA', mensaje: 'La sesión expiró.' });
    expect(sesion.sii.llamadas).toEqual(['f22|2024', 'f22|2025']);
    expect(r1.anios.map((a) => a.anioTributario)).toEqual([2024]);

    const cancelada = preparar();
    const control = new AbortController();
    cancelada.sii.alLlamar = (llamada) => {
      if (llamada === 'f22|2025') control.abort();
    };
    const r2 = await sincronizarRenta(cancelada.deps, RUT_EMPRESA, '2024', '2026', control.signal);
    expect(r2.abortado).toMatchObject({ codigo: 'CANCELADO' });
    expect(cancelada.sii.llamadas).toEqual(['f22|2024', 'f22|2025']);
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

  it('valida el año y el perfil', () => {
    const { deps, store } = depsDePrueba();
    expect(() => resumenRenta(deps, RUT_EMPRESA)).toThrow(ErrorImpuestocl);
    store.guardarContribuyente(perfilEmpresa());
    expect(() => resumenRenta(deps, RUT_EMPRESA, '26')).toThrow(/Año tributario inválido/);
  });
});
