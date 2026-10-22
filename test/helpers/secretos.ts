import type { SecretStore } from '../../src/ports/index.js';

export class SecretosEnMemoria implements SecretStore {
  readonly mapa = new Map<string, string>();
  fallarAlGuardar = false;

  async obtener(rut: string): Promise<string | null> {
    return this.mapa.get(rut) ?? null;
  }

  async guardar(rut: string, clave: string): Promise<void> {
    if (this.fallarAlGuardar) throw new Error('llavero no disponible');
    this.mapa.set(rut, clave);
  }

  async borrar(rut: string): Promise<void> {
    this.mapa.delete(rut);
  }
}
