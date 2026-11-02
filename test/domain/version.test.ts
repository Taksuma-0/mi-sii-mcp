import { describe, expect, it } from 'vitest';
import { compararVersiones, esMasNueva } from '../../src/domain/version.js';

describe('comparación de versiones', () => {
  it('compara por número cada parte (mayor, menor, parche)', () => {
    expect(compararVersiones('0.3.0', '0.2.0')).toBe(1);
    expect(compararVersiones('0.2.0', '0.2.0')).toBe(0);
    expect(compararVersiones('0.2.9', '0.10.0')).toBe(-1);
    expect(compararVersiones('1.0.0', '0.99.99')).toBe(1);
  });

  it('ignora sufijos de prueba o prerelease y partes que faltan', () => {
    expect(compararVersiones('0.3.0-test', '0.3.0')).toBe(0);
    expect(compararVersiones('0.3', '0.3.0')).toBe(0);
  });

  it('solo es más nueva una versión válida mayor que la actual', () => {
    expect(esMasNueva('0.3.1', '0.3.0')).toBe(true);
    expect(esMasNueva('0.3.0', '0.3.0')).toBe(false);
    expect(esMasNueva(null, '0.3.0')).toBe(false);
    expect(esMasNueva('no-es-version', '0.3.0')).toBe(false);
  });
});
