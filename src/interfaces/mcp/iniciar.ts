import type { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

export interface OpcionesVigilante {
  readonly registrar: (mensaje: string) => void;
  readonly salir: (codigo: number) => void;
  readonly ahoraMs: () => number;
  /** Errores sueltos tolerados dentro de la ventana; uno más y el proceso sale. */
  readonly limite?: number;
  readonly ventanaMs?: number;
}

const descripcion = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Manejadores de las promesas rechazadas y excepciones que nadie capturó. Sin ellos, Node cierra el proceso y el
 * asistente pierde todas las herramientas por un aviso de avance que falló. Se registran (en stderr, nunca en stdout,
 * que es el canal JSON-RPC) y el servidor sigue; si se repiten demasiado seguido, algo anda mal y se sale.
 */
export function vigilanteDeErrores(o: OpcionesVigilante): { alRechazo: (motivo: unknown) => void; alExcepcion: (error: unknown) => void } {
  const limite = o.limite ?? 5;
  const ventanaMs = o.ventanaMs ?? 60_000;
  const marcas: number[] = [];
  const anotar = (tipo: string, e: unknown): void => {
    o.registrar(`mi-sii-mcp: ${tipo} sin capturar: ${descripcion(e)}`);
    const ahora = o.ahoraMs();
    marcas.push(ahora);
    while (marcas.length > 0 && marcas[0]! <= ahora - ventanaMs) marcas.shift();
    if (marcas.length > limite) o.salir(1);
  };
  return { alRechazo: (motivo) => anotar('promesa rechazada', motivo), alExcepcion: (error) => anotar('excepción', error) };
}

/** stdout es el canal JSON-RPC: aquí solo se escribe en stderr. */
export function iniciarMcpStdio(crearServidor: () => McpServer): void {
  const vigilante = vigilanteDeErrores({ registrar: (m) => process.stderr.write(`${m}\n`), salir: (c) => process.exit(c), ahoraMs: () => Date.now() });
  process.on('unhandledRejection', vigilante.alRechazo);
  process.on('uncaughtException', vigilante.alExcepcion);
  serveStdio(crearServidor);
  console.error('mi-sii-mcp: servidor MCP listo (stdio).');
}
