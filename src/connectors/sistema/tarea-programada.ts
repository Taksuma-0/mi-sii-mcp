import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ErrorMiSiiMcp } from '../../domain/errores.js';
import type { TareaProgramada } from '../../ports/index.js';
import { ejecutorSistema, type Ejecutor } from './ejecutor.js';

/** Nombre de la tarea en el Programador de tareas, dentro de una carpeta propia. */
export const NOMBRE_TAREA = 'mi-sii-mcp\\revision-diaria';

/** Rutas de Node y del programa compilado de mi-sii-mcp que corre la tarea. */
export interface RutasTarea {
  readonly node: string;
  readonly bin: string;
}

/** El `bin.js` compilado: junto a este archivo en `dist` o, desde el código fuente, en el `dist` del proyecto. */
export function rutasPorDefecto(): RutasTarea {
  const candidatos = [new URL('../../interfaces/cli/bin.js', import.meta.url), new URL('../../../dist/interfaces/cli/bin.js', import.meta.url)].map((u) => fileURLToPath(u));
  const bin = candidatos.find((c) => c.endsWith('.js') && existsSync(c));
  if (!bin) throw new ErrorMiSiiMcp('SISTEMA_FALLO', 'No se encontró mi-sii-mcp compilado para la revisión diaria: ejecuta `npm run build` en la carpeta mi-sii-mcp.');
  return { node: process.execPath, bin };
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Revisión diaria con el Programador de tareas de Windows (`schtasks.exe`): ejecuta `vigilar --notificar` con `conhost
 * --headless`, para que no se abra una consola. Las rutas van entre comillas y no pueden traer comillas propias.
 */
export class TareaProgramadaWindows implements TareaProgramada {
  constructor(
    private readonly ejecutar: Ejecutor = ejecutorSistema,
    private readonly rutas: RutasTarea | (() => RutasTarea) = rutasPorDefecto,
  ) {}

  async activar(hora: string): Promise<void> {
    if (!HORA.test(hora)) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'La hora va como HH:MM, por ejemplo 09:00.');
    const { node, bin } = typeof this.rutas === 'function' ? this.rutas() : this.rutas;
    if (node.includes('"') || bin.includes('"')) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'La ruta de Node o de mi-sii-mcp tiene comillas: muévelo a una carpeta sin comillas.');
    const comando = `conhost.exe --headless "${node}" "${bin}" vigilar --notificar`;
    const r = await this.ejecutar('schtasks.exe', ['/Create', '/F', '/SC', 'DAILY', '/ST', hora, '/TN', NOMBRE_TAREA, '/TR', comando]);
    if (r.codigo !== 0) throw new ErrorMiSiiMcp('SISTEMA_FALLO', 'Windows no creó la tarea de la revisión diaria.');
  }

  async desactivar(): Promise<void> {
    // Si la tarea no existía, schtasks termina con error: igual queda desactivada.
    await this.ejecutar('schtasks.exe', ['/Delete', '/F', '/TN', NOMBRE_TAREA]);
  }

  async estado(): Promise<{ activa: boolean; hora: string | null }> {
    const r = await this.ejecutar('schtasks.exe', ['/Query', '/TN', NOMBRE_TAREA, '/XML']);
    if (r.codigo !== 0) return { activa: false, hora: null };
    return { activa: true, hora: /<StartBoundary>\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(r.salida)?.[1] ?? null };
  }
}
