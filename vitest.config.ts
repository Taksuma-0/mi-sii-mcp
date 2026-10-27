import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    // La suite nunca lanza un navegador real: una ruta forzada que no existe hace fallar `buscarNavegador()`.
    env: { IMPUESTOCL_NAVEGADOR: 'Z:\impuestocl-pruebas\sin-navegador-real.exe' },
  },
});
