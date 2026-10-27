import { describe, expect, it } from 'vitest';
import { sincronizar } from '../../src/app/sincronizar.js';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { textoSync } from '../../src/interfaces/formato.js';
import { depsDePrueba } from '../helpers/deps.js';
import { declaracion, perfilEmpresa, propuesta, RUT_EMPRESA, valores } from '../helpers/fabricas.js';

const SEPT = parsePeriodo('2026-09');

function preparar() {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilEmpresa());
  return p;
}

const ultimaSync = (db: ReturnType<typeof depsDePrueba>['db'], superficie: string) =>
  db.prepare('SELECT estado, error_codigo FROM sincronizacion WHERE superficie = ? ORDER BY id DESC LIMIT 1').get(superficie);

describe('sincronizar la propuesta de F29', () => {
  it('con la superficie propuesta la guarda, la registra como f29.propuesta y la marca disponible', async () => {
    const { deps, store, sii, db } = preparar();
    sii.propuestas.set('2026-09', propuesta());

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['propuesta']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(r.superficies).toEqual(['propuesta']);
    expect(sii.llamadas).toEqual(['propuesta|2026-09']);
    expect(store.propuestaF29(RUT_EMPRESA, '2026-09')).toEqual(propuesta());
    expect(ultimaSync(db, 'f29.propuesta')).toEqual({ estado: 'ok', error_codigo: null });
    expect(store.disponibilidadFuentes(RUT_EMPRESA, '2026-09')).toMatchObject({ propuestaF29: true, f29: false });
    expect(store.frescura(RUT_EMPRESA, '2026-09').propuesta).not.toBeNull();
  });

  it('no es parte de la sincronización por defecto (rcv y f29)', async () => {
    const { deps, store, sii } = preparar();
    sii.propuestas.set('2026-09', propuesta());

    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT);

    expect(sii.llamadas.some((l) => l.startsWith('propuesta'))).toBe(false);
    expect(store.propuestaF29(RUT_EMPRESA, '2026-09')).toBeNull();
  });

  it('se puede combinar con las otras superficies', async () => {
    const { deps, store, sii } = preparar();
    sii.declaraciones.set('2026-09', [declaracion()]);
    sii.valores.set('2026-09|555001', valores({ '538': 199_500, '537': 19_000 }));
    sii.propuestas.set('2026-09', propuesta());

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29', 'propuesta']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(r.periodos[0]!.f29Folio).toBe(555_001);
    expect(store.propuestaF29(RUT_EMPRESA, '2026-09')).not.toBeNull();
  });

  it('un mes sin propuesta (tipo 48) reemplaza la propuesta guardada: es una respuesta real del SII', async () => {
    const { deps, store, sii } = preparar();
    sii.propuestas.set('2026-09', propuesta());
    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['propuesta']);
    const sin = propuesta({ tipoPropuesta: 48, descripcionTipo: 'Sin propuesta', estadoCalculo: 5, propuestos: {}, administrativos: {}, sinPropuesta: true });
    sii.propuestas.set('2026-09', sin);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['propuesta']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(store.propuestaF29(RUT_EMPRESA, '2026-09')).toEqual(sin);
  });

  it('si el SII responde sin datos y había una propuesta guardada, la conserva y queda RESPUESTA_VACIA', async () => {
    const { deps, store, sii, db } = preparar();
    sii.propuestas.set('2026-09', propuesta());
    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['propuesta']);
    sii.propuestas.set('2026-09', null);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['propuesta']);

    expect(r.periodos[0]!.errores).toEqual([
      { superficie: 'f29.propuesta', codigo: 'RESPUESTA_VACIA', mensaje: 'Propuesta F29 2026-09: el SII respondió sin datos; se conservan los datos guardados.' },
    ]);
    expect(store.propuestaF29(RUT_EMPRESA, '2026-09')).toEqual(propuesta());
    expect(ultimaSync(db, 'f29.propuesta')).toEqual({ estado: 'error', error_codigo: 'RESPUESTA_VACIA' });
  });

  it('si el SII responde sin datos y no había nada guardado, termina sin error y sin escribir', async () => {
    const { deps, store, sii, db } = preparar();

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['propuesta']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(store.propuestaF29(RUT_EMPRESA, '2026-09')).toBeNull();
    expect(ultimaSync(db, 'f29.propuesta')).toEqual({ estado: 'ok', error_codigo: null });
    expect(sii.llamadas).toEqual(['propuesta|2026-09']);
  });

  it('un error de la propuesta (sin permiso) queda en los errores del mes y no detiene los demás meses ni conserva datos nuevos', async () => {
    const { deps, store, sii } = preparar();
    sii.propuestas.set('2026-10', propuesta({ periodo: '2026-10' }));
    sii.fallas.set('propuesta|2026-09', new ErrorImpuestocl('SIN_PERMISO', 'Propuesta F29: no autorizado'));

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, parsePeriodo('2026-10'), ['propuesta']);

    expect(r.abortado).toBeNull();
    expect(r.periodos.map((p) => p.errores.map((e) => `${e.superficie} ${e.codigo}`))).toEqual([['f29.propuesta SIN_PERMISO'], []]);
    expect(store.propuestaF29(RUT_EMPRESA, '2026-09')).toBeNull();
    expect(store.propuestaF29(RUT_EMPRESA, '2026-10')).not.toBeNull();
  });

  it('el texto de la sincronización dice qué trajo la propuesta solo cuando se pidió', async () => {
    const { deps, sii } = preparar();
    sii.propuestas.set('2026-09', propuesta());
    sii.propuestas.set('2026-10', propuesta({ periodo: '2026-10', tipoPropuesta: 48, propuestos: {}, administrativos: {}, sinPropuesta: true }));

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, parsePeriodo('2026-11'), ['propuesta']);

    expect(textoSync(r)).toBe(['Sincronización 22222222-2', '2026-09: propuesta con datos', '2026-10: sin propuesta del SII', '2026-11: propuesta sin respuesta del SII'].join('\n'));
    const sinPedir = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);
    expect(textoSync(sinPedir)).not.toContain('propuesta');
  });
});
