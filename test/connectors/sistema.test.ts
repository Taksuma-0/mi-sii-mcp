import { describe, expect, it } from 'vitest';
import type { Ejecutor } from '../../src/connectors/sistema/ejecutor.js';
import { NotificadorWindows, SCRIPT_NOTIFICACION } from '../../src/connectors/sistema/notificacion-windows.js';
import { NOMBRE_TAREA, TareaProgramadaWindows } from '../../src/connectors/sistema/tarea-programada.js';
import { codigoDe } from '../helpers/errores.js';

function ejecutorFalso(respuesta: { codigo: number; salida: string } = { codigo: 0, salida: '' }) {
  const llamadas: { programa: string; args: readonly string[]; env: Readonly<Record<string, string>> | undefined }[] = [];
  const ejecutor: Ejecutor = async (programa, args, env) => {
    llamadas.push({ programa, args, env });
    return respuesta;
  };
  return { ejecutor, llamadas };
}

describe('NotificadorWindows', () => {
  it('muestra la notificación con PowerShell y pasa los textos por el entorno, nunca en el comando', async () => {
    const { ejecutor, llamadas } = ejecutorFalso();

    const mostrada = await new NotificadorWindows(ejecutor).notificar('Título <con> "comillas"', 'Cuerpo & más');

    expect(mostrada).toBe(true);
    expect(llamadas).toEqual([
      {
        programa: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', SCRIPT_NOTIFICACION],
        env: { MI_SII_MCP_TITULO: 'Título <con> "comillas"', MI_SII_MCP_CUERPO: 'Cuerpo & más' },
      },
    ]);
    expect(SCRIPT_NOTIFICACION).toContain('$env:MI_SII_MCP_TITULO');
  });

  it('si PowerShell falla, lo informa sin lanzar', async () => {
    const { ejecutor } = ejecutorFalso({ codigo: 1, salida: '' });
    expect(await new NotificadorWindows(ejecutor).notificar('a', 'b')).toBe(false);
  });
});

describe('TareaProgramadaWindows', () => {
  const rutas = { node: 'C:\\Program Files\\nodejs\\node.exe', bin: 'C:\\mi-sii-mcp\\dist\\interfaces\\cli\\bin.js' };

  it('crea una tarea diaria que corre vigilar --notificar sin abrir una consola', async () => {
    const { ejecutor, llamadas } = ejecutorFalso();

    await new TareaProgramadaWindows(ejecutor, rutas).activar('09:00');

    expect(llamadas).toEqual([
      {
        programa: 'schtasks.exe',
        args: ['/Create', '/F', '/SC', 'DAILY', '/ST', '09:00', '/TN', NOMBRE_TAREA, '/TR', `conhost.exe --headless "${rutas.node}" "${rutas.bin}" vigilar --notificar`],
        env: undefined,
      },
    ]);
  });

  it('rechaza horas mal escritas y rutas con comillas, y avisa si el sistema no crea la tarea', async () => {
    const { ejecutor } = ejecutorFalso();
    expect(await codigoDe(new TareaProgramadaWindows(ejecutor, rutas).activar('9:00'))).toBe('PARAMETROS_INVALIDOS');
    expect(await codigoDe(new TareaProgramadaWindows(ejecutor, { ...rutas, bin: 'C:\\a"b\\bin.js' }).activar('09:00'))).toBe('PARAMETROS_INVALIDOS');
    expect(await codigoDe(new TareaProgramadaWindows(ejecutorFalso({ codigo: 1, salida: '' }).ejecutor, rutas).activar('09:00'))).toBe('SISTEMA_FALLO');
  });

  it('lee el estado y la hora desde la definición de la tarea, y la desactiva', async () => {
    const xml = '<Task><Triggers><CalendarTrigger><StartBoundary>2026-10-30T09:30:00</StartBoundary></CalendarTrigger></Triggers></Task>';
    expect(await new TareaProgramadaWindows(ejecutorFalso({ codigo: 0, salida: xml }).ejecutor, rutas).estado()).toEqual({ activa: true, hora: '09:30' });
    expect(await new TareaProgramadaWindows(ejecutorFalso({ codigo: 1, salida: '' }).ejecutor, rutas).estado()).toEqual({ activa: false, hora: null });

    const { ejecutor, llamadas } = ejecutorFalso({ codigo: 1, salida: '' });
    await new TareaProgramadaWindows(ejecutor, rutas).desactivar();
    expect(llamadas[0]!.args).toEqual(['/Delete', '/F', '/TN', NOMBRE_TAREA]);
  });
});
