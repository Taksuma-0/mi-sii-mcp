import { describe, expect, it } from 'vitest';
import { agregarPerfil, listarPerfiles, registrarIdentidad } from '../../src/app/perfiles.js';
import { depsDePrueba } from '../helpers/deps.js';
import { perfilTributario } from '../helpers/fabricas.js';

describe('perfiles', () => {
  it('agrega perfiles con RUT normalizado y lista su estado de sesión', () => {
    const { deps } = depsDePrueba();
    agregarPerfil(deps, { rut: '22.222.222-2', alias: 'Pyme', tipo: 'empresa' });
    const persona = agregarPerfil(deps, { rut: '11.111.111-1', alias: 'Yo', tipo: 'persona', representa: ['22.222.222-2'] });
    expect(persona.representa).toEqual(['22222222-2']);
    const lista = listarPerfiles(deps);
    expect(lista.map((p) => p.rut).sort()).toEqual(['11111111-1', '22222222-2']);
    expect(lista[0]?.sesion.tieneSesion).toBe(true);
  });

  it('registrarIdentidad crea el perfil si no existe y completa la razón social si existe', () => {
    const { deps, store } = depsDePrueba();
    registrarIdentidad(deps, { rut: '22222222-2', nombre: 'EMPRESA DEMO SPA', razonSocial: 'EMPRESA DEMO SPA', tipo: 'empresa' });
    expect(store.contribuyente('22222222-2')).toMatchObject({ alias: 'EMPRESA DEMO SPA', tipo: 'empresa' });
    agregarPerfil(deps, { rut: '11111111-1', alias: 'Yo', tipo: 'persona' });
    registrarIdentidad(deps, { rut: '11111111-1', nombre: 'JUANA PÉREZ', razonSocial: null, tipo: 'persona' });
    expect(store.contribuyente('11111111-1')?.alias).toBe('Yo');
  });
});

describe('perfiles con cuenta', () => {
  it('listarPerfiles agrega el bloque cuenta solo a quien tiene lectura', () => {
    const { deps, store } = depsDePrueba();
    agregarPerfil(deps, { rut: '22.222.222-2', alias: 'Pyme', tipo: 'empresa' });
    agregarPerfil(deps, { rut: '11.111.111-1', alias: 'Yo', tipo: 'persona' });
    store.guardarPerfilTributario('22222222-2', perfilTributario(), '2026-10-21T10:00:00.000Z');

    const lista = listarPerfiles(deps);

    expect(lista.find((p) => p.rut === '22222222-2')?.cuenta).toMatchObject({ autorizadoDia20: true, obtenidoEn: '2026-10-21T10:00:00.000Z' });
    expect('cuenta' in lista.find((p) => p.rut === '11111111-1')!).toBe(false);
  });
});
