import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cookie, CookieJar } from 'tough-cookie';
import { ErrorImpuestocl } from '../../domain/errores.js';
import { parseRut, type Rut } from '../../domain/rut.js';
import type { ConsultaSesiones, EstadoSesion, IdentidadSii, ResultadoLogin, SecretStore } from '../../ports/index.js';
import { capturarCookiesSii, esCookieTokenSii, esDominioSii, type CookieNavegador } from '../navegador/sesion-navegador.js';
import { ClienteHttp, type OpcionesHttp } from './http.js';
import { cerrarSesion, iniciarSesion, leerIdentidad } from './login.js';

type JarSerializado = Parameters<typeof CookieJar.deserializeSync>[0];

interface ArchivoSesion {
  readonly rut: string;
  readonly guardadaEn: string;
  readonly jar: JarSerializado | null;
  /** 'navegador': se tomó del navegador (ClaveÚnica o clave escrita ahí) y no se renueva sola. */
  readonly origen?: 'navegador';
}

/** Abre el navegador para que la persona entre y devuelve solo las cookies del SII; `signal` cancela la espera. */
export type CapturaNavegador = (opciones: { readonly signal?: AbortSignal }) => Promise<readonly CookieNavegador[]>;

const accionLoginNavegador = (rut: string): string =>
  `La sesión se tomó del navegador y no se renueva sola. Ejecuta \`impuestocl login-navegador --rut ${rut}\` y entra de nuevo en la ventana que se abre.`;

/** Cookie de tough-cookie y la URL desde donde se carga: sin punto inicial vale solo para ese host. */
function cookieDeNavegador(c: CookieNavegador): { cookie: Cookie; url: string } {
  const dominio = c.dominio.trim().toLowerCase();
  const host = dominio.replace(/^\./, '');
  const cookie = new Cookie({
    key: c.nombre,
    value: c.valor,
    path: c.ruta || '/',
    secure: c.seguro,
    httpOnly: c.httpOnly,
    expires: c.expira === null ? 'Infinity' : new Date(c.expira * 1000),
    ...(dominio.startsWith('.') ? { domain: host } : {}),
  });
  return { cookie, url: `https://${host}/` };
}

/** Una sesión del SII por RUT, guardada como cookies (nunca la clave) en `<dir>/<rut>.json`. */
export class GestorSesiones implements ConsultaSesiones {
  private readonly activas = new Map<string, ClienteHttp>();
  private readonly pendientes = new Map<string, Promise<ClienteHttp>>();
  private readonly operaciones = new Map<string, Promise<void>>();
  /** `guardadaEn` del último archivo de sesión que este proceso leyó o escribió, para notar el que deje otro proceso. */
  private readonly ultimaGuardadaEn = new Map<string, string>();

  constructor(
    private readonly dir: string,
    private readonly secretos: SecretStore,
    private readonly opcionesHttp: OpcionesHttp = {},
    private readonly capturar: CapturaNavegador = (o) => capturarCookiesSii(o),
  ) {
    mkdirSync(dir, { recursive: true });
  }

  estado(rutTexto: string): EstadoSesion {
    const rut = parseRut(rutTexto).canonico;
    const archivo = this.leerArchivo(rut);
    return {
      tieneSesion: archivo !== null,
      guardadaEn: archivo?.guardadaEn ?? null,
      bloqueado: existsSync(this.rutaBloqueo(rut)),
      ...(archivo?.origen === 'navegador' ? { origen: 'navegador' as const } : {}),
    };
  }

  async claveGuardada(rutTexto: string): Promise<boolean> {
    return (await this.secretos.obtener(parseRut(rutTexto).canonico)) !== null;
  }

  /**
   * Login en el navegador de la persona (ClaveÚnica o clave, escrita solo ahí): abre el navegador, toma las cookies del SII
   * e importa la sesión. `rutEsperado` se valida antes de abrir el navegador. Devuelve solo la identidad, nunca cookies.
   */
  async loginNavegador(rutEsperado?: string, signal?: AbortSignal): Promise<IdentidadSii> {
    const esperado = rutEsperado === undefined ? undefined : parseRut(rutEsperado).canonico;
    const cookies = await this.capturar(signal ? { signal } : {});
    return this.importarSesion(cookies, esperado);
  }

  /**
   * Importa una sesión iniciada en el navegador: solo cookies de `sii.cl`, exige TOKEN y verifica la identidad en Mi SII.
   * Se guarda con el RUT de la identidad (puede ser una persona), sin clave en el llavero: no se renueva sola. Si se indicó
   * `rutEsperado` y la identidad es otra, cierra esa sesión del SII y no guarda nada.
   */
  async importarSesion(cookies: readonly CookieNavegador[], rutEsperado?: string): Promise<IdentidadSii> {
    const esperado = rutEsperado === undefined ? null : parseRut(rutEsperado).canonico;
    const delSii = cookies.filter((c) => esDominioSii(c.dominio));
    // La misma regla que usa la captura en el navegador para dar por iniciada la sesión.
    if (!delSii.some(esCookieTokenSii)) {
      throw new ErrorImpuestocl('SESION_REQUERIDA', 'El navegador no entregó la cookie TOKEN del SII: el inicio de sesión no terminó.', {
        accion: accionLoginNavegador(esperado ?? '<rut>'),
      });
    }
    const jar = new CookieJar();
    for (const c of delSii) {
      const { cookie, url } = cookieDeNavegador(c);
      await jar.setCookie(cookie, url, { ignoreError: true });
    }
    const http = new ClienteHttp(jar, this.opcionesHttp);
    const identidad = await leerIdentidad(http);
    if (esperado !== null && identidad.rut !== esperado) {
      await cerrarSesion(http);
      throw new ErrorImpuestocl('SIN_PERMISO', `En el navegador se inició sesión como ${identidad.rut}, no como ${esperado}.`, {
        accion: `Ejecuta \`impuestocl login-navegador --rut ${esperado}\` y entra con la identidad de ${esperado}, o configura el acceso con \`impuestocl perfil agregar ${esperado} … --accede-con ${identidad.rut}\`.`,
      });
    }
    this.pendientes.delete(identidad.rut);
    return this.coordinar(identidad.rut, async () => {
      // La persona acaba de entrar: un bloqueo por una clave rechazada antes ya no aplica.
      rmSync(this.rutaBloqueo(identidad.rut), { force: true });
      this.guardarArchivo(identidad.rut, http, 'navegador');
      this.activas.set(identidad.rut, http);
      return identidad;
    });
  }

  /** Login pedido por la persona: levanta el bloqueo local y hace un único intento. */
  async loginInteractivo(rutTexto: string, clave: string, guardarClave: boolean): Promise<ResultadoLogin> {
    const rut = parseRut(rutTexto);
    this.pendientes.delete(rut.canonico);
    return this.coordinar(rut.canonico, async () => {
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
    });
  }

  /** Cliente con sesión válida. Solo entra sin intervención si hay clave guardada y el RUT no está bloqueado. */
  async sesionActiva(rutTexto: string): Promise<ClienteHttp> {
    const rut = parseRut(rutTexto);
    const pendiente = this.pendientes.get(rut.canonico);
    if (pendiente) return pendiente;
    const nueva = this.coordinar(rut.canonico, () => {
      if (existsSync(this.rutaBloqueo(rut.canonico))) {
        throw new ErrorImpuestocl('RUT_BLOQUEADO_LOCAL', `El RUT ${rut.canonico} está bloqueado localmente por una clave rechazada.`);
      }
      return this.obtenerSesion(rut);
    }).finally(() => {
      if (this.pendientes.get(rut.canonico) === nueva) this.pendientes.delete(rut.canonico);
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
    // Una consulta posterior al logout debe esperar el cierre, sin compartir la anterior.
    this.pendientes.delete(rut);
    return this.coordinar(rut, async () => {
      await cerrarSesion(this.activas.get(rut) ?? this.clienteDesdeArchivo(rut));
      this.activas.delete(rut);
      this.ultimaGuardadaEn.delete(rut);
      rmSync(this.rutaSesion(rut), { force: true });
      if (olvidarClave) await this.secretos.borrar(rut);
    });
  }

  /** Ordena los cambios de un RUT, incluido el llavero; un fallo no bloquea la siguiente operación. */
  private coordinar<T>(rut: string, operacion: () => Promise<T>): Promise<T> {
    const anterior = this.operaciones.get(rut) ?? Promise.resolve();
    const actual = anterior.then(operacion);
    const terminada = actual.then(() => {}, () => {}).finally(() => {
      if (this.operaciones.get(rut) === terminada) this.operaciones.delete(rut);
    });
    this.operaciones.set(rut, terminada);
    return actual;
  }

  private async obtenerSesion(rut: Rut): Promise<ClienteHttp> {
    const enMemoria = this.activas.get(rut.canonico);
    const guardada = enMemoria ?? this.clienteDesdeArchivo(rut.canonico);
    if (await this.sesionVigente(rut, guardada)) {
      this.activas.set(rut.canonico, guardada);
      return guardada;
    }
    // Otro proceso (terminal o interfaz web) pudo dejar en disco una sesión más nueva que la memorizada.
    const deOtroProceso = enMemoria ? this.clienteNuevoEnDisco(rut.canonico) : null;
    if (deOtroProceso) {
      const vigente = await this.sesionVigente(rut, deOtroProceso.http);
      this.ultimaGuardadaEn.set(rut.canonico, deOtroProceso.guardadaEn);
      if (vigente) {
        this.activas.set(rut.canonico, deOtroProceso.http);
        return deOtroProceso.http;
      }
    }
    const clave = await this.secretos.obtener(rut.canonico);
    if (!clave) {
      const delNavegador = this.leerArchivo(rut.canonico)?.origen === 'navegador';
      throw new ErrorImpuestocl('SESION_REQUERIDA', `No hay sesión activa para ${rut.canonico} ni clave guardada en el llavero.`, delNavegador ? { accion: accionLoginNavegador(rut.canonico) } : {});
    }
    const http = this.nuevoCliente();
    await iniciarSesion(http, rut, clave).catch(async (e: unknown) => {
      await this.siRechazoBloquear(rut.canonico, e);
      throw e;
    });
    this.guardarArchivo(rut.canonico, http);
    this.activas.set(rut.canonico, http);
    return http;
  }

  /** `false` si el SII dice que la sesión venció o falta su cookie TOKEN; cualquier otro fallo (incluida otra identidad) se propaga. */
  private async sesionVigente(rut: Rut, http: ClienteHttp): Promise<boolean> {
    try {
      const identidad = await leerIdentidad(http);
      if (identidad.rut !== rut.canonico) {
        throw new ErrorImpuestocl('PORTAL_CAMBIO', `El SII devolvió la identidad ${identidad.rut} en vez de ${rut.canonico}.`);
      }
      // Sin la cookie TOKEN las consultas de www4 no sirven: la sesión se renueva aunque misiir todavía responda.
      return (await http.cookie('https://www4.sii.cl/', 'TOKEN')) !== null;
    } catch (e) {
      if (e instanceof ErrorImpuestocl && e.codigo === 'SESION_REQUERIDA') return false;
      throw e;
    }
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
    const http = archivo ? this.clienteDeArchivo(archivo) : null;
    if (archivo && http) this.ultimaGuardadaEn.set(rut, archivo.guardadaEn);
    return http ?? this.nuevoCliente();
  }

  /** Cliente de un archivo distinto del último que este proceso leyó o escribió; `null` si no hay nada nuevo que probar. */
  private clienteNuevoEnDisco(rut: string): { http: ClienteHttp; guardadaEn: string } | null {
    const archivo = this.leerArchivo(rut);
    if (!archivo || archivo.guardadaEn === this.ultimaGuardadaEn.get(rut)) return null;
    const http = this.clienteDeArchivo(archivo);
    return http ? { http, guardadaEn: archivo.guardadaEn } : null;
  }

  private clienteDeArchivo(archivo: ArchivoSesion): ClienteHttp | null {
    if (!archivo.jar) return null;
    try {
      return new ClienteHttp(CookieJar.deserializeSync(archivo.jar), this.opcionesHttp);
    } catch {
      return null; // archivo corrupto: se parte de cero
    }
  }

  /** `origen` se conserva al persistir una sesión del navegador: sigue sin renovarse sola. */
  private guardarArchivo(rut: string, http: ClienteHttp, origen?: 'navegador'): void {
    const marca = origen ?? (this.activas.get(rut) === http ? this.leerArchivo(rut)?.origen : undefined);
    const archivo: ArchivoSesion = { rut, guardadaEn: new Date().toISOString(), jar: http.jar.serializeSync() ?? null, ...(marca ? { origen: marca } : {}) };
    writeFileSync(this.rutaSesion(rut), JSON.stringify(archivo), { mode: 0o600 });
    this.ultimaGuardadaEn.set(rut, archivo.guardadaEn);
  }

  private async siRechazoBloquear(rut: string, e: unknown): Promise<void> {
    if (!(e instanceof ErrorImpuestocl) || e.codigo !== 'CLAVE_RECHAZADA') return;
    const codigo = (e.detalle as { codigo?: string | null } | undefined)?.codigo ?? null;
    writeFileSync(this.rutaBloqueo(rut), JSON.stringify({ motivo: e.message, codigo, en: new Date().toISOString() }), { mode: 0o600 });
    try {
      await this.secretos.borrar(rut);
    } catch {
      // si el llavero falla, el bloqueo local igual evita reintentos
    }
  }
}
