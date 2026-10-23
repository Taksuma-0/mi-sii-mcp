import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearServidorLocal, type ServidorLocal } from '../src/interfaces/web/servidor.js';

async function abrirEnNavegador(url: string): Promise<void> {
  // URL creada por el servidor; nunca contiene entradas ni credenciales.
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error('URL local inválida.');
  await new Promise<void>((resolver, rechazar) => {
    const proceso = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `Start-Process -FilePath '${url}'`], { windowsHide: true, stdio: 'ignore' });
    proceso.once('error', rechazar);
    proceso.once('exit', (codigo) => codigo === 0 ? resolver() : rechazar(new Error('No se pudo abrir el navegador.')));
  });
}

export async function iniciarLocal(opciones: { puerto?: number; sinAbrir?: boolean; abrir?: (url: string) => Promise<void> } = {}): Promise<{ url: string; servidor: ServidorLocal | null }> {
  const puerto = opciones.puerto ?? 47529;
  let url = `http://127.0.0.1:${puerto}`;
  let servidor: ServidorLocal | null = null;
  let propia = false;
  try {
    const respuesta = await fetch(url + '/estado', { signal: AbortSignal.timeout(1000), redirect: 'error' });
    const estado: unknown = await respuesta.json();
    propia = respuesta.ok && !!estado && typeof estado === 'object' && 'aplicacion' in estado && estado.aplicacion === 'impuestocl-local-v1';
  } catch { /* No hay una instancia propia disponible. */ }
  if (!propia) {
    try { servidor = await crearServidorLocal({ puerto }); }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EADDRINUSE') throw error;
      servidor = await crearServidorLocal({ puerto: 0 });
    }
    url = servidor.url;
  }
  try { if (!opciones.sinAbrir) await (opciones.abrir ?? abrirEnNavegador)(url); }
  catch (error) { await servidor?.cerrar(); throw error; }
  return { url, servidor };
}

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
    process.stderr.write('No se pudo abrir impuestocl. Revisa la instalación de Node y vuelve a abrir el lanzador.\n');
    process.exitCode = 1;
  }
}
