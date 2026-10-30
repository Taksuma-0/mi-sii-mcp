import { ErrorMiSiiMcp } from '../../src/domain/errores.js';
import type { ArchivosLocales } from '../../src/ports/index.js';

/** Archivos en memoria: lo que la persona tendría en su equipo y lo que mi-sii-mcp exporta. */
export class ArchivosFalsos implements ArchivosLocales {
  readonly archivos = new Map<string, Uint8Array>();
  readonly exportados = new Map<string, string>();

  poner(ruta: string, contenido: string | Uint8Array): void {
    this.archivos.set(ruta, typeof contenido === 'string' ? new TextEncoder().encode(contenido) : contenido);
  }

  async leer(ruta: string, maxBytes: number): Promise<{ nombre: string; bytes: Uint8Array }> {
    const bytes = this.archivos.get(ruta);
    if (!bytes) throw new ErrorMiSiiMcp('ARCHIVO_INVALIDO', 'No se encontró el archivo.');
    if (bytes.length > maxBytes) throw new ErrorMiSiiMcp('ARCHIVO_INVALIDO', 'El archivo es demasiado grande.');
    return { nombre: ruta.split(/[\\/]/).at(-1)!, bytes };
  }

  async exportar(nombre: string, contenido: string): Promise<string> {
    const ruta = `C:/exportaciones/${nombre}`;
    this.exportados.set(ruta, contenido);
    return ruta;
  }
}
