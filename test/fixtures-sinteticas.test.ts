import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PERMITIDOS = new Set(['11111111-1', '22222222-2', '33333333-3', '44444444-4', '55555555-5', '66666666-6']);
const CUERPOS_PERMITIDOS = new Set([...PERMITIDOS].map((r) => r.split('-')[0]!));
const DIRECTORIOS = ['fixtures', 'golden'].map((d) => resolve(import.meta.dirname, d));

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

describe('fixtures sintéticas', () => {
  it('solo contienen RUT de la lista sintética', () => {
    const extranos: string[] = [];
    for (const dir of DIRECTORIOS) {
      for (const archivo of archivos(dir)) {
        const texto = readFileSync(archivo, 'utf8');
        for (const m of texto.matchAll(/\b(\d{1,2}\.?\d{3}\.?\d{3})-([\dkK])\b/g)) {
          const rut = `${m[1]!.replace(/\./g, '')}-${m[2]!.toUpperCase()}`;
          if (!PERMITIDOS.has(rut)) extranos.push(`${archivo}: ${rut}`);
        }
        for (const m of texto.matchAll(/"(?:detRutDoc|rutDoc|rutEmisor|rut|rutContribuyente|usrEmpRut|rutemisor_\d+|rutreceptor_\d+|rut_arrastre)"\s*:\s*"?(\d{7,8})"?/g)) {
          if (!CUERPOS_PERMITIDOS.has(m[1]!)) extranos.push(`${archivo}: ${m[1]}`);
        }
        // Páginas HTML del SII: asignaciones JS (`arr_informe_mensual['rutemisor_1'] = "…"`, también `rutreceptor_N` de las emitidas) y parámetros de URL (`rut_arrastre=…`).
        for (const m of texto.matchAll(/(?:\[\s*['"](?:rutemisor_\d+|rutreceptor_\d+|rut_arrastre)['"]\s*\]\s*=\s*["']?|\brut_arrastre=)(\d{7,8})/g)) {
          if (!CUERPOS_PERMITIDOS.has(m[1]!)) extranos.push(`${archivo}: ${m[1]}`);
        }
      }
    }
    expect(extranos).toEqual([]);
  });
});
