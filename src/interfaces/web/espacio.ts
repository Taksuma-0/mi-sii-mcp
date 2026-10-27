import { randomBytes } from 'node:crypto';
import { documentos, resumenIva, type PaginaDocumentos, type ResumenIva } from '../../app/consultas.js';
import { panorama, type PanoramaSii } from '../../app/panorama.js';
import { listarPerfiles, registrarIdentidad } from '../../app/perfiles.js';
import { sincronizar } from '../../app/sincronizar.js';
import { ErrorImpuestocl, type CodigoError } from '../../domain/errores.js';
import { parsePeriodo, rangoPeriodos } from '../../domain/periodo.js';
import { parseRut } from '../../domain/rut.js';
import { ESTADOS_RCV, type EstadoRcv, type Lado } from '../../domain/tipos.js';
import { crearContenedor, crearLlavero } from '../../main/contenedor.js';
import type { SecretStore } from '../../ports/index.js';
import { textoSync } from '../formato.js';
import { errorPublico, SecretosNulos, type ContenedorWeb, type FabricaContenedorWeb } from './verificar.js';

/** Lo que la página puede pedir al SII; las superficies nuevas no se activan aquí sin una decisión explícita. */
export type SuperficieWeb = 'rcv' | 'f29';

export interface RangoEspacio { readonly desde: string; readonly hasta: string }
export interface EntradaSincronizacion extends RangoEspacio { readonly superficies?: readonly SuperficieWeb[] }
export interface EntradaDocumentos { readonly periodo: string; readonly lado?: Lado; readonly estado?: EstadoRcv; readonly pagina?: number }
export interface EntradaConexion { readonly rut: string; readonly clave: string; readonly recordar?: boolean }
export interface ResultadoConexion { readonly contexto: string; readonly panorama: PanoramaSii; readonly recordada: boolean }
/** Una cuenta guardada en este equipo, sin cookies ni claves: solo lo que la página necesita para mostrar su estado. */
export interface CuentaLocal {
  readonly rut: string;
  readonly nombre: string;
  readonly conectada: boolean;
  readonly bloqueada: boolean;
  /** Hay clave en el llavero del sistema y la sesión no vino del navegador: se renueva sola. */
  readonly renuevaSola: boolean;
  readonly guardadaEn: string | null;
}
export interface ResultadoSincronizacion { readonly estado: 'completo' | 'parcial'; readonly sincronizacion: string; readonly panorama: PanoramaSii }
export interface OperacionesEspacio {
  /** Con `recordar`, la clave queda en el llavero del sistema y la sesión se renueva sola (como `login --guardar-clave`). */
  conectar(entrada: EntradaConexion): Promise<ResultadoConexion>;
  /** Entra desde el navegador de la persona (ClaveÚnica o clave); `rut`, si viene, es el que se espera. */
  conectarNavegador(entrada: { readonly rut?: string }): Promise<{ contexto: string; panorama: PanoramaSii }>;
  /** Cuentas con perfil en este equipo y el estado de su sesión. */
  cuentas(): Promise<readonly CuentaLocal[]>;
  panorama(contexto: string): Promise<PanoramaSii>;
  sincronizar(contexto: string, entrada: EntradaSincronizacion): Promise<ResultadoSincronizacion>;
  analizar(contexto: string, entrada: RangoEspacio): Promise<readonly ResumenIva[]>;
  documentos(contexto: string, entrada: EntradaDocumentos): Promise<PaginaDocumentos>;
  desconectar(contexto: string): Promise<void>;
}

/**
 * Cada servidor conserva sólo las asociaciones de sus propias pestañas. El llavero solo se usa cuando la persona marca
 * «Mantener conectada» o para saber si una cuenta ya tiene clave guardada.
 */
export function crearEspacioLocal(fabrica: FabricaContenedorWeb = crearContenedor, llavero: SecretStore = crearLlavero()): OperacionesEspacio {
  const contextos = new Map<string, string>();

  function rutDeContexto(contexto: string): string {
    const rut = contextos.get(contexto);
    if (!rut) throw new ErrorImpuestocl('SESION_REQUERIDA', 'Conecta tu espacio local.');
    return rut;
  }

  async function conContenedor<T>(operacion: (contenedor: ContenedorWeb) => T | Promise<T>, secretos: SecretStore = new SecretosNulos()): Promise<T> {
    const contenedor = fabrica({ secretos });
    try { return await operacion(contenedor); }
    finally { contenedor.cerrar(); }
  }

  const periodosDe = (entrada: RangoEspacio) => rangoPeriodos(parsePeriodo(entrada.desde), parsePeriodo(entrada.hasta), 120);

  return {
    async conectar(entrada) {
      const rut = parseRut(entrada.rut).canonico;
      if (typeof entrada.clave !== 'string' || entrada.clave.length === 0) throw new ErrorImpuestocl('CLAVE_RECHAZADA', 'Ingresa tu clave tributaria.');
      const recordar = entrada.recordar === true;
      const { vista, recordada } = await conContenedor(async (contenedor) => {
        const login = await contenedor.sesiones.loginInteractivo(rut, entrada.clave, recordar);
        registrarIdentidad(contenedor.deps, login.identidad);
        return { vista: panorama(contenedor.deps, rut), recordada: login.claveGuardada };
      }, recordar ? llavero : new SecretosNulos());
      const contexto = randomBytes(32).toString('hex');
      contextos.set(contexto, rut);
      return { contexto, panorama: vista, recordada };
    },
    async conectarNavegador(entrada) {
      const esperado = entrada.rut === undefined ? undefined : parseRut(entrada.rut).canonico;
      const { rut, vista } = await conContenedor(async (contenedor) => {
        const identidad = await contenedor.sesiones.loginNavegador(esperado);
        registrarIdentidad(contenedor.deps, identidad);
        return { rut: identidad.rut, vista: panorama(contenedor.deps, identidad.rut) };
      });
      const contexto = randomBytes(32).toString('hex');
      contextos.set(contexto, rut);
      return { contexto, panorama: vista };
    },
    async cuentas() {
      const perfiles = await conContenedor(({ deps }) => listarPerfiles(deps));
      return Promise.all(perfiles.map(async (p): Promise<CuentaLocal> => ({
        rut: p.rut,
        nombre: p.razonSocial || p.alias || p.rut,
        conectada: p.sesion.tieneSesion,
        bloqueada: p.sesion.bloqueado,
        renuevaSola: p.sesion.origen !== 'navegador' && (await llavero.obtener(p.rut)) !== null,
        guardadaEn: p.sesion.guardadaEn,
      })));
    },
    async panorama(contexto) {
      const rut = rutDeContexto(contexto);
      return conContenedor(({ deps }) => panorama(deps, rut));
    },
    async sincronizar(contexto, entrada) {
      const rut = rutDeContexto(contexto);
      const periodos = periodosDe(entrada);
      const superficies: readonly SuperficieWeb[] = entrada.superficies === undefined ? ['rcv', 'f29'] : entrada.superficies;
      if (!Array.isArray(superficies) || superficies.length < 1 || superficies.length > 2 || ![...superficies].every(s => s === 'rcv' || s === 'f29')) throw new Error('Selecciona una o dos fuentes válidas.');
      return conContenedor(async ({ deps }) => {
        const sync = await sincronizar(deps, rut, periodos[0]!, periodos[periodos.length - 1]!, superficies);
        const seguro = { ...sync, abortado: sync.abortado ? { ...sync.abortado, mensaje: errorPublico(new ErrorImpuestocl(sync.abortado.codigo as CodigoError, '')).mensaje } : null };
        return {
          estado: sync.abortado || sync.periodos.some(p => p.errores.length > 0 || p.avisos.length > 0) ? 'parcial' : 'completo',
          sincronizacion: textoSync(seguro),
          panorama: panorama(deps, rut),
        };
      });
    },
    async analizar(contexto, entrada) {
      const rut = rutDeContexto(contexto);
      const periodos = periodosDe(entrada);
      return conContenedor(({ deps }) => periodos.map(p => resumenIva(deps, rut, p.texto)));
    },
    async documentos(contexto, entrada) {
      const rut = rutDeContexto(contexto);
      const periodo = parsePeriodo(entrada.periodo);
      if (entrada.lado !== undefined && entrada.lado !== 'COMPRA' && entrada.lado !== 'VENTA') throw new Error('Lado inválido.');
      if (entrada.estado !== undefined && !ESTADOS_RCV.includes(entrada.estado)) throw new Error('Estado inválido.');
      if (entrada.pagina !== undefined && (!Number.isSafeInteger(entrada.pagina) || entrada.pagina < 1)) throw new Error('Página inválida.');
      return conContenedor(({ deps }) => documentos(deps, rut, periodo.texto, { lado: entrada.lado, estado: entrada.estado }, entrada.pagina ?? 1, 50));
    },
    async desconectar(contexto) {
      rutDeContexto(contexto);
      contextos.delete(contexto);
    },
  };
}
