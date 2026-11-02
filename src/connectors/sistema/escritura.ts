import { renameSync, rmSync, writeFileSync } from 'node:fs';

let contador = 0;

/**
 * Escribe en un archivo temporal de la misma carpeta y lo renombra sobre el destino: un corte a mitad de camino deja el
 * archivo anterior intacto, nunca uno a medias (p. ej., una sesión con el JSON roto que obligaría a entrar de nuevo).
 */
export function escribirAtomico(ruta: string, contenido: string | Uint8Array, opciones: { readonly mode?: number } = {}): void {
  contador += 1;
  const temporal = `${ruta}.tmp-${process.pid}-${contador}`;
  try {
    writeFileSync(temporal, contenido, opciones.mode === undefined ? {} : { mode: opciones.mode });
    renameSync(temporal, ruta);
  } catch (error) {
    rmSync(temporal, { force: true });
    throw error;
  }
}
