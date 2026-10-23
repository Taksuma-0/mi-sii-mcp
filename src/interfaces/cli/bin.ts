#!/usr/bin/env node
import { CommanderError } from 'commander';
import { crearContenedor, type Contenedor } from '../../main/contenedor.js';
import { VERSION } from '../../main/version.js';
import { iniciarMcpStdio } from '../mcp/iniciar.js';
import { crearServidorMcp } from '../mcp/servidor.js';
import { leerLineaStdin, pedirClaveOculta } from './clave.js';
import { crearPrograma } from './programa.js';

let contenedor: Contenedor | null = null;

const { programa, salida } = crearPrograma(
  {
    escribir: (texto) => void process.stdout.write(`${texto}\n`),
    error: (texto) => void process.stderr.write(`${texto}\n`),
    pedirClave: (pregunta) => pedirClaveOculta(pregunta),
    leerStdin: () => leerLineaStdin(),
  },
  () => (contenedor ??= crearContenedor()),
  (c) => iniciarMcpStdio(() => crearServidorMcp(c.deps, VERSION)),
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
