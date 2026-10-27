import { describe, expect, it } from 'vitest';
import { AVISO_MES_CANCELADO, sincronizar } from '../../src/app/sincronizar.js';
import { textoSync } from '../../src/interfaces/formato.js';
import { resumenIva } from '../../src/app/consultas.js';
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
  p.sii.valores.set('2026-09|555001', valores({ '538': 199_500, '537': 19_000, '89': 180_500 }));
  return p;
}

describe('sincronizar', () => {
  it('conserva el último conjunto completo del lado incompleto y permite una eliminación posterior confirmada', async () => {
    const { deps, store, sii, db } = mesCompleto();
    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT);
    const compras = store.resumenesRcv(RUT_EMPRESA, SEPT.texto).filter((r) => r.lado === 'COMPRA');
    const docs = store.documentosRcv(RUT_EMPRESA, SEPT.texto, { lado: 'COMPRA' });
    const fotos = store.snapshotsRcv(RUT_EMPRESA, SEPT.texto).filter((s) => s.lado === 'COMPRA');
    const despues = { ...deps, reloj: { ahora: () => new Date('2026-10-22T15:00:00.000Z') } };
    sii.detalles.set('2026-09|COMPRA|REGISTRO|33', []);
    sii.resumenes.set('2026-09|COMPRA|PENDIENTE', []);
    sii.resumenes.set('2026-09|VENTA|REGISTRO', []);

    const r = await sincronizar(despues, RUT_EMPRESA, SEPT, parsePeriodo('2026-10'));

    expect(store.documentosRcv(RUT_EMPRESA, SEPT.texto, { lado: 'COMPRA' })).toEqual(docs);
    expect(store.resumenesRcv(RUT_EMPRESA, SEPT.texto).filter((x) => x.lado === 'COMPRA')).toEqual(compras);
    expect(store.snapshotsRcv(RUT_EMPRESA, SEPT.texto).filter((s) => s.lado === 'COMPRA')).toEqual(fotos);
    expect(store.documentosRcv(RUT_EMPRESA, SEPT.texto, { lado: 'VENTA' })).toEqual([]);
    expect(r.periodos[0]!.errores).toMatchObject([{ superficie: 'rcv.COMPRA', codigo: 'DATOS_INCOMPLETOS' }]);
    expect(r.periodos[0]!.avisos).toEqual(['RCV COMPRA REGISTRO tipo 33: el detalle trajo 0 de 1 documentos.']);
    expect(r.periodos[0]!.f29Folio).toBe(555_001);
    expect(r.periodos[1]!.periodo).toBe('2026-10');
    const intento = db.prepare("SELECT id, estado, error_codigo FROM sincronizacion WHERE superficie = 'rcv.COMPRA' AND periodo = '2026-09' ORDER BY id DESC LIMIT 1").get() as { id: number; estado: string; error_codigo: string };
    expect(intento).toMatchObject({ estado: 'error', error_codigo: 'DATOS_INCOMPLETOS' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM respuesta_cruda WHERE sincronizacion_id = ?').get(intento.id)).toMatchObject({ n: 5 });
    expect(resumenIva(despues, RUT_EMPRESA, SEPT.texto).hallazgos.filter((h) => h.regla === 'IVA-06').every((h) => !h.detalle.startsWith('Compras'))).toBe(true);

    sii.resumenes.set('2026-09|COMPRA|REGISTRO', [fila(33, 0, 0, 0)]);
    await sincronizar(despues, RUT_EMPRESA, SEPT, SEPT, ['rcv']);
    expect(store.documentosRcv(RUT_EMPRESA, SEPT.texto, { lado: 'COMPRA' })).toEqual([]);
    expect(resumenIva(despues, RUT_EMPRESA, SEPT.texto).hallazgos.find((h) => h.regla === 'IVA-06' && h.detalle.startsWith('Compras'))?.detalle).toContain('1 eliminado(s)');
  });

  it('no inventa documentos, snapshot ni frescura si el primer intento de ambos lados es incompleto', async () => {
    const { deps, store, sii } = mesCompleto();
    sii.detalles.clear();
    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['rcv']);
    expect(store.resumenesRcv(RUT_EMPRESA, SEPT.texto)).toEqual([]);
    expect(store.documentosRcv(RUT_EMPRESA, SEPT.texto)).toEqual([]);
    expect(store.snapshotsRcv(RUT_EMPRESA, SEPT.texto)).toEqual([]);
    expect(store.frescura(RUT_EMPRESA, SEPT.texto)).toEqual({ rcv: null, f29: null });
    expect(r.periodos[0]!.errores.map((e) => e.codigo)).toEqual(['DATOS_INCOMPLETOS', 'DATOS_INCOMPLETOS']);
  });
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

  it('conserva el aviso detectado aunque falle la consulta del siguiente estado', async () => {
    const { deps, store, sii, db } = mesCompleto();
    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT);
    const compras = store.resumenesRcv(RUT_EMPRESA, SEPT.texto).filter((r) => r.lado === 'COMPRA');
    const docs = store.documentosRcv(RUT_EMPRESA, SEPT.texto, { lado: 'COMPRA' });
    const fotos = store.snapshotsRcv(RUT_EMPRESA, SEPT.texto).filter((s) => s.lado === 'COMPRA');
    sii.detalles.set('2026-09|COMPRA|REGISTRO|33', []);
    sii.fallas.set('resumen|2026-09|COMPRA|PENDIENTE', new ErrorImpuestocl('SII_NO_DISPONIBLE', 'Consulta no disponible.'));

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, parsePeriodo('2026-10'));

    expect(r.periodos[0]!.avisos).toEqual(['RCV COMPRA REGISTRO tipo 33: el detalle trajo 0 de 1 documentos.']);
    expect(r.periodos[0]!.errores).toEqual([{ superficie: 'rcv.COMPRA', codigo: 'SII_NO_DISPONIBLE', mensaje: 'Consulta no disponible.' }]);
    expect(r.abortado).toBeNull();
    expect(r.periodos[0]!.f29Folio).toBe(555_001);
    expect(r.periodos[1]!.periodo).toBe('2026-10');
    expect(store.resumenesRcv(RUT_EMPRESA, SEPT.texto).filter((x) => x.lado === 'COMPRA')).toEqual(compras);
    expect(store.documentosRcv(RUT_EMPRESA, SEPT.texto, { lado: 'COMPRA' })).toEqual(docs);
    expect(store.snapshotsRcv(RUT_EMPRESA, SEPT.texto).filter((s) => s.lado === 'COMPRA')).toEqual(fotos);
    const intento = db.prepare("SELECT id, estado, error_codigo FROM sincronizacion WHERE superficie = 'rcv.COMPRA' AND periodo = '2026-09' ORDER BY id DESC LIMIT 1").get() as { id: number };
    expect(intento).toMatchObject({ estado: 'error', error_codigo: 'SII_NO_DISPONIBLE' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM respuesta_cruda WHERE sincronizacion_id = ?').get(intento.id)).toMatchObject({ n: 3 });
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

  describe('cancelación', () => {
    const CANCELADA = { superficie: 'cancelacion', codigo: 'CANCELADO', mensaje: 'Sincronización cancelada; se conservan los meses ya traídos.' };

    it('cancelada durante el primer período, lo termina, no trae los siguientes e informa lo conservado', async () => {
      const { deps, store, sii, persistidos } = mesCompleto();
      const cancelar = new AbortController();
      sii.alLlamar = (llamada) => {
        if (llamada === 'f29valores|2026-09|555001') cancelar.abort();
      };

      const r = await sincronizar(deps, RUT_EMPRESA, SEPT, parsePeriodo('2026-11'), undefined, cancelar.signal);

      expect(r.abortado).toEqual(CANCELADA);
      expect(r.periodos).toEqual([{ periodo: '2026-09', errores: [], avisos: [], documentos: 4, f29Folio: 555_001 }]);
      expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)?.valores['538']).toBe(199_500);
      expect(sii.llamadas.filter((l) => !l.includes('2026-09'))).toEqual([]);
      expect(persistidos).toEqual([RUT_EMPRESA]);
    });

    it('revisa la señal antes de cada superficie, no deja escrituras a medias y marca el mes como incompleto', async () => {
      const { deps, store, sii, db } = mesCompleto();
      const cancelar = new AbortController();
      sii.alLlamar = (llamada) => {
        if (llamada === 'resumen|2026-09|VENTA|REGISTRO') cancelar.abort();
      };

      const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, undefined, cancelar.signal);

      expect(r.abortado).toEqual(CANCELADA);
      expect(store.documentosRcv(RUT_EMPRESA, SEPT.texto, { lado: 'VENTA' })).toHaveLength(2);
      expect(sii.llamadas).toEqual(['resumen|2026-09|VENTA|REGISTRO', 'detalle|2026-09|VENTA|REGISTRO|33']);
      expect(db.prepare('SELECT superficie, estado FROM sincronizacion ORDER BY id').all()).toEqual([{ superficie: 'rcv.VENTA', estado: 'ok' }]);
      expect(r.periodos[0]!.avisos).toEqual([AVISO_MES_CANCELADO]);
      expect(textoSync(r)).toContain('2026-09: 2 documentos RCV · F29 sin folio informado\n    avisos: incompleto: la sincronización se canceló antes de terminar este mes');
    });

    it('cancelada a mitad de una superficie: fila CANCELADO con su evidencia, sin escribir esa superficie', async () => {
      const { deps, store, sii, db } = mesCompleto();
      await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT);
      const { previas } = db.prepare('SELECT MAX(id) AS previas FROM sincronizacion').get() as { previas: number };
      const cancelar = new AbortController();
      sii.alLlamar = (llamada) => {
        if (llamada === 'detalle|2026-09|VENTA|REGISTRO|33') {
          // Así termina un fetch en curso cuando se aborta su señal.
          cancelar.abort();
          throw cancelar.signal.reason;
        }
      };
      sii.llamadas.length = 0;
      sii.resumenes.set('2026-09|VENTA|REGISTRO', [fila(33, 0, 0, 1)]);

      const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, undefined, cancelar.signal);

      expect(r.abortado).toEqual(CANCELADA);
      expect(r.periodos).toEqual([{ periodo: '2026-09', errores: [], avisos: [AVISO_MES_CANCELADO], documentos: 0, f29Folio: null }]);
      expect(sii.llamadas).toEqual(['resumen|2026-09|VENTA|REGISTRO', 'detalle|2026-09|VENTA|REGISTRO|33']);
      expect(store.documentosRcv(RUT_EMPRESA, SEPT.texto, { lado: 'VENTA' })).toHaveLength(2);
      const filas = db.prepare('SELECT id, superficie, estado, error_codigo FROM sincronizacion WHERE id > ? ORDER BY id').all(previas) as { id: number }[];
      expect(filas.map(({ id: _id, ...resto }) => resto)).toEqual([{ superficie: 'rcv.VENTA', estado: 'error', error_codigo: 'CANCELADO' }]);
      const evidencia = db.prepare('SELECT superficie FROM respuesta_cruda WHERE sincronizacion_id = ? ORDER BY id').all(filas[0]!.id);
      expect(evidencia).toEqual([{ superficie: 'resumen|2026-09|VENTA|REGISTRO' }, { superficie: 'detalle|2026-09|VENTA|REGISTRO|33' }]);
    });

    it('entrega la señal al abrir el SII', async () => {
      const { deps } = mesCompleto();
      const abrir = deps.abrirSii;
      const recibidas: (AbortSignal | undefined)[] = [];
      const cancelar = new AbortController();
      const r = await sincronizar(
        { ...deps, abrirSii: (rut, sumidero, signal) => { recibidas.push(signal); return abrir(rut, sumidero, signal); } },
        RUT_EMPRESA,
        SEPT,
        SEPT,
        undefined,
        cancelar.signal,
      );
      expect(r.abortado).toBeNull();
      expect(recibidas).toEqual([cancelar.signal]);
    });

    it('con la señal ya cancelada no abre la sesión del SII ni consulta ningún período', async () => {
      const { deps, store, sii } = depsDePrueba({ fallaAlAbrir: new Error('No debe abrir el SII') });
      store.guardarContribuyente(perfilEmpresa());
      const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, undefined, AbortSignal.abort());
      expect(r).toEqual({ rut: RUT_EMPRESA, superficies: ['rcv', 'f29'], periodos: [], abortado: CANCELADA });
      expect(sii.llamadas).toEqual([]);
    });
  });

  it('informa las superficies pedidas, por defecto rcv y f29', async () => {
    const { deps } = mesCompleto();
    expect((await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT)).superficies).toEqual(['rcv', 'f29']);
    expect((await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29'])).superficies).toEqual(['f29']);
  });

  it('exige que el perfil exista', async () => {
    const { deps } = depsDePrueba();
    expect(await codigoDe(sincronizar(deps, RUT_EMPRESA, SEPT, SEPT))).toBe('PERFIL_NO_EXISTE');
  });

  it.each(['SESION_REQUERIDA', 'PORTAL_CAMBIO'] as const)(
    'conserva los valores F29 guardados cuando la nueva descarga falla con %s',
    async (codigo) => {
      const { deps, store, sii, persistidos } = mesCompleto();
      const anteriores = valores({ '537': 19_000, '538': 190_000 });
      sii.valores.set('2026-09|555001', anteriores);
      await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);
      expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)).toEqual(anteriores);
      sii.fallas.set('f29valores|2026-09|555001', new ErrorImpuestocl(codigo, 'Falló la nueva descarga.'));

      const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

      if (codigo === 'SESION_REQUERIDA') {
        expect(r.abortado?.codigo).toBe(codigo);
      } else {
        expect(r.abortado).toBeNull();
        expect(r.periodos[0]!.errores).toEqual([{ superficie: 'f29.valores', codigo, mensaje: 'Falló la nueva descarga.' }]);
      }
      expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)).toEqual(anteriores);
      expect(persistidos).toEqual([RUT_EMPRESA, RUT_EMPRESA]);
    },
  );

  it('al actualizar el vigente conserva valores de otros folios presentes y retira los ausentes', async () => {
    const { deps, store, sii } = mesCompleto();
    const anterior = declaracion({ folio: 555_000, estado: 'Rectificada', fechaPresentacion: '2026-10-14' });
    const retirado = declaracion({ folio: 554_999, estado: 'Rectificada', fechaPresentacion: '2026-10-13' });
    const valoresAnterior = valores({ '538': 100_000 }, { folio: anterior.folio });
    const ahora = deps.reloj.ahora().toISOString();
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'f29', SEPT.texto, ahora);
    store.guardarF29(id, RUT_EMPRESA, SEPT.texto, [declaracion(), anterior, retirado], [
      valores({ '538': 190_000, '111': 1 }),
      valoresAnterior,
      valores({ '538': 90_000 }, { folio: retirado.folio }),
    ], ahora);
    store.terminarSincronizacion(id, ahora, 'ok');
    sii.declaraciones.set(SEPT.texto, [anterior, declaracion()]);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.abortado).toBeNull();
    expect(r.periodos[0]!.f29Folio).toBe(555_001);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(valores({ '538': 199_500, '537': 19_000, '89': 180_500 }));
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, anterior.folio)).toEqual(valoresAnterior);
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, retirado.folio)).toBeNull();
    expect(store.declaracionesF29(RUT_EMPRESA, SEPT.texto)).toEqual([anterior, declaracion()]);
  });

  it('si cambia el folio vigente y falla su PDF conserva el anterior sin asignarle sus valores al nuevo', async () => {
    const { deps, store, sii } = mesCompleto();
    await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);
    sii.declaraciones.set(SEPT.texto, [
      declaracion({ estado: 'Rectificada' }),
      declaracion({ folio: 555_002, fechaPresentacion: '2026-10-16', codigoInterno: 9002 }),
    ]);

    const r = await sincronizar(deps, RUT_EMPRESA, SEPT, SEPT, ['f29']);

    expect(r.abortado).toBeNull();
    expect(r.periodos[0]!.f29Folio).toBe(555_002);
    expect(r.periodos[0]!.errores[0]?.codigo).toBe('PORTAL_CAMBIO');
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_001)).toEqual(valores({ '538': 199_500, '537': 19_000, '89': 180_500 }));
    expect(store.valoresF29(RUT_EMPRESA, SEPT.texto, 555_002)).toBeNull();
  });
});
