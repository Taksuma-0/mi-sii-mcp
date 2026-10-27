import type { Readable, Writable } from 'node:stream';

/** Lo mínimo del Chrome DevTools Protocol que usa el login asistido; las pruebas lo reemplazan por uno falso. */
export interface TransporteCdp {
  enviar(metodo: string, params?: Record<string, unknown>): Promise<unknown>;
  cerrar(): void;
}

interface MensajeCdp {
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
}

interface Pendiente {
  readonly resolve: (v: unknown) => void;
  readonly reject: (e: Error) => void;
  readonly temporizador: ReturnType<typeof setTimeout>;
}

const SEPARADOR = 0;

/**
 * CDP por las tuberías que abre `--remote-debugging-pipe`: el navegador lee las órdenes de su descriptor 3 (`escritura`)
 * y escribe en el 4 (`lectura`); cada mensaje es JSON terminado en NUL. No hay puerto ni nada que escuche en la red, así que
 * ningún otro programa del equipo puede conectarse a la depuración. Cada orden tiene su propio plazo.
 */
export function transportePipe(escritura: Writable, lectura: Readable, plazoMs = 30_000): TransporteCdp {
  const pendientes = new Map<number, Pendiente>();
  let siguiente = 1;
  let cerrado = false;
  let resto = Buffer.alloc(0);

  const fallarTodo = (motivo: string) => {
    cerrado = true;
    for (const [id, p] of pendientes) {
      clearTimeout(p.temporizador);
      p.reject(new Error(motivo));
      pendientes.delete(id);
    }
  };
  const alCerrarse = () => fallarTodo('La tubería del navegador se cerró.');

  lectura.on('data', (parte: Buffer | string) => {
    resto = Buffer.concat([resto, typeof parte === 'string' ? Buffer.from(parte, 'utf8') : parte]);
    let fin: number;
    while ((fin = resto.indexOf(SEPARADOR)) >= 0) {
      const texto = resto.subarray(0, fin).toString('utf8');
      resto = resto.subarray(fin + 1);
      let mensaje: MensajeCdp;
      try {
        mensaje = JSON.parse(texto) as MensajeCdp;
      } catch {
        continue;
      }
      if (typeof mensaje.id !== 'number') continue; // eventos del navegador: no se usan
      const p = pendientes.get(mensaje.id);
      if (!p) continue;
      pendientes.delete(mensaje.id);
      clearTimeout(p.temporizador);
      if (mensaje.error) p.reject(new Error(`El navegador rechazó la orden: ${mensaje.error.message ?? 'sin detalle'}.`));
      else p.resolve(mensaje.result);
    }
  });
  lectura.on('end', alCerrarse);
  lectura.on('close', alCerrarse);
  // Un error de las tuberías (p. ej., EPIPE si el navegador murió) nunca derriba el proceso: rechaza lo pendiente.
  lectura.on('error', alCerrarse);
  escritura.on('error', alCerrarse);
  escritura.on('close', alCerrarse);

  return {
    enviar(metodo, params = {}) {
      if (cerrado) return Promise.reject(new Error('La tubería del navegador se cerró.'));
      const id = siguiente++;
      return new Promise((resolve, reject) => {
        const temporizador = setTimeout(() => {
          pendientes.delete(id);
          reject(new Error(`El navegador no respondió ${metodo} a tiempo.`));
        }, plazoMs);
        temporizador.unref();
        pendientes.set(id, { resolve, reject, temporizador });
        escritura.write(`${JSON.stringify({ id, method: metodo, params })}\0`, (error) => {
          if (error) alCerrarse();
        });
      });
    },
    cerrar() {
      fallarTodo('La tubería del navegador se cerró.');
      escritura.end();
      lectura.destroy();
    },
  };
}
