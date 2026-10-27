import { Entry } from '@napi-rs/keyring';
import type { SecretStore } from '../../ports/index.js';

const SERVICIO = 'mi-sii-mcp';
/** Servicio con el nombre anterior de la herramienta: sus claves se mudan a `SERVICIO` la primera vez que se leen. */
const SERVICIO_ANTERIOR = 'impuestocl';

/** Lo que se usa de una entrada del llavero; inyectable para probar sin tocar el llavero real. */
export interface EntradaLlavero {
  getPassword(): string | null | undefined;
  setPassword(clave: string): void;
  deletePassword(): unknown;
}
export type CrearEntrada = (servicio: string, rut: string) => EntradaLlavero;

const leer = (entrada: EntradaLlavero): string | null => {
  try {
    return entrada.getPassword() ?? null;
  } catch {
    return null;
  }
};
const borrar = (entrada: EntradaLlavero): void => {
  try {
    entrada.deletePassword();
  } catch {
    // no existía
  }
};

/** Credential Manager (Windows), Keychain (macOS) o Secret Service (Linux). */
export class LlaveroSistema implements SecretStore {
  constructor(private readonly crear: CrearEntrada = (servicio, rut) => new Entry(servicio, rut)) {}

  async obtener(rut: string): Promise<string | null> {
    const actual = leer(this.crear(SERVICIO, rut));
    if (actual !== null) return actual;
    const anterior = leer(this.crear(SERVICIO_ANTERIOR, rut));
    if (anterior === null) return null;
    // Mudanza: se borra la anterior solo si la nueva quedó guardada.
    try {
      this.crear(SERVICIO, rut).setPassword(anterior);
      borrar(this.crear(SERVICIO_ANTERIOR, rut));
    } catch {
      // Si no se pudo guardar con el nombre nuevo, la clave sigue sirviendo con el anterior.
    }
    return anterior;
  }

  async guardar(rut: string, clave: string): Promise<void> {
    this.crear(SERVICIO, rut).setPassword(clave);
  }

  async borrar(rut: string): Promise<void> {
    borrar(this.crear(SERVICIO, rut));
    borrar(this.crear(SERVICIO_ANTERIOR, rut));
  }
}
