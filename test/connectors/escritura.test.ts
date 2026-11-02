import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { escribirAtomico } from '../../src/connectors/sistema/escritura.js';

const carpeta = () => mkdtempSync(join(tmpdir(), 'mi-sii-mcp-escritura-'));

describe('escritura atómica', () => {
  it('escribe el contenido completo y reemplaza el anterior sin dejar temporales', () => {
    const dir = carpeta();
    const ruta = join(dir, 'sesion.json');
    writeFileSync(ruta, '{"viejo":true}');

    escribirAtomico(ruta, '{"nuevo":true}');

    expect(readFileSync(ruta, 'utf8')).toBe('{"nuevo":true}');
    expect(readdirSync(dir)).toEqual(['sesion.json']);
  });

  it('si no puede escribir, lanza el error y no deja temporales ni toca el archivo anterior', () => {
    const dir = carpeta();
    const ruta = join(dir, 'no-existe', 'sesion.json');

    expect(() => escribirAtomico(ruta, 'x')).toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });
});
