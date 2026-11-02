import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarLocal } from '../src/interfaces/web/lanzador.js';

// Lo ejecuta «Abrir mi-sii-mcp.cmd» (sin ventana). Quien instaló con npx usa `mi-sii-mcp conectar`, que hace lo mismo.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { servidor } = await iniciarLocal({ sinAbrir: process.argv.includes('--sin-abrir') });
    if (servidor) {
      const cerrar = () => { void servidor.cerrar(); };
      process.once('SIGINT', cerrar);
      process.once('SIGTERM', cerrar);
      await servidor.cerrado;
      process.off('SIGINT', cerrar);
      process.off('SIGTERM', cerrar);
    }
  } catch {
    // Sin errores crudos ni datos de autenticación en la salida.
    process.stderr.write('No se pudo abrir mi-sii-mcp. Revisa la instalación de Node y vuelve a abrir el lanzador.\n');
    process.exitCode = 1;
  }
}
