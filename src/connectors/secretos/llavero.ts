import { Entry } from '@napi-rs/keyring';
import type { SecretStore } from '../../ports/index.js';

const SERVICIO = 'impuestocl';

/** Credential Manager (Windows), Keychain (macOS) o Secret Service (Linux). */
export class LlaveroSistema implements SecretStore {
  async obtener(rut: string): Promise<string | null> {
    try {
      return new Entry(SERVICIO, rut).getPassword() ?? null;
    } catch {
      return null;
    }
  }

  async guardar(rut: string, clave: string): Promise<void> {
    new Entry(SERVICIO, rut).setPassword(clave);
  }

  async borrar(rut: string): Promise<void> {
    try {
      new Entry(SERVICIO, rut).deletePassword();
    } catch {
      // no existía
    }
  }
}
