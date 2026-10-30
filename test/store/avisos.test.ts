import { describe, expect, it } from 'vitest';
import { avisoDeHallazgo, avisoDePlazo, type AvisoCandidato } from '../../src/domain/avisos.js';
import { abrirDb } from '../../src/store/sqlite/db.js';
import { SqliteStore } from '../../src/store/sqlite/store.js';
import { RUT_EMPRESA, RUT_PERSONA } from '../helpers/fabricas.js';

const candidato = (clave: string, o: Partial<AvisoCandidato> = {}): AvisoCandidato => ({ rut: RUT_EMPRESA, clave, tipo: 'plazo', severidad: 'critico', titulo: `Aviso ${clave}`, detalle: 'Detalle', ...o });
const T1 = '2026-10-30T12:00:00.000Z';
const T2 = '2026-10-31T12:00:00.000Z';

describe('avisos en la base', () => {
  it('registra solo los avisos nuevos: el mismo aviso no se repite aunque se vuelva a detectar', () => {
    const store = new SqliteStore(abrirDb(':memory:'));
    const primeros = store.registrarAvisos([candidato('a'), candidato('b')], T1);
    const segundos = store.registrarAvisos([candidato('b'), candidato('c'), candidato('a', { rut: RUT_PERSONA })], T2);

    expect(primeros.map((a) => a.clave)).toEqual(['a', 'b']);
    expect(segundos.map((a) => [a.rut, a.clave])).toEqual([[RUT_EMPRESA, 'c'], [RUT_PERSONA, 'a']]);
    expect(segundos[0]).toMatchObject({ creadoEn: T2, notificadoEn: null, vistoEn: null, titulo: 'Aviso c' });
  });

  it('filtra por RUT, sin ver y sin notificar, y marca vistos o notificados', () => {
    const store = new SqliteStore(abrirDb(':memory:'));
    const [a, b] = store.registrarAvisos([candidato('a'), candidato('b')], T1);
    store.registrarAvisos([candidato('x', { rut: RUT_PERSONA })], T1);

    store.marcarAvisos([a!.id], 'visto', T2);
    store.marcarAvisos([a!.id, b!.id], 'notificado', T2);

    expect(store.avisos({ rut: RUT_EMPRESA, sinVer: true }).map((x) => x.clave)).toEqual(['b']);
    expect(store.avisos({ sinNotificar: true }).map((x) => x.clave)).toEqual(['x']);
    expect(store.avisos({ rut: RUT_EMPRESA })[0]).toMatchObject({ clave: 'a', vistoEn: T2, notificadoEn: T2 });
  });
});

describe('claves de los avisos', () => {
  it('un hallazgo y un plazo tienen una clave estable que cambia cuando el plazo vence', () => {
    const h = avisoDeHallazgo({ regla: 'IVA-04', severidad: 'critico', naturaleza: 'DERIVADO', rut: RUT_EMPRESA, periodo: '2026-09', titulo: 'F29 no presentado y vencido', detalle: 'd', montos: null, evidencia: ['F29:2026-09'] });
    expect(h).toEqual({ rut: RUT_EMPRESA, clave: 'H:IVA-04:2026-09:F29:2026-09', tipo: 'hallazgo', severidad: 'critico', titulo: 'F29 no presentado y vencido (2026-09)', detalle: 'd' });

    const plazo = { rut: RUT_EMPRESA, tipo: 'F29' as const, vence: '2026-11-20', diasRestantes: 3, descripcion: 'Presentar el F29 de 2026-10', referencia: '2026-10' };
    expect(avisoDePlazo(plazo)).toMatchObject({ clave: 'P:F29:2026-10:proximo', severidad: 'advertencia', tipo: 'plazo' });
    expect(avisoDePlazo({ ...plazo, diasRestantes: -1 })).toMatchObject({ clave: 'P:F29:2026-10:vencido', severidad: 'critico' });
  });
});
