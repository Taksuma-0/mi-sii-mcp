import { describe, expect, it } from 'vitest';

describe('andamiaje', () => {
  it('ejecuta tests en Node 22 o superior', () => {
    const mayor = Number(process.versions.node.split('.')[0]);
    expect(mayor).toBeGreaterThanOrEqual(22);
  });
});
