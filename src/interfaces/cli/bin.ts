#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { CommanderError } from 'commander';
import { crearContenedor, type Contenedor } from '../../main/contenedor.js';
import { VERSION } from '../../main/version.js';
import { iniciarMcpStdio } from '../mcp/iniciar.js';
import { crearServidorMcp } from '../mcp/servidor.js';
import { leerLineaStdin, pedirClaveOculta } from './clave.js';
import { crearPrograma } from './programa.js';

let contenedor: Contenedor | null = null;

/** `impuestocl` no está en el PATH del asistente: el comando de login apunta a este mismo archivo compilado. */
const comandoLoginReal = (rut: string): string => `node "${fileURLToPath(import.meta.url)}" login ${rut} --guardar-clave`;
const comandoLoginNavegadorReal = (rut: string): string => `node "${fileURLToPath(import.meta.url)}" login-navegador --rut ${rut}`;

const { programa, salida } = crearPrograma(
  {
    escribir: (texto) => void process.stdout.write(`${texto}\n`),
    error: (texto) => void process.stderr.write(`${texto}\n`),
    pedirClave: (pregunta) => pedirClaveOculta(pregunta),
    leerStdin: () => leerLineaStdin(),
  },
  () => (contenedor ??= crearContenedor()),
  (c) => iniciarMcpStdio(() => crearServidorMcp(c.deps, VERSION, { comandoLogin: comandoLoginReal, comandoLoginNavegador: comandoLoginNavegadorReal })),
);

try {
  await programa.parseAsync(process.argv);
  process.exitCode = salida.codigo;
} catch (e) {
  if (e instanceof CommanderError) {
    process.exitCode = e.exitCode;
  } else {
    console.error(e);
    process.exitCode = 1;
  }
}
