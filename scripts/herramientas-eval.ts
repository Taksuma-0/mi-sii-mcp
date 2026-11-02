// Guarda en evals/mocks/mi-sii-mcp/_tools.json la lista de herramientas (tools/list) del servidor compilado, para que
// las evals simulen el servidor con las descripciones y los esquemas reales. Usa una carpeta temporal como
// MI_SII_MCP_HOME: no toca ~/.mi-sii-mcp ni llega al SII.
// Uso: npm run evals:herramientas   (compila antes; la prueba de distribución avisa si el archivo queda desfasado)
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const BIN = fileURLToPath(new URL('../dist/interfaces/cli/bin.js', import.meta.url));
const DESTINO = fileURLToPath(new URL('../evals/mocks/mi-sii-mcp/_tools.json', import.meta.url));

const home = mkdtempSync(join(tmpdir(), 'mi-sii-mcp-evals-'));
const cliente = new Client({ name: 'herramientas-eval', version: '1.0.0' });
try {
  await cliente.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [BIN, 'mcp'],
      env: { ...getDefaultEnvironment(), MI_SII_MCP_HOME: home, MI_SII_MCP_SIN_AVISO_VERSION: '1' },
    }),
  );
  const { tools } = await cliente.listTools();
  writeFileSync(DESTINO, `${JSON.stringify({ tools }, null, 2)}\n`);
  console.log(`OK: ${tools.length} herramientas en ${DESTINO}`);
} finally {
  await cliente.close();
  rmSync(home, { recursive: true, force: true });
}
