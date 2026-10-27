import { describe, expect, it } from 'vitest';
import { LlaveroSistema, type CrearEntrada } from '../../src/connectors/secretos/llavero.js';

/** Llavero en memoria por servicio y RUT; `fallaGuardar` simula un llavero que no acepta escribir. */
function llaveroFalso(inicial: Record<string, string>, fallaGuardar = false) {
  const claves = new Map(Object.entries(inicial));
  const crear: CrearEntrada = (servicio, rut) => {
    const k = `${servicio}|${rut}`;
    return {
      getPassword: () => claves.get(k) ?? null,
      setPassword: (c) => {
        if (fallaGuardar) throw new Error('sin acceso');
        claves.set(k, c);
      },
      deletePassword: () => claves.delete(k),
    };
  };
  return { llavero: new LlaveroSistema(crear), claves };
}

describe('llavero: mudanza desde el nombre anterior', () => {
  it('lee con el nombre nuevo y, si solo hay clave con el anterior, la muda', async () => {
    const { llavero, claves } = llaveroFalso({ 'impuestocl|11111111-1': 'clave ficticia' });
    expect(await llavero.obtener('11111111-1')).toBe('clave ficticia');
    expect([...claves.keys()]).toEqual(['mi-sii-mcp|11111111-1']);
    expect(await llavero.obtener('11111111-1')).toBe('clave ficticia');
  });

  it('si no puede guardar con el nombre nuevo, conserva la anterior y la sigue entregando', async () => {
    const { llavero, claves } = llaveroFalso({ 'impuestocl|11111111-1': 'clave ficticia' }, true);
    expect(await llavero.obtener('11111111-1')).toBe('clave ficticia');
    expect([...claves.keys()]).toEqual(['impuestocl|11111111-1']);
  });

  it('prefiere la nueva, guarda siempre con el nombre nuevo y borrar quita ambas', async () => {
    const { llavero, claves } = llaveroFalso({ 'mi-sii-mcp|11111111-1': 'nueva', 'impuestocl|11111111-1': 'vieja' });
    expect(await llavero.obtener('11111111-1')).toBe('nueva');
    await llavero.guardar('22222222-2', 'otra');
    expect(claves.get('mi-sii-mcp|22222222-2')).toBe('otra');
    await llavero.borrar('11111111-1');
    expect([...claves.keys()]).toEqual(['mi-sii-mcp|22222222-2']);
    expect(await llavero.obtener('33333333-3')).toBeNull();
  });
});
