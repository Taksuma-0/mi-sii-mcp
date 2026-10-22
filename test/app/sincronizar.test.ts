import { describe, expect, it } from 'vitest';
import { sincronizar } from '../../src/app/sincronizar.js';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { codigoDe } from '../helpers/errores.js';
import { declaracion, documento, fila, perfilEmpresa, RUT_CLIENTE, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { depsDePrueba } from '../helpers/deps.js';

const SEPT = parsePeriodo('2026-09');

function mesCompleto() {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilEmpresa());
  p.sii.resumenes.set('2026-09|VENTA|REGISTRO', [fila(33, 1_000_000, 190_000, 2), fila(39, 50_000, 9_500, 10)]);
  p.sii.detalles.set('2026-09|VENTA|REGISTRO|33', [
    documento({ lado: 'VENTA', rutContraparte: RUT_CLIENTE, folio: 1 }),
    documento({ lado: 'VENTA', rutContraparte: RUT_CLIENTE, folio: 2 }),
  ]);
  p.sii.resumenes.set('2026-09|COMPRA|REGISTRO', [fila(33, 100_000, 19_000, 1)]);
  p.sii.detalles.set('2026-09|COMPRA|REGISTRO|33', [documento({ folio: 10 })]);
  p.sii.resumenes.set('2026-09|COMPRA|PENDIENTE', [fila(33, 50_000, 9_500, 1)]);
  p.sii.detalles.set('2026-09|COMPRA|PENDIENTE|33', [documento({ folio: 11, estado: 'PENDIENTE' })]);
  p.sii.declaraciones.set('2026-09', [declaracion()]);
  p.sii.valores.set('2026-09|555001', valores({ '538': 199_500, '537': 19_000 }));
  return p;
}

describe('sincronizar', () => {
  it('guarda RCV y F29 del período y la evidencia cruda de cada llamada', async () => {
    const { deps, store, db, sii, persistidos } = mesCompleto();
    const r = await sincronizar(deps, '22.222.222-2', SEPT, SEPT);
    expect(r.abortado).toBeNull();
    expect(r.periodos).toEqual([{ periodo: '2026-09', errores: [], avisos: [], documentos: 4, f29Folio: 555_001 }]);
    expect(store.documentosRcv(RUT_EMPRESA, '2026-09')).toHaveLength(4);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)?.valores['538']).toBe(199_500);
    expect(sii.llamadas).not.toContain('detalle|2026-09|VENTA|REGISTRO|39');
    expect(sii.llamadas).toContain('resumen|2026-09|COMPRA|NO_INCLUIR');
    expect(sii.llamadas).toContain('resumen|2026-09|COMPRA|RECLAMADO');
    expect(sii.llamadas).not.toContain('resumen|2026-09|VENTA|PENDIENTE');
    const crudas = (db.prepare('SELECT COUNT(*) AS n FROM respuesta_cruda').get() as { n: number }).n;
    expect(crudas).toBe(sii.llamadas.length);
    expect(persistidos).toEqual([RUT_EMPRESA]);
  });

  it('avisa cuando el detalle trae menos documentos que el resumen', async () => {
    const { deps, sii } = mesCompleto();
    sii.detalles.set('2026-09|COMPRA|REGISTRO|33', []);
    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT);
    expect(r.periodos[0]!.avisos).toEqual(['RCV COMPRA REGISTRO tipo 33: el detalle trajo 0 de 1 documentos.']);
  });

  it('si fallan los valores del F29 guarda igual la declaración, registra el error y deja diagnóstico', async () => {
    const { deps, store, sii, diagnosticos } = mesCompleto();
    sii.valores.clear();
    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT);
    expect(r.periodos[0]!.errores).toEqual([{ superficie: 'f29.valores', codigo: 'PORTAL_CAMBIO', mensaje: 'El PDF del F29 no trajo valores.' }]);
    expect(store.declaracionesF29(RUT_EMPRESA, '2026-09')).toHaveLength(1);
    expect(store.frescura(RUT_EMPRESA, '2026-09').f29).not.toBeNull();
    expect(diagnosticos[0]?.nombre).toBe('22222222-2-2026-09-f29.valores.json');
  });

  it('si la sesión expira a mitad de camino conserva lo traído y reporta abortado', async () => {
    const { deps, store, sii } = mesCompleto();
    sii.fallas.set('resumen|2026-09|VENTA|REGISTRO', new ErrorImpuestocl('SESION_REQUERIDA', 'La sesión del SII expiró.'));
    const r = await sincronizar(deps, RUT_EMPRESA, parsePeriodo('2026-08'), SEPT);
    expect(r.abortado).toEqual({ superficie: 'sesion', codigo: 'SESION_REQUERIDA', mensaje: 'La sesión del SII expiró.' });
    expect(store.periodosConDatos(RUT_EMPRESA)).toEqual(['2026-08']);
  });

  it('si no se puede abrir la sesión reporta abortado sin lanzar', async () => {
    const { deps, store } = depsDePrueba({ fallaAlAbrir: new ErrorImpuestocl('SESION_REQUERIDA', 'Sin sesión.') });
    store.guardarContribuyente(perfilEmpresa());
    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT);
    expect(r.abortado?.codigo).toBe('SESION_REQUERIDA');
    expect(r.periodos).toEqual([]);
  });

  it('exige que el perfil exista', async () => {
    const { deps } = depsDePrueba();
    expect(await codigoDe(sincronizar(deps, RUT_EMPRESA, SEPT, SEPT))).toBe('PERFIL_NO_EXISTE');
  });
});
