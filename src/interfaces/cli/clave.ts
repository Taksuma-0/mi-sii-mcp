import { StringDecoder } from 'node:string_decoder';

/** Pide la clave sin mostrarla (muestra `*`). Requiere una terminal interactiva. */
export function pedirClaveOculta(pregunta: string, entrada: NodeJS.ReadStream = process.stdin, salida: NodeJS.WriteStream = process.stderr): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!entrada.isTTY) {
      reject(new Error('No hay una terminal interactiva; usa --clave-stdin.'));
      return;
    }
    salida.write(pregunta);
    const rawAnterior = Boolean(entrada.isRaw);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    let clave = '';
    let escape: 'ninguno' | 'inicio' | 'secuencia' = 'ninguno';
    let terminado = false;
    const terminar = () => {
      if (terminado) return;
      terminado = true;
      entrada.off('data', alRecibir);
      entrada.off('end', alCerrar);
      entrada.off('close', alCerrar);
      entrada.off('error', alFallar);
      entrada.setRawMode(rawAnterior);
      entrada.pause();
      salida.write('\n');
    };
    const alCerrar = () => {
      terminar();
      reject(new Error('Entrada cerrada antes de ingresar la clave.'));
    };
    const alFallar = (error: Error) => {
      terminar();
      reject(error);
    };
    function alRecibir(trozo: string): void {
      for (const c of trozo) {
        if (c === '\r' || c === '\n') {
          terminar();
          resolve(clave);
          return;
        }
        if (c === '\u0003') {
          terminar();
          reject(new Error('Cancelado.'));
          return;
        }
        if (c === '\u001b') {
          escape = 'inicio';
          continue;
        }
        if (escape === 'inicio') {
          escape = c === '[' || c === 'O' ? 'secuencia' : 'ninguno';
          continue;
        }
        // CSI y SS3 terminan con un byte final, aunque lleguen en varios eventos.
        if (escape === 'secuencia') {
          if (c >= '@' && c <= '~') escape = 'ninguno';
          continue;
        }
        if (c === '\u007f' || c === '\b') {
          if (clave.length > 0) {
            clave = clave.slice(0, -1);
            salida.write('\b \b');
          }
          continue;
        }
        if (c < ' ' || (c >= '\u0080' && c <= '\u009f')) continue;
        clave += c;
        salida.write('*');
      }
    }
    entrada.on('data', alRecibir);
    entrada.once('end', alCerrar);
    entrada.once('close', alCerrar);
    entrada.once('error', alFallar);
  });
}

/** Primera línea de la entrada estándar (para `--clave-stdin`). */
export async function leerLineaStdin(entrada: AsyncIterable<string | Buffer> = process.stdin): Promise<string> {
  const decodificador = new StringDecoder('utf8');
  let texto = '';
  for await (const trozo of entrada) {
    // Los strings ya están decodificados; un string vacío no interrumpe bytes pendientes.
    texto += typeof trozo === 'string' ? (trozo ? decodificador.end() + trozo : '') : decodificador.write(trozo);
    if (texto.includes('\n')) break;
  }
  texto += decodificador.end();
  return texto.split(/\r?\n/)[0] ?? '';
}
