import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { ErrorMiSiiMcp } from '../../domain/errores.js';
import type { ArchivosLocales } from '../../ports/index.js';

/** Solo se leen cartolas en texto: así un pedido equivocado no puede leer otros archivos del equipo. */
const EXTENSIONES = new Set(['.csv', '.txt']);

/** Nombre de archivo seguro para exportar: sin carpetas ni caracteres raros, con guiones en vez de espacios. */
const nombreSeguro = (nombre: string): string =>
  basename(nombre)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '') || 'exportacion.csv';

/** Archivos del equipo: lee las cartolas que indica la persona y exporta a `<carpeta de datos>/exportaciones`. */
export class ArchivosSistema implements ArchivosLocales {
  constructor(private readonly home: string) {}

  async leer(ruta: string, maxBytes: number): Promise<{ nombre: string; bytes: Uint8Array }> {
    const nombre = basename(ruta);
    if (!EXTENSIONES.has(extname(nombre).toLowerCase())) throw new ErrorMiSiiMcp('ARCHIVO_INVALIDO', 'Solo se importan cartolas .csv o .txt (desde Excel: Guardar como CSV).');
    const info = await stat(ruta).catch(() => null);
    if (!info?.isFile()) throw new ErrorMiSiiMcp('ARCHIVO_INVALIDO', `No se encontró el archivo ${nombre}.`);
    if (info.size > maxBytes) throw new ErrorMiSiiMcp('ARCHIVO_INVALIDO', `El archivo ${nombre} pasa del máximo de ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    return { nombre, bytes: new Uint8Array(await readFile(ruta)) };
  }

  async exportar(nombre: string, contenido: string): Promise<string> {
    const carpeta = join(this.home, 'exportaciones');
    await mkdir(carpeta, { recursive: true });
    const ruta = join(carpeta, nombreSeguro(nombre));
    await writeFile(ruta, contenido, 'utf8');
    return ruta;
  }
}
