import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArchivosSistema } from '../../src/connectors/sistema/archivos.js';
import { codigoDe } from '../helpers/errores.js';

function preparar() {
  const dir = mkdtempSync(join(tmpdir(), 'mi-sii-mcp-archivos-'));
  return { dir, archivos: new ArchivosSistema(join(dir, 'datos')) };
}

describe('ArchivosSistema', () => {
  it('lee un CSV o TXT y devuelve su nombre sin carpeta', async () => {
    const { dir, archivos } = preparar();
    writeFileSync(join(dir, 'Cartola Octubre.CSV'), 'fecha;monto');

    const r = await archivos.leer(join(dir, 'Cartola Octubre.CSV'), 100);

    expect(r.nombre).toBe('Cartola Octubre.CSV');
    expect(new TextDecoder().decode(r.bytes)).toBe('fecha;monto');
  });

  it('rechaza otras extensiones, los archivos grandes y los que no existen', async () => {
    const { dir, archivos } = preparar();
    writeFileSync(join(dir, 'clave.key'), 'x');
    writeFileSync(join(dir, 'grande.csv'), 'x'.repeat(200));

    expect(await codigoDe(archivos.leer(join(dir, 'clave.key'), 100))).toBe('ARCHIVO_INVALIDO');
    expect(await codigoDe(archivos.leer(join(dir, 'grande.csv'), 100))).toBe('ARCHIVO_INVALIDO');
    expect(await codigoDe(archivos.leer(join(dir, 'no-existe.csv'), 100))).toBe('ARCHIVO_INVALIDO');
  });

  it('exporta a la carpeta de exportaciones con un nombre seguro, sin salirse de ella', async () => {
    const { dir, archivos } = preparar();

    const ruta = await archivos.exportar('../libro compras 2026-10.csv', 'a;b');

    expect(ruta).toBe(join(dir, 'datos', 'exportaciones', 'libro-compras-2026-10.csv'));
    expect(readFileSync(ruta, 'utf8')).toBe('a;b');
  });
});
