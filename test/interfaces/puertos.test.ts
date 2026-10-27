import { describe, expect, it } from 'vitest';
import { puertoProhibido } from '../../src/interfaces/web/puertos.js';

describe('puertos prohibidos por fetch y los navegadores', () => {
  it.each([1, 21, 25, 6000, 6665, 6666, 6667, 6668, 6669, 6697, 10080])('rechaza el puerto %i', (puerto) => {
    expect(puertoProhibido(puerto)).toBe(true);
  });

  it.each([80, 5999, 6001, 6670, 10079, 10081, 47529, 49152, 65535])('acepta el puerto %i', (puerto) => {
    expect(puertoProhibido(puerto)).toBe(false);
  });
});
