import { describe, expect, it } from 'vitest';
import { sincronizar } from '../../src/app/sincronizar.js';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import type { BoletaHonorarios, InformeBhe } from '../../src/domain/tipos.js';
import { textoSync } from '../../src/interfaces/formato.js';
import { depsDePrueba } from '../helpers/deps.js';
import { boleta, perfilEmpresa, RUT_EMPRESA } from '../helpers/fabricas.js';

const SEPT = parsePeriodo('2026-09');

function preparar() {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilEmpresa());
  return p;
}

const informe = (boletas: readonly BoletaHonorarios[]): InformeBhe => ({
  boletas,
  totales: {
    total: boletas.length,
    bruto: boletas.reduce((s, b) => s + b.bruto, 0),
    retencion: boletas.reduce((s, b) => s + b.retencion, 0),
    liquido: boletas.reduce((s, b) => s + b.liquido, 0),
  },
});

const ultimaSync = (db: ReturnType<typeof depsDePrueba>['db'], superficie: string) =>
  db.prepare('SELECT estado, error_codigo FROM sincronizacion WHERE superficie = ? ORDER BY id DESC LIMIT 1').get(superficie);

describe('sincronizar las boletas de honorarios recibidas', () => {
  it('con la superficie bhe las guarda, las registra como bhe.recibidas y las marca disponibles', async () => {
    const { deps, store, sii, db } = preparar();
    const boletas = [boleta({ folio: 1 }), boleta({ folio: 2, anulada: true, fechaAnulacion: '2026-09-15' })];
    sii.bhe.set('2026-09', informe(boletas));

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['bhe']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(r.superficies).toEqual(['bhe']);
    expect(r.periodos[0]!.boletasHonorarios).toBe(2);
    expect(sii.llamadas).toEqual(['bhe|2026-09']);
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-09')).toEqual(boletas);
    expect(ultimaSync(db, 'bhe.recibidas')).toEqual({ estado: 'ok', error_codigo: null });
    expect(store.disponibilidadFuentes(RUT_EMPRESA, '2026-09')).toMatchObject({ bheRecibidas: true, f29: false });
    expect(store.frescura(RUT_EMPRESA, '2026-09').bhe).not.toBeNull();
  });

  it('no es parte de la sincronización por defecto (rcv y f29)', async () => {
    const { deps, store, sii } = preparar();
    sii.bhe.set('2026-09', informe([boleta()]));

    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT);

    expect(sii.llamadas.some((l) => l.startsWith('bhe'))).toBe(false);
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-09')).toEqual([]);
  });

  it('un mes sin boletas confirmado por el SII (total 0) reemplaza las guardadas', async () => {
    const { deps, store, sii } = preparar();
    sii.bhe.set('2026-09', informe([boleta()]));
    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['bhe']);
    sii.bhe.set('2026-09', informe([]));

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['bhe']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(r.periodos[0]!.boletasHonorarios).toBe(0);
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-09')).toEqual([]);
  });

  it('un vacío ambiguo con boletas guardadas las conserva y queda RESPUESTA_VACIA', async () => {
    const { deps, store, sii, db } = preparar();
    sii.bhe.set('2026-09', informe([boleta()]));
    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['bhe']);
    sii.bhe.set('2026-09', null);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['bhe']);

    expect(r.periodos[0]!.errores).toEqual([
      {
        superficie: 'bhe.recibidas',
        codigo: 'RESPUESTA_VACIA',
        mensaje: 'Boletas de honorarios 2026-09: el SII respondió sin boletas ni total; se conservan las boletas guardadas.',
      },
    ]);
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-09')).toEqual([boleta()]);
    expect(ultimaSync(db, 'bhe.recibidas')).toEqual({ estado: 'error', error_codigo: 'RESPUESTA_VACIA' });
  });

  it('un vacío ambiguo sin nada guardado termina sin error y sin escribir', async () => {
    const { deps, store, sii, db } = preparar();
    sii.bhe.set('2026-09', null);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['bhe']);

    expect(r.periodos[0]!.errores).toEqual([]);
    expect(r.periodos[0]!.boletasHonorarios).toBeNull();
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-09')).toEqual([]);
    expect(ultimaSync(db, 'bhe.recibidas')).toEqual({ estado: 'ok', error_codigo: null });
  });

  it('datos incompletos del SII no reemplazan las boletas guardadas y no detienen los demás meses', async () => {
    const { deps, store, sii } = preparar();
    sii.bhe.set('2026-09', informe([boleta({ folio: 1 }), boleta({ folio: 2 })]));
    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['bhe']);
    sii.fallas.set('bhe|2026-09', new ErrorImpuestocl('DATOS_INCOMPLETOS', 'Boletas de honorarios 2026-09: el SII entregó 1 de 2 boletas.'));
    sii.bhe.set('2026-10', informe([boleta({ periodo: '2026-10', folio: 3 })]));

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, parsePeriodo('2026-10'), ['bhe']);

    expect(r.abortado).toBeNull();
    expect(r.periodos.map((p) => p.errores.map((e) => `${e.superficie} ${e.codigo}`))).toEqual([['bhe.recibidas DATOS_INCOMPLETOS'], []]);
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-09').map((b) => b.folio)).toEqual([1, 2]);
    expect(store.boletasHonorarios(RUT_EMPRESA, '2026-10').map((b) => b.folio)).toEqual([3]);
  });

  it('el texto de la sincronización dice cuántas boletas trajo solo cuando se pidió', async () => {
    const { deps, sii } = preparar();
    sii.bhe.set('2026-09', informe([boleta({ folio: 1 }), boleta({ folio: 2 })]));
    sii.bhe.set('2026-11', null);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, parsePeriodo('2026-11'), ['bhe']);

    expect(textoSync(r)).toBe(
      ['Sincronización 22222222-2', '2026-09: 2 boletas de honorarios', '2026-10: 0 boletas de honorarios', '2026-11: boletas de honorarios sin respuesta del SII'].join('\n'),
    );
    const sinPedir = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);
    expect(textoSync(sinPedir)).not.toContain('honorarios');
  });
});
