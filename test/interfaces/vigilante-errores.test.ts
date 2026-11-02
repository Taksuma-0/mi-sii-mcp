import { describe, expect, it } from 'vitest';
import { vigilanteDeErrores } from '../../src/interfaces/mcp/iniciar.js';

function preparar(limite = 5, ventanaMs = 60_000) {
  const registros: string[] = [];
  const salidas: number[] = [];
  let ahora = 0;
  const v = vigilanteDeErrores({ registrar: (m) => registros.push(m), salir: (c) => salidas.push(c), ahoraMs: () => ahora, limite, ventanaMs });
  return { v, registros, salidas, avanzar: (ms: number) => (ahora += ms) };
}

describe('vigilante de errores sin capturar del proceso MCP', () => {
  it('registra en el canal de errores una promesa rechazada o una excepción suelta, y el proceso sigue', () => {
    const { v, registros, salidas } = preparar();

    v.alRechazo(new Error('falló un aviso de avance'));
    v.alExcepcion(new Error('evento inesperado'));

    expect(registros).toEqual(['mi-sii-mcp: promesa rechazada sin capturar: falló un aviso de avance', 'mi-sii-mcp: excepción sin capturar: evento inesperado']);
    expect(salidas).toEqual([]);
  });

  it('si los errores se repiten más que el límite dentro de la ventana, sale con código 1', () => {
    const { v, salidas } = preparar(2);

    v.alRechazo('uno');
    v.alRechazo('dos');
    expect(salidas).toEqual([]);
    v.alRechazo('tres');
    expect(salidas).toEqual([1]);
  });

  it('la ventana se desliza: errores espaciados nunca juntan el límite', () => {
    const { v, salidas, avanzar } = preparar(2, 1_000);

    for (let i = 0; i < 10; i++) {
      v.alRechazo(`error ${i}`);
      avanzar(600);
    }

    expect(salidas).toEqual([]);
  });
});
