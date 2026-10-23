import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast';
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
const importsDe = (texto: string): string[] => {
  const scanner = createScanner(true, LanguageVariant.Standard, texto);
  const tokens: { kind: SyntaxKind; value: string }[] = [];
  let kind = scanner.scan();
  while (kind !== SyntaxKind.EndOfFile) {
    tokens.push({ kind, value: scanner.getTokenValue() });
    kind = scanner.scan();
  }

  const especificadores: string[] = [];
  let declaracionPendiente = false;
  for (let i = 0; i < tokens.length; i++) {
    const actual = tokens[i]!;
    const siguiente = tokens[i + 1];
    if (actual.kind === SyntaxKind.ImportKeyword) {
      if (siguiente?.kind === SyntaxKind.StringLiteral) {
        especificadores.push(siguiente.value);
      } else if (siguiente?.kind === SyntaxKind.OpenParenToken && tokens[i + 2]?.kind === SyntaxKind.StringLiteral) {
        especificadores.push(tokens[i + 2]!.value);
      } else {
        declaracionPendiente = true;
      }
    } else if (actual.kind === SyntaxKind.ExportKeyword) {
      declaracionPendiente = true;
    }
    if (
      actual.kind === SyntaxKind.FromKeyword &&
      declaracionPendiente &&
      siguiente?.kind === SyntaxKind.StringLiteral
    ) {
      especificadores.push(siguiente.value);
      declaracionPendiente = false;
    } else if (actual.kind === SyntaxKind.SemicolonToken) {
      declaracionPendiente = false;
    }
  }
  return especificadores;
};

describe('arquitectura', () => {
  it('detecta imports laterales y dinámicos sin contar comentarios ni strings', () => {
    const muestra = `
      import type { X } from './estatico.js';
      export { X } from './reexport.js';
      import './lateral.js';
      const carga = import('node:fs');
      // import falso from './comentario.js';
      const texto = "import falso from './string.js'";
    `;

    expect(importsDe(muestra)).toEqual([
      './estatico.js',
      './reexport.js',
      './lateral.js',
      'node:fs',
    ]);
  });

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
