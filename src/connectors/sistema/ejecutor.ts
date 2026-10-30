import { spawn } from 'node:child_process';

/** Ejecuta un programa del sistema con argumentos fijos (sin shell) y devuelve su código de salida y lo que escribió. */
export type Ejecutor = (programa: string, args: readonly string[], env?: Readonly<Record<string, string>>) => Promise<{ readonly codigo: number; readonly salida: string }>;

/** Sin consola visible y sin pasar por una shell: los datos nunca se interpretan como comandos. */
export const ejecutorSistema: Ejecutor = (programa, args, env) =>
  new Promise((resolve) => {
    const proceso = spawn(programa, [...args], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'], env: env ? { ...process.env, ...env } : process.env });
    const partes: Buffer[] = [];
    proceso.stdout.on('data', (parte: Buffer) => partes.push(parte));
    proceso.once('error', () => resolve({ codigo: -1, salida: '' }));
    proceso.once('close', (codigo) => resolve({ codigo: codigo ?? -1, salida: Buffer.concat(partes).toString('utf8') }));
  });
