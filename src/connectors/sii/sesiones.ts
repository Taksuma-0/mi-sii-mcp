import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { ErrorImpuestocl } from '../../domain/errores.js';
import { parseRut, type Rut } from '../../domain/rut.js';
import type { ConsultaSesiones, EstadoSesion, ResultadoLogin, SecretStore } from '../../ports/index.js';
import { ClienteHttp, type OpcionesHttp } from './http.js';
import { cerrarSesion, iniciarSesion, leerIdentidad } from './login.js';

type JarSerializado = Parameters<typeof CookieJar.deserializeSync>[0];

interface ArchivoSesion {
  readonly rut: string;
  readonly guardadaEn: string;
  readonly jar: JarSerializado | null;
}

/** Una sesión del SII por RUT, guardada como cookies (nunca la clave) en `<dir>/<rut>.json`. */
export class GestorSesiones implements ConsultaSesiones {
  private readonly activas = new Map<string, ClienteHttp>();
  private readonly pendientes = new Map<string, Promise<ClienteHttp>>();

  constructor(
    private readonly dir: string,
    private readonly secretos: SecretStore,
    private readonly opcionesHttp: OpcionesHttp = {},
  ) {
    mkdirSync(dir, { recursive: true });
  }

  estado(rutTexto: string): EstadoSesion {
    const rut = parseRut(rutTexto).canonico;
    const archivo = this.leerArchivo(rut);
    return { tieneSesion: archivo !== null, guardadaEn: archivo?.guardadaEn ?? null, bloqueado: existsSync(this.rutaBloqueo(rut)) };
  }

  /** Login pedido por la persona: levanta el bloqueo local y hace un único intento. */
  async loginInteractivo(rutTexto: string, clave: string, guardarClave: boolean): Promise<ResultadoLogin> {
    const rut = parseRut(rutTexto);
    rmSync(this.rutaBloqueo(rut.canonico), { force: true });
    const http = this.nuevoCliente();
    const identidad = await iniciarSesion(http, rut, clave).catch(async (e: unknown) => {
      await this.siRechazoBloquear(rut.canonico, e);
      throw e;
    });
    this.guardarArchivo(rut.canonico, http);
    this.activas.set(rut.canonico, http);
    let claveGuardada = false;
    if (guardarClave) {
      try {
        await this.secretos.guardar(rut.canonico, clave);
        claveGuardada = true;
      } catch {
        claveGuardada = false;
      }
    }
    return { identidad, claveGuardada };
  }

  /** Cliente con sesión válida. Solo entra sin intervención si hay clave guardada y el RUT no está bloqueado. */
  async sesionActiva(rutTexto: string): Promise<ClienteHttp> {
    const rut = parseRut(rutTexto);
    if (existsSync(this.rutaBloqueo(rut.canonico))) {
      throw new ErrorImpuestocl('RUT_BLOQUEADO_LOCAL', `El RUT ${rut.canonico} está bloqueado localmente por una clave rechazada.`);
    }
    const pendiente = this.pendientes.get(rut.canonico);
    if (pendiente) return pendiente;
    const nueva = this.obtenerSesion(rut).finally(() => {
      this.pendientes.delete(rut.canonico);
    });
    this.pendientes.set(rut.canonico, nueva);
    return nueva;
  }

  /** Guarda las cookies actualizadas de la sesión en memoria (al terminar una sincronización). */
  persistir(rutTexto: string): void {
    const rut = parseRut(rutTexto).canonico;
    const http = this.activas.get(rut);
    if (http) this.guardarArchivo(rut, http);
  }

  async logout(rutTexto: string, olvidarClave: boolean): Promise<void> {
    const rut = parseRut(rutTexto).canonico;
    await cerrarSesion(this.activas.get(rut) ?? this.clienteDesdeArchivo(rut));
    this.activas.delete(rut);
    rmSync(this.rutaSesion(rut), { force: true });
    if (olvidarClave) await this.secretos.borrar(rut);
  }

  private async obtenerSesion(rut: Rut): Promise<ClienteHttp> {
    const guardada = this.activas.get(rut.canonico) ?? this.clienteDesdeArchivo(rut.canonico);
    try {
      await leerIdentidad(guardada);
      this.activas.set(rut.canonico, guardada);
      return guardada;
    } catch (e) {
      if (!(e instanceof ErrorImpuestocl) || e.codigo !== 'SESION_REQUERIDA') throw e;
    }
    const clave = await this.secretos.obtener(rut.canonico);
    if (!clave) throw new ErrorImpuestocl('SESION_REQUERIDA', `No hay sesión activa para ${rut.canonico} ni clave guardada en el llavero.`);
    const http = this.nuevoCliente();
    await iniciarSesion(http, rut, clave).catch(async (e: unknown) => {
      await this.siRechazoBloquear(rut.canonico, e);
      throw e;
    });
    this.guardarArchivo(rut.canonico, http);
    this.activas.set(rut.canonico, http);
    return http;
  }

  private rutaSesion(rut: string): string {
    return join(this.dir, `${rut}.json`);
  }

  private rutaBloqueo(rut: string): string {
    return join(this.dir, `${rut}.bloqueo`);
  }

  private nuevoCliente(): ClienteHttp {
    return new ClienteHttp(new CookieJar(), this.opcionesHttp);
  }

  private leerArchivo(rut: string): ArchivoSesion | null {
    const ruta = this.rutaSesion(rut);
    if (!existsSync(ruta)) return null;
    try {
      return JSON.parse(readFileSync(ruta, 'utf8')) as ArchivoSesion;
    } catch {
      return null;
    }
  }

  private clienteDesdeArchivo(rut: string): ClienteHttp {
    const archivo = this.leerArchivo(rut);
    if (archivo?.jar) {
      try {
        return new ClienteHttp(CookieJar.deserializeSync(archivo.jar), this.opcionesHttp);
      } catch {
        // archivo corrupto: se parte de cero
      }
    }
    return this.nuevoCliente();
  }

  private guardarArchivo(rut: string, http: ClienteHttp): void {
    const archivo: ArchivoSesion = { rut, guardadaEn: new Date().toISOString(), jar: http.jar.serializeSync() ?? null };
    writeFileSync(this.rutaSesion(rut), JSON.stringify(archivo), { mode: 0o600 });
  }

  private async siRechazoBloquear(rut: string, e: unknown): Promise<void> {
    if (!(e instanceof ErrorImpuestocl) || e.codigo !== 'CLAVE_RECHAZADA') return;
    writeFileSync(this.rutaBloqueo(rut), JSON.stringify({ motivo: e.message, en: new Date().toISOString() }), { mode: 0o600 });
    try {
      await this.secretos.borrar(rut);
    } catch {
      // si el llavero falla, el bloqueo local igual evita reintentos
    }
  }
}
