import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    // La suite nunca lanza un navegador real: una ruta forzada que no existe hace fallar `buscarNavegador()`, y el lanzador real
    // se niega a correr con VITEST definido.
    env: { MI_SII_MCP_NAVEGADOR: 'Z:/mi-sii-mcp-pruebas/sin-navegador-real.exe' },
  },
});
