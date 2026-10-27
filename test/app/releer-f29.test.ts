import { describe, expect, it } from 'vitest';
import { releerF29 } from '../../src/app/releer-f29.js';
import { declaracion, perfilEmpresa, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { conLector, depsDePrueba } from '../helpers/deps.js';
import { codigoDe } from '../helpers/errores.js';
import { guardarPdfF29, pdfFalso, VERSION_LECTOR_PRUEBA } from '../helpers/lector-falso.js';
import { sembrarMes } from '../helpers/sembrar.js';

const COHERENTES = { '538': 199_500, '537': 19_000, '89': 180_500 };
const T_PDF = '2026-10-20T10:00:00.000Z';

/** Un mes guardado con el folio 555001 y sus valores; nunca puede abrir el SII. */
function mesGuardado(guardados: Record<string, number> = COHERENTES) {
  const p = depsDePrueba({ fallaAlAbrir: new Error('No debe abrir el SII') });
  p.store.guardarContribuyente(perfilEmpresa());
  sembrarMes(p.store, '2026-09', { declaraciones: [declaracion()], valores: [valores(guardados)] });
  return p;
}

describe('releerF29', () => {
  it('actualiza los valores del folio con la lectura nueva, informa los códigos cambiados y registra la relectura', async () => {
    const { deps, store, sii, lector } = mesGuardado();
    guardarPdfF29(store, { periodo: '2026-09', folio: 555_001, cuerpo: pdfFalso({ ...COHERENTES, '547': 180_500, '91': 180_500 }), obtenidoEn: T_PDF });

    const r = await releerF29(deps, '22.222.222-2');

    expect(r).toEqual({
      rut: RUT_EMPRESA,
      versionLector: VERSION_LECTOR_PRUEBA,
      folios: [{ periodo: '2026-09', folio: 555_001, resultado: 'actualizado', codigosCambiados: ['547', '91'], mensaje: null }],
    });
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)?.valores).toEqual({ ...COHERENTES, '547': 180_500, '91': 180_500 });
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_001)).toEqual({
      versionLector: VERSION_LECTOR_PRUEBA,
      origen: 'relectura',
      leidoEn: '2026-10-21T15:00:00.000Z',
      codigos: 5,
      coherente: true,
    });
    expect(lector.lecturas).toBe(1);
    expect(sii.llamadas).toEqual([]);
  });

  it('informa también los códigos que desaparecen o cambian de valor', async () => {
    const { deps, store } = mesGuardado({ ...COHERENTES, '151': 1_000 });
    guardarPdfF29(store, { periodo: '2026-09', folio: 555_001, cuerpo: pdfFalso({ '538': 200_000, '537': 19_500, '89': 180_500 }), obtenidoEn: T_PDF });

    const r = await releerF29(deps, RUT_EMPRESA);

    expect(r.folios[0]).toMatchObject({ resultado: 'actualizado', codigosCambiados: ['151', '537', '538'] });
  });

  it('sin cambios: registra la versión del lector una vez y repetir no escribe nada', async () => {
    const { deps, store } = mesGuardado();
    guardarPdfF29(store, { periodo: '2026-09', folio: 555_001, cuerpo: pdfFalso(COHERENTES), obtenidoEn: T_PDF });

    const r1 = await releerF29(deps, RUT_EMPRESA);
    const lectura = store.lecturaF29(RUT_EMPRESA, '2026-09', 555_001);
    const despues = { ...deps, reloj: { ahora: () => new Date('2026-10-22T15:00:00.000Z') } };
    const r2 = await releerF29(despues, RUT_EMPRESA);

    for (const r of [r1, r2]) expect(r.folios).toEqual([{ periodo: '2026-09', folio: 555_001, resultado: 'sin_cambios', codigosCambiados: [], mensaje: null }]);
    expect(lectura).toMatchObject({ versionLector: VERSION_LECTOR_PRUEBA, origen: 'relectura', coherente: true });
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_001)).toEqual(lectura);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)?.valores).toEqual(COHERENTES);
  });

  it.each([
    ['un PDF que el lector no puede leer', new TextEncoder().encode('%PDF-roto')],
    ['un PDF sin códigos legibles', pdfFalso({})],
  ])('%s queda ilegible y conserva los valores guardados', async (_caso, cuerpo) => {
    const { deps, store } = mesGuardado();
    guardarPdfF29(store, { periodo: '2026-09', folio: 555_001, cuerpo, obtenidoEn: T_PDF });

    const r = await releerF29(deps, RUT_EMPRESA);

    expect(r.folios).toHaveLength(1);
    expect(r.folios[0]).toMatchObject({ periodo: '2026-09', folio: 555_001, resultado: 'ilegible', codigosCambiados: [] });
    expect(r.folios[0]!.mensaje).toMatch(/no se pudo leer|no trajo códigos/i);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)?.valores).toEqual(COHERENTES);
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_001)).toBeNull();
  });

  it.each([
    ['no cuadra', { '538': 199_500, '537': 19_000, '89': 5_000 }, '89'],
    ['no trae el 538 legible', { '502': 199_500, '537': 19_000, '89': 5 }, '538'],
  ])('una lectura que %s no reemplaza una guardada coherente', async (_caso, nuevos, menciona) => {
    const { deps, store } = mesGuardado();
    guardarPdfF29(store, { periodo: '2026-09', folio: 555_001, cuerpo: pdfFalso(nuevos), obtenidoEn: T_PDF });

    const r = await releerF29(conLector(deps, 'f29-prueba-2'), RUT_EMPRESA);

    expect(r.folios[0]).toMatchObject({ resultado: 'incoherente_conservado', codigosCambiados: [] });
    expect(r.folios[0]!.mensaje).toContain(menciona);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)?.valores).toEqual(COHERENTES);
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_001)).toBeNull();
  });

  it('una lectura que perdió el bloque de totales (sin 538 ni 537) no reemplaza la guardada que sí los traía', async () => {
    const completos = { ...COHERENTES, '547': 180_500, '91': 180_500 };
    const { deps, store } = mesGuardado(completos);
    guardarPdfF29(store, { periodo: '2026-09', folio: 555_001, cuerpo: pdfFalso({ '547': 180_500, '91': 180_500 }), obtenidoEn: T_PDF });

    const r = await releerF29(deps, RUT_EMPRESA);

    expect(r.folios[0]).toMatchObject({ resultado: 'incoherente_conservado', codigosCambiados: [] });
    expect(r.folios[0]!.mensaje).toMatch(/538.*537.*lectura guardada/);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)?.valores).toEqual(completos);
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_001)).toBeNull();
  });

  it('una lectura incoherente reemplaza una guardada que tampoco era confiable, y lo avisa', async () => {
    const { deps, store } = mesGuardado({ '502': 199_500, '537': 19_000 });
    const nuevos = { '538': 199_500, '537': 19_000, '89': 5_000 };
    guardarPdfF29(store, { periodo: '2026-09', folio: 555_001, cuerpo: pdfFalso(nuevos), obtenidoEn: T_PDF });

    const r = await releerF29(deps, RUT_EMPRESA);

    expect(r.folios[0]).toMatchObject({ resultado: 'actualizado', codigosCambiados: ['502', '538', '89'] });
    expect(r.folios[0]!.mensaje).toMatch(/no cuadra.*89/);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)?.valores).toEqual(nuevos);
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 555_001)?.coherente).toBe(false);
  });

  it('un PDF de un folio que ya no está declarado queda sin_declaracion y no escribe', async () => {
    const { deps, store } = mesGuardado();
    guardarPdfF29(store, { periodo: '2026-09', folio: 777, cuerpo: pdfFalso(COHERENTES), obtenidoEn: T_PDF });
    guardarPdfF29(store, { periodo: '2026-08', folio: 555_001, cuerpo: pdfFalso(COHERENTES), obtenidoEn: T_PDF });

    const r = await releerF29(deps, RUT_EMPRESA);

    expect(r.folios).toEqual([
      { periodo: '2026-08', folio: 555_001, resultado: 'sin_declaracion', codigosCambiados: [], mensaje: null },
      { periodo: '2026-09', folio: 777, resultado: 'sin_declaracion', codigosCambiados: [], mensaje: null },
    ]);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 777)).toBeNull();
    expect(store.lecturaF29(RUT_EMPRESA, '2026-09', 777)).toBeNull();
  });

  it('acota los períodos con desde y hasta', async () => {
    const { deps, store } = mesGuardado();
    sembrarMes(store, '2026-08', { declaraciones: [declaracion({ periodo: '2026-08', folio: 444_001 })] });
    guardarPdfF29(store, { periodo: '2026-08', folio: 444_001, cuerpo: pdfFalso(COHERENTES), obtenidoEn: T_PDF });
    guardarPdfF29(store, { periodo: '2026-09', folio: 555_001, cuerpo: pdfFalso(COHERENTES), obtenidoEn: T_PDF });

    expect((await releerF29(deps, RUT_EMPRESA, '2026-09')).folios.map((f) => f.periodo)).toEqual(['2026-09']);
    expect((await releerF29(deps, RUT_EMPRESA, undefined, '2026-08')).folios.map((f) => f.periodo)).toEqual(['2026-08']);
    expect((await releerF29(deps, RUT_EMPRESA, '2026-08', '2026-09')).folios.map((f) => f.periodo)).toEqual(['2026-08', '2026-09']);
    expect(await codigoDe(releerF29(deps, RUT_EMPRESA, '2026-13'))).toBe('PERIODO_INVALIDO');
  });

  it('sin PDF guardados no hace nada', async () => {
    const { deps } = mesGuardado();
    expect(await releerF29(deps, RUT_EMPRESA)).toEqual({ rut: RUT_EMPRESA, versionLector: VERSION_LECTOR_PRUEBA, folios: [] });
  });

  it('exige que el perfil exista', async () => {
    const { deps } = depsDePrueba();
    expect(await codigoDe(releerF29(deps, RUT_EMPRESA))).toBe('PERFIL_NO_EXISTE');
  });
});
