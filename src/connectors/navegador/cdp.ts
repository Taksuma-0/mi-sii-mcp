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

/**
 * Conecta al WebSocket de depuración del navegador con el `WebSocket` global de Node (sin dependencias). Solo acepta
 * `ws://127.0.0.1`: el navegador lo abrió en este equipo. Cada mensaje tiene su propio plazo.
 */
export function conectarCdp(urlWs: string, plazoMs = 15_000): Promise<TransporteCdp> {
  const url = new URL(urlWs);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1') {
    return Promise.reject(new Error('La depuración del navegador debe estar en ws://127.0.0.1.'));
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pendientes = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; temporizador: ReturnType<typeof setTimeout> }>();
    let siguiente = 1;
    let abierto = false;
    const fallarTodo = (motivo: string) => {
      for (const [id, p] of pendientes) {
        clearTimeout(p.temporizador);
        p.reject(new Error(motivo));
        pendientes.delete(id);
      }
    };
    const arranque = setTimeout(() => {
      socket.close();
      reject(new Error('El navegador no aceptó la conexión de depuración a tiempo.'));
    }, plazoMs);
    socket.addEventListener('open', () => {
      abierto = true;
      clearTimeout(arranque);
      resolve({
        enviar(metodo, params = {}) {
          if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('La conexión con el navegador está cerrada.'));
          const id = siguiente++;
          return new Promise((res, rej) => {
            const temporizador = setTimeout(() => {
              pendientes.delete(id);
              rej(new Error(`El navegador no respondió ${metodo} a tiempo.`));
            }, plazoMs);
            pendientes.set(id, { resolve: res, reject: rej, temporizador });
            socket.send(JSON.stringify({ id, method: metodo, params }));
          });
        },
        cerrar() {
          fallarTodo('La conexión con el navegador se cerró.');
          socket.close();
        },
      });
    });
    socket.addEventListener('message', (evento) => {
      let mensaje: MensajeCdp;
      try {
        mensaje = JSON.parse(String(evento.data)) as MensajeCdp;
      } catch {
        return;
      }
      if (typeof mensaje.id !== 'number') return; // eventos del navegador: no se usan
      const p = pendientes.get(mensaje.id);
      if (!p) return;
      pendientes.delete(mensaje.id);
      clearTimeout(p.temporizador);
      if (mensaje.error) p.reject(new Error(`El navegador rechazó la orden: ${mensaje.error.message ?? 'sin detalle'}.`));
      else p.resolve(mensaje.result);
    });
    socket.addEventListener('close', () => {
      fallarTodo('La conexión con el navegador se cerró.');
      if (!abierto) {
        clearTimeout(arranque);
        reject(new Error('El navegador cerró la conexión de depuración.'));
      }
    });
    socket.addEventListener('error', () => {
      // `close` llega después y rechaza lo pendiente.
    });
  });
}
