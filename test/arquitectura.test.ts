import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '..', 'src');

const PERMITIDO: Readonly<Record<string, readonly string[]>> = {
  domain: ['domain'],
  calendar: ['domain', 'calendar'],
  reconciliation: ['domain', 'calendar', 'reconciliation'],
  ports: ['domain', 'ports'],
  app: ['domain', 'calendar', 'reconciliation', 'ports', 'app'],
  connectors: ['domain', 'ports', 'connectors'],
  store: ['domain', 'ports', 'store'],
  interfaces: ['domain', 'ports', 'app', 'interfaces', 'main'],
  main: ['domain', 'ports', 'app', 'connectors', 'store', 'main'],
};
const PURAS = new Set(['domain', 'calendar', 'reconciliation', 'ports']);

function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosTs(ruta);
    return ruta.endsWith('.ts') ? [ruta] : [];
  });
}

const capaDe = (archivo: string): string => relative(SRC, archivo).split(sep)[0]!;
const importsDe = (texto: string): string[] => [...texto.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

describe('arquitectura', () => {
  it('cada capa importa solo las capas permitidas', () => {
    const violaciones: string[] = [];
    for (const archivo of archivosTs(SRC)) {
      const origen = capaDe(archivo);
      for (const especificador of importsDe(readFileSync(archivo, 'utf8'))) {
        if (!especificador.startsWith('.')) continue;
        const destino = capaDe(resolve(dirname(archivo), especificador));
        if (!PERMITIDO[origen]?.includes(destino)) violaciones.push(`${relative(SRC, archivo)} → ${especificador}`);
      }
    }
    expect(violaciones).toEqual([]);
  });

  it('las capas puras no importan paquetes externos ni módulos de Node', () => {
    const violaciones: string[] = [];
    for (const archivo of archivosTs(SRC)) {
      if (!PURAS.has(capaDe(archivo))) continue;
      for (const especificador of importsDe(readFileSync(archivo, 'utf8'))) {
        if (!especificador.startsWith('.')) violaciones.push(`${relative(SRC, archivo)} → ${especificador}`);
      }
    }
    expect(violaciones).toEqual([]);
  });
});
