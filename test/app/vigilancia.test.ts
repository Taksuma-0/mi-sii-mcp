import { describe, expect, it } from 'vitest';
import { plazos } from '../../src/app/consultas.js';
import type { DepsApp } from '../../src/app/deps.js';
import { carteraEstado, novedades, vigilar } from '../../src/app/vigilancia.js';
import { vencimientoF22 } from '../../src/calendar/plazos.js';
import { depsDePrueba } from '../helpers/deps.js';
import { declaracionF22, perfilEmpresa, perfilPersona, RUT_EMPRESA, RUT_PERSONA } from '../helpers/fabricas.js';
import { T_SEMBRADO } from '../helpers/sembrar.js';

describe('plazo del F22', () => {
  it('con pago vence el 30 de abril del año tributario', () => {
    expect(vencimientoF22(2027)).toBe('2027-04-30');
  });

  it('aparece en los plazos cuando se acerca y desaparece con el F22 presentado', () => {
    const { deps, store } = depsDePrueba({ ahora: '2027-04-10T15:00:00.000Z' });
    store.guardarContribuyente(perfilPersona());

    const antes = plazos(deps, RUT_PERSONA, 30).filter((p) => p.tipo === 'F22');
    expect(antes).toEqual([expect.objectContaining({ tipo: 'F22', vence: '2027-04-30', diasRestantes: 20, referencia: 'AT2027' })]);
    expect(antes[0]!.descripcion).toContain('sin pago o con devolución');

    const id = store.iniciarSincronizacion(RUT_PERSONA, 'f22', 'AT2027', T_SEMBRADO);
    store.reemplazarF22Declaraciones(id, RUT_PERSONA, 2027, [declaracionF22({ rut: RUT_PERSONA, anioTributario: 2027 })], T_SEMBRADO);
    store.terminarSincronizacion(id, T_SEMBRADO, 'ok');
    expect(plazos(deps, RUT_PERSONA, 30).filter((p) => p.tipo === 'F22')).toEqual([]);
  });

  it('lejos de abril no aparece', () => {
    const { deps, store } = depsDePrueba({ ahora: '2026-10-30T15:00:00.000Z' });
    store.guardarContribuyente(perfilPersona());
    expect(plazos(deps, RUT_PERSONA, 30).filter((p) => p.tipo === 'F22')).toEqual([]);
  });
});

describe('vigilar', () => {
  function preparar(conSesion: (rut: string) => boolean = () => true) {
    const p = depsDePrueba({ ahora: '2026-10-30T15:00:00.000Z' });
    p.store.guardarContribuyente(perfilEmpresa());
    p.store.guardarContribuyente(perfilPersona());
    const deps: DepsApp = { ...p.deps, sesiones: { estado: (rut) => ({ tieneSesion: conSesion(rut), guardadaEn: conSesion(rut) ? '2026-10-27T10:00:00.000Z' : null, bloqueado: false }) } };
    return { ...p, deps };
  }

  it('avisa una vez cada anotación vigente de Mi SII, y si Mi SII falla la revisión sigue', async () => {
    const { deps, sii } = preparar();
    sii.situacion = { anotaciones: [{ codigo: '4310', cantidad: 1, fechaActivacion: '2026-10-13', descripcion: 'No ha presentado su F29.', accion: 'Envíe la declaración.' }], cumplimiento: null, mensajes: [] };

    const primera = await vigilar(deps);
    const segunda = await vigilar(deps);
    sii.situacionSii = async () => {
      throw new Error('Mi SII no responde');
    };
    const tercera = await vigilar(deps);

    expect(primera.nuevos.filter((a) => a.tipo === 'anotacion').map((a) => [a.rut, a.clave])).toEqual([
      [RUT_EMPRESA, 'A:4310:2026-10-13'],
      [RUT_PERSONA, 'A:4310:2026-10-13'],
    ]);
    expect(segunda.nuevos).toEqual([]);
    expect(tercera.revisadas.map((r) => r.estado)).toEqual(['ok', 'ok']);
  });

  it('reintenta un mes que ayer falló por el SII, lo deja al día y lo cuenta en la revisión', async () => {
    const { deps, store, sii } = preparar((rut) => rut === RUT_EMPRESA);
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'rcv.VENTA', '2026-05', '2026-10-29T10:00:00.000Z');
    store.terminarSincronizacion(id, '2026-10-29T10:00:01.000Z', 'error', { codigo: 'SII_NO_DISPONIBLE', detalle: 'El SII no respondió.' });

    const r = await vigilar(deps);

    expect(sii.llamadas).toContain('resumen|2026-05|VENTA|REGISTRO');
    expect(r.revisadas.find((x) => x.rut === RUT_EMPRESA)).toMatchObject({ estado: 'ok', reintentados: 1 });
    expect(store.pendientesDeReintento(RUT_EMPRESA, '2026-10-01T00:00:00.000Z')).toEqual([]);
  });

  it('no reintenta lo que el SII no resolvería esperando ni lo que ya falló 5 veces', async () => {
    const { deps, store, sii } = preparar((rut) => rut === RUT_EMPRESA);
    const fallo = (superficie: string, periodo: string, codigo: string, en: string) => {
      const id = store.iniciarSincronizacion(RUT_EMPRESA, superficie, periodo, en);
      store.terminarSincronizacion(id, en, 'error', { codigo, detalle: 'x' });
    };
    fallo('rcv.COMPRA', '2026-04', 'PORTAL_CAMBIO', '2026-10-29T10:00:00.000Z');
    for (let i = 0; i < 5; i++) fallo('f29', '2026-03', 'SII_NO_DISPONIBLE', `2026-10-2${i}T10:00:00.000Z`);

    const r = await vigilar(deps);

    expect(sii.llamadas.some((l) => l.includes('2026-04') || l.includes('2026-03'))).toBe(false);
    expect(r.revisadas.find((x) => x.rut === RUT_EMPRESA)).not.toHaveProperty('reintentados');
  });

  it('trae el mes anterior y el actual de cada cuenta con sesión y registra los avisos una sola vez', async () => {
    const { deps, sii } = preparar();

    const primera = await vigilar(deps);
    const segunda = await vigilar(deps);

    expect(primera.revisadas).toHaveLength(2);
    expect(primera.revisadas).toEqual(expect.arrayContaining([{ rut: RUT_PERSONA, estado: 'ok' }, { rut: RUT_EMPRESA, estado: 'ok' }]));
    expect(sii.llamadas).toContain('f29|2026-09');
    expect(sii.llamadas).toContain('f29|2026-10');
    // La empresa no presentó el F29 de septiembre, que venció el 28 de octubre.
    expect(primera.nuevos.map((a) => [a.rut, a.tipo, a.severidad])).toContainEqual([RUT_EMPRESA, 'hallazgo', 'critico']);
    expect(segunda.nuevos).toEqual([]);
  });

  it('un F29 vencido se avisa una sola vez: el hallazgo ya lo cubre, no se repite como plazo', async () => {
    const { deps } = preparar();
    const r = await vigilar(deps);
    expect(r.nuevos.filter((a) => a.rut === RUT_EMPRESA && a.titulo.includes('2026-09'))).toHaveLength(1);
    expect(r.nuevos.filter((a) => a.tipo === 'plazo' && a.clave.startsWith('P:F29:'))).toEqual([]);
  });

  it('una persona sin RCV no se sincroniza como si declarara IVA', async () => {
    const { deps, sii } = preparar((rut) => rut === RUT_PERSONA);
    await vigilar(deps);
    expect(sii.llamadas.filter((l) => l.startsWith('f29|'))).toEqual([]);
  });

  it('una cuenta sin sesión no rompe la revisión y se avisa una sola vez', async () => {
    const { deps } = preparar((rut) => rut !== RUT_EMPRESA);

    const primera = await vigilar(deps);
    const segunda = await vigilar(deps);

    expect(primera.revisadas).toContainEqual({ rut: RUT_EMPRESA, estado: 'sin_sesion' });
    expect(primera.nuevos.filter((a) => a.tipo === 'sesion').map((a) => a.rut)).toEqual([RUT_EMPRESA]);
    expect(segunda.nuevos).toEqual([]);
  });

  it('novedades devuelve los avisos sin ver y los marca vistos', async () => {
    const { deps } = preparar();
    await vigilar(deps);

    const vistos = novedades(deps, RUT_EMPRESA);

    expect(vistos.length).toBeGreaterThan(0);
    expect(vistos.every((a) => a.rut === RUT_EMPRESA)).toBe(true);
    expect(novedades(deps, RUT_EMPRESA)).toEqual([]);
  });
});

describe('carteraEstado', () => {
  it('resume cada cuenta: sesión, F29 vencidos, hallazgos críticos, próximo plazo, avisos y banco', async () => {
    const p = depsDePrueba({ ahora: '2026-10-30T15:00:00.000Z' });
    p.store.guardarContribuyente(perfilEmpresa());
    await vigilar(p.deps);
    p.store.guardarImportacionBanco(RUT_EMPRESA, 'principal', { archivo: 'x.csv', sha256: 'x', filas: 1 }, [{ huella: 'h', fecha: '2026-10-05', descripcion: 'X', documento: null, monto: -1, saldo: null }], '2026-10-30T15:00:00.000Z');

    const [fila] = carteraEstado(p.deps);

    expect(fila).toMatchObject({ rut: RUT_EMPRESA, alias: 'Mi Pyme', sesion: 'activa', f29Vencidos: 1, masAntiguoVencido: '2026-09', movimientosSinConciliar: 1 });
    expect(fila!.hallazgosCriticos).toBeGreaterThan(0);
    expect(fila!.avisosSinVer).toBeGreaterThan(0);
  });
});
