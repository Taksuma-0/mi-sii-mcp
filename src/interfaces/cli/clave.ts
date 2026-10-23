/** Pide la clave sin mostrarla (muestra `*`). Requiere una terminal interactiva. */
export function pedirClaveOculta(pregunta: string, entrada: NodeJS.ReadStream = process.stdin, salida: NodeJS.WriteStream = process.stderr): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!entrada.isTTY) {
      reject(new Error('No hay una terminal interactiva; usa --clave-stdin.'));
      return;
    }
    salida.write(pregunta);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    let clave = '';
    const terminar = () => {
      entrada.off('data', alRecibir);
      entrada.setRawMode(false);
      entrada.pause();
      salida.write('\n');
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
        if (c === '\u007f' || c === '\b') {
          if (clave.length > 0) {
            clave = clave.slice(0, -1);
            salida.write('\b \b');
          }
          continue;
        }
        clave += c;
        salida.write('*');
      }
    }
    entrada.on('data', alRecibir);
  });
}

/** Primera línea de la entrada estándar (para `--clave-stdin`). */
export async function leerLineaStdin(entrada: AsyncIterable<string | Buffer> = process.stdin): Promise<string> {
  let texto = '';
  for await (const trozo of entrada) {
    texto += trozo.toString();
    if (texto.includes('\n')) break;
  }
  return texto.split(/\r?\n/)[0] ?? '';
}
