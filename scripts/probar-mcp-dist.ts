// Prueba de humo del servidor MCP compilado: arranca `dist/interfaces/cli/bin.js mcp` como lo hará Claude Code
// y llama a las herramientas de verdad, incluida `consulta_sql`, que corre en un proceso hijo compilado aparte.
// Usa una carpeta temporal propia como IMPUESTOCL_HOME: no toca ~/.impuestocl ni llega al SII.
// Uso: npm run build && npm run probar:mcp   (termina con código 0 si todo está bien, 1 si algo falla)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { HERRAMIENTAS } from '../src/interfaces/mcp/servidor.js';

const BIN = fileURLToPath(new URL('../dist/interfaces/cli/bin.js', import.meta.url));

interface Resultado {
  content?: { type: string; text?: string }[];
  isError?: boolean;
}

const textoDe = (r: Resultado): string => r.content?.[0]?.text ?? '';

function exigir(condicion: boolean, mensaje: string): void {
  if (!condicion) throw new Error(mensaje);
}

async function probar(home: string): Promise<void> {
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, 'mcp'],
    env: { ...getDefaultEnvironment(), IMPUESTOCL_HOME: home },
  });
  const cliente = new Client({ name: 'probar-mcp-dist', version: '1.0.0' });
  try {
    await cliente.connect(transporte);

    const { tools } = await cliente.listTools();
    const nombres = tools.map((t) => t.name).sort();
    exigir(tools.length === HERRAMIENTAS.length, `Se esperaban ${HERRAMIENTAS.length} herramientas y el servidor compilado expone ${tools.length}: ${nombres.join(', ')}`);
    exigir(JSON.stringify(nombres) === JSON.stringify([...HERRAMIENTAS].sort()), `Las herramientas compiladas no coinciden con el código fuente: ${nombres.join(', ')}`);

    const instrucciones = cliente.getInstructions() ?? '';
    exigir(instrucciones.trim().length > 0, 'El servidor no entregó instrucciones al inicializarse.');

    const esquema = (await cliente.callTool({ name: 'datos_esquema', arguments: {} })) as Resultado;
    exigir(esquema.isError !== true, `datos_esquema devolvió un error: ${textoDe(esquema)}`);

    // Ejercita el proceso hijo compilado (dist/store/sqlite/consulta-hijo.js) sobre una base recién creada y vacía.
    const consulta = (await cliente.callTool({ name: 'consulta_sql', arguments: { sql: 'SELECT COUNT(*) AS n FROM contribuyente' } })) as Resultado;
    exigir(consulta.isError !== true, `consulta_sql devolvió un error: ${textoDe(consulta)}`);
    const texto = textoDe(consulta);
    const datos = JSON.parse(texto.slice(texto.indexOf('\n\n') + 2)) as { filas?: unknown };
    exigir(JSON.stringify(datos.filas) === '[[0]]', `consulta_sql devolvió filas inesperadas: ${texto}`);

    console.log(`OK: ${tools.length} herramientas, instrucciones de ${instrucciones.length} caracteres, datos_esquema y consulta_sql responden desde dist.`);
  } finally {
    await cliente.close();
  }
}

const home = mkdtempSync(join(tmpdir(), 'mi-sii-mcp-probar-mcp-'));
try {
  await probar(home);
  process.exitCode = 0;
} catch (e) {
  console.error(`FALLO: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
