import { describe, expect, it } from 'vitest';
import { consultarSituacionSii } from '../../src/app/situacion.js';
import { depsDePrueba } from '../helpers/deps.js';
import { codigoDe } from '../helpers/errores.js';
import { perfilEmpresa, RUT_EMPRESA } from '../helpers/fabricas.js';

describe('situación en Mi SII', () => {
  it('trae anotaciones y cumplimiento, y suma a novedades solo lo nuevo', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sii.situacion = {
      anotaciones: [{ codigo: '1014', cantidad: 1, fechaActivacion: '2019-03-18', descripcion: 'Debe acreditar su domicilio.', accion: 'Envíe el contrato.' }],
      cumplimiento: { estado: 'Cumple sus obligaciones tributarias', periodo: null, requisitos: [{ codigo: 'NDIR', condicion: 'B', titulo: 'Sin atrasos', cumple: true }] },
      mensajes: [],
    };

    const r = await consultarSituacionSii(deps, '22.222.222-2');
    const otra = await consultarSituacionSii(deps, RUT_EMPRESA);

    expect(r.rut).toBe(RUT_EMPRESA);
    expect(r.anotaciones.map((a) => a.codigo)).toEqual(['1014']);
    expect(r.nuevos.map((a) => a.clave)).toEqual(['A:1014:2019-03-18']);
    expect(otra.nuevos).toEqual([]);
    expect(sii.llamadas.filter((l) => l === 'situacion')).toHaveLength(2);
  });

  it('pide un perfil existente', async () => {
    const { deps } = depsDePrueba();
    expect(await codigoDe(consultarSituacionSii(deps, RUT_EMPRESA))).toBe('PERFIL_NO_EXISTE');
  });
});
