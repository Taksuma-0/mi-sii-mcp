import type { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

/** stdout es el canal JSON-RPC: aquí solo se escribe en stderr. */
export function iniciarMcpStdio(crearServidor: () => McpServer): void {
  serveStdio(crearServidor);
  console.error('impuestocl: servidor MCP listo (stdio).');
}
