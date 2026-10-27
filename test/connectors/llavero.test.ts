import { describe, expect, it } from 'vitest';
import { LlaveroSistema } from '../../src/connectors/secretos/llavero.js';

describe.skipIf(process.env['MI_SII_MCP_TEST_LLAVERO'] !== '1')('LlaveroSistema (llavero real)', () => {
  it('guarda, lee y borra una clave', async () => {
    const llavero = new LlaveroSistema();
    const rut = '66666666-6';
    await llavero.guardar(rut, 'prueba-123');
    expect(await llavero.obtener(rut)).toBe('prueba-123');
    await llavero.borrar(rut);
    expect(await llavero.obtener(rut)).toBeNull();
  });
});
