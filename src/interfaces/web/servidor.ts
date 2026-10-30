import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fechaEnSantiago } from '../../domain/fechas.js';
import { parsePeriodo, periodoAnterior, periodoDeFecha, rangoPeriodos } from '../../domain/periodo.js';
import { parseRut } from '../../domain/rut.js';
import { ESTADOS_RCV, type EstadoRcv } from '../../domain/tipos.js';
import { cargarConfig } from '../../main/config.js';
import { crearEspacioLocal, type OperacionesEspacio } from './espacio.js';
import { paginaLocal } from './pagina.js';
import { puertoProhibido } from './puertos.js';
import { verificar, errorPublico, type EntradaVerificacion, type ResultadoVerificacion } from './verificar.js';

export interface ServidorLocal {
  readonly url: string;
  readonly cerrado: Promise<void>;
  cerrar(): Promise<void>;
}

export interface OpcionesServidor {
  readonly puerto?: number;
  readonly verificar?: (entrada: EntradaVerificacion) => Promise<ResultadoVerificacion>;
  readonly espacio?: OperacionesEspacio;
  readonly inactividadMs?: number;
  readonly ahora?: () => Date;
  /** Plazo del login con navegador, para el aviso de la página; por defecto el de la configuración. */
  readonly plazoNavegadorMs?: number;
}

class ErrorHttp extends Error {
  constructor(readonly estado: number, readonly codigo: string, readonly mensaje: string) { super(mensaje); }
}

const LIMITE_BODY = 16 * 1024;
/** Una cartola de hasta 5 MB llega en base64 (un tercio más) dentro del JSON. */
const LIMITE_CARTOLA = 7 * 1024 * 1024;
const RUTAS_ESPACIO = new Set(['/conectar', '/conectar-navegador', '/cuentas', '/panorama', '/sincronizar', '/analizar', '/documentos', '/desconectar', '/banco/importar']);

function leerJson(req: IncomingMessage, limite = LIMITE_BODY): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let bytes = 0;
    let terminado = false;
    const limpiar = () => { req.off('data', datos); req.off('end', fin); req.off('aborted', abortado); req.off('error', fallo); };
    const fallo = () => acabar(new ErrorHttp(400, 'SOLICITUD_INVALIDA', 'No se pudo leer la solicitud.'));
    const abortado = () => fallo();
    function acabar(error: ErrorHttp | null, valor?: unknown) {
      if (terminado) return;
      terminado = true; limpiar();
      if (error) { partes.length = 0; req.resume(); reject(error); } else resolve(valor);
    }
    function datos(parte: Buffer) {
      bytes += parte.length;
      if (bytes > limite) acabar(new ErrorHttp(413, 'SOLICITUD_GRANDE', 'La solicitud supera el tamaño permitido.'));
      else partes.push(parte);
    }
    function fin() {
      try { acabar(null, JSON.parse(Buffer.concat(partes).toString('utf8'))); }
      catch { acabar(new ErrorHttp(400, 'JSON_INVALIDO', 'La solicitud debe contener JSON válido.')); }
    }
    req.on('data', datos); req.on('end', fin); req.on('error', fallo); req.on('aborted', abortado);
  });
}

function entradaValida(valor: unknown): valor is EntradaVerificacion {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const datos = valor as Record<string, unknown>;
  return Object.keys(datos).length === 3 && ['rut', 'clave', 'mes'].every((campo) => typeof datos[campo] === 'string' && datos[campo].length > 0);
}

const esTexto = (valor: unknown): valor is string => typeof valor === 'string' && valor.length > 0;
const esEstado = (valor: unknown): valor is EstadoRcv => typeof valor === 'string' && ESTADOS_RCV.includes(valor as EstadoRcv);

/** Valida incluso con un servicio inyectado: ningún campo ajeno llega al espacio. */
function prepararOperacion(ruta: string, valor: unknown, espacio: OperacionesEspacio): () => Promise<unknown> {
  const invalida = () => new ErrorHttp(400, 'SOLICITUD_INVALIDA', 'Revisa los datos de la solicitud.');
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw invalida();
  const datos = valor as Record<string, unknown>;
  const campos = (permitidos: readonly string[]) => Object.keys(datos).every(campo => permitidos.includes(campo));
  if (ruta === '/conectar') {
    const { rut, clave, recordar } = datos;
    if (!campos(['rut', 'clave', 'recordar']) || !esTexto(rut) || !esTexto(clave)) throw invalida();
    if (recordar !== undefined && typeof recordar !== 'boolean') throw invalida();
    parseRut(rut);
    return () => espacio.conectar({ rut, clave, ...(recordar === undefined ? {} : { recordar }) });
  }
  if (ruta === '/cuentas') {
    if (Object.keys(datos).length !== 0) throw invalida();
    return async () => ({ cuentas: await espacio.cuentas() });
  }
  if (ruta === '/conectar-navegador') {
    const { rut } = datos;
    if (!campos(['rut'])) throw invalida();
    if (!('rut' in datos)) return () => espacio.conectarNavegador({});
    if (!esTexto(rut)) throw invalida();
    parseRut(rut);
    return () => espacio.conectarNavegador({ rut });
  }
  const { contexto } = datos;
  if (!esTexto(contexto)) throw invalida();
  if (ruta === '/panorama' || ruta === '/desconectar') {
    if (!campos(['contexto'])) throw invalida();
    return ruta === '/panorama' ? () => espacio.panorama(contexto) : async () => { await espacio.desconectar(contexto); return { desconectado: true }; };
  }
  if (ruta === '/sincronizar' || ruta === '/analizar') {
    const { desde, hasta, superficies } = datos;
    const permitidos = ruta === '/sincronizar' ? ['contexto', 'desde', 'hasta', 'superficies'] : ['contexto', 'desde', 'hasta'];
    if (!campos(permitidos) || !esTexto(desde) || !esTexto(hasta)) throw invalida();
    rangoPeriodos(parsePeriodo(desde), parsePeriodo(hasta), 120);
    if (ruta === '/analizar') return () => espacio.analizar(contexto, { desde, hasta });
    if (superficies === undefined) return () => espacio.sincronizar(contexto, { desde, hasta });
    if (!Array.isArray(superficies) || superficies.length < 1 || superficies.length > 2 || !superficies.every((s): s is 'rcv' | 'f29' => s === 'rcv' || s === 'f29')) throw invalida();
    return () => espacio.sincronizar(contexto, { desde, hasta, superficies });
  }
  if (ruta === '/banco/importar') {
    const { nombre, contenido, cuenta } = datos;
    if (!campos(['contexto', 'nombre', 'contenido', 'cuenta']) || !esTexto(nombre) || nombre.length > 200 || !/\.(csv|txt)$/i.test(nombre)) throw invalida();
    if (!esTexto(contenido) || !/^[A-Za-z0-9+/]+={0,2}$/.test(contenido) || (cuenta !== undefined && !esTexto(cuenta))) throw invalida();
    return () => espacio.importarCartola(contexto, { nombre, contenido, ...(cuenta === undefined ? {} : { cuenta }) });
  }
  if (ruta === '/documentos') {
    const { periodo, lado, estado, pagina } = datos;
    if (!campos(['contexto', 'periodo', 'lado', 'estado', 'pagina']) || !esTexto(periodo)) throw invalida();
    parsePeriodo(periodo);
    if (lado !== undefined && lado !== 'COMPRA' && lado !== 'VENTA') throw invalida();
    if (estado !== undefined && !esEstado(estado)) throw invalida();
    if (pagina !== undefined && (typeof pagina !== 'number' || !Number.isSafeInteger(pagina) || pagina < 1)) throw invalida();
    return () => espacio.documentos(contexto, { periodo, ...(lado === undefined ? {} : { lado }), ...(estado === undefined ? {} : { estado }), ...(pagina === undefined ? {} : { pagina }) });
  }
  throw invalida();
}

export async function crearServidorLocal(opciones: OpcionesServidor = {}): Promise<ServidorLocal> {
  const token = randomBytes(32).toString('hex');
  const nonce = randomBytes(18).toString('base64');
  const ejecutar = opciones.verificar ?? verificar;
  const minutosNavegador = Math.round((opciones.plazoNavegadorMs ?? cargarConfig().plazoNavegadorMs) / 60_000);
  const espacio = opciones.espacio ?? crearEspacioLocal();
  let ocupado = false;
  let cerrando = false;
  let url = '';
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const inactividadMs = opciones.inactividadMs ?? 30 * 60 * 1000;
  let resolverCerrado!: () => void;
  const cerrado = new Promise<void>((resolve) => { resolverCerrado = resolve; });
  const servidor = createServer((req, res) => { void atender(req, res); });

  function renovar() {
    clearTimeout(temporizador);
    if (cerrando || ocupado) return;
    temporizador = setTimeout(() => { void cerrar(); }, inactividadMs);
    temporizador.unref();
  }

  function responder(res: ServerResponse, estado: number, valor: unknown, html = false) {
    if (res.destroyed) return;
    res.writeHead(estado, {
      'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    });
    res.end(html ? valor as string : JSON.stringify(valor));
  }

  async function atender(req: IncomingMessage, res: ServerResponse) {
    // Un cliente desconectado no cancela ni vuelve a iniciar una consulta.
    req.on('error', () => {});
    res.on('error', () => {});
    try {
      if (req.headers.host !== new URL(url).host) throw new ErrorHttp(403, 'ORIGEN_INVALIDO', 'Abre la aplicación desde su lanzador local.');
      renovar();
      if (req.method === 'GET' && req.url === '/') {
        const mes = periodoAnterior(periodoDeFecha(fechaEnSantiago((opciones.ahora ?? (() => new Date()))()))).texto;
        responder(res, 200, paginaLocal(token, nonce, mes, minutosNavegador), true);
        return;
      }
      if (req.method === 'GET' && req.url === '/estado') { responder(res, 200, { aplicacion: 'mi-sii-mcp-local-v1', ocupado }); return; }
      if (req.method !== 'POST' || (req.url !== '/verificar' && req.url !== '/cerrar' && !RUTAS_ESPACIO.has(req.url ?? ''))) throw new ErrorHttp(404, 'NO_ENCONTRADO', 'Esta ruta no está disponible.');
      if (req.headers.origin !== url || req.headers['x-csrf-token'] !== token) throw new ErrorHttp(403, 'ORIGEN_INVALIDO', 'La solicitud no proviene de esta aplicación. Vuelve a abrir el lanzador local.');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw new ErrorHttp(415, 'FORMATO_INVALIDO', 'La solicitud debe usar JSON.');
      if (ocupado || cerrando) throw new ErrorHttp(409, 'OCUPADO', 'Hay una consulta en curso. Espera a que termine.');
      // Reservar antes de leer el body evita dos envíos simultáneos.
      ocupado = true;
      clearTimeout(temporizador);
      try {
        const datos = await leerJson(req, req.url === '/banco/importar' ? LIMITE_CARTOLA : LIMITE_BODY);
        if (req.url === '/cerrar') {
          if (!datos || typeof datos !== 'object' || Array.isArray(datos) || Object.keys(datos).length !== 0) throw new ErrorHttp(400, 'SOLICITUD_INVALIDA', 'La solicitud de cierre no es válida.');
          responder(res, 200, { cerrado: true });
          // Permite enviar la respuesta antes de cerrar sockets inactivos.
          res.once('finish', () => { void cerrar(); });
          return;
        }
        let resultado: unknown;
        if (req.url === '/verificar') {
          if (!entradaValida(datos)) throw new ErrorHttp(400, 'SOLICITUD_INVALIDA', 'Completa el RUT, la clave y el mes.');
          resultado = await ejecutar(datos);
        } else resultado = await prepararOperacion(req.url!, datos, espacio)();
        responder(res, 200, resultado);
      } finally { ocupado = false; renovar(); }
    } catch (error) {
      if (error instanceof ErrorHttp) responder(res, error.estado, { codigo: error.codigo, mensaje: error.mensaje });
      else responder(res, 400, errorPublico(error));
    }
  }

  async function cerrar(): Promise<void> {
    if (cerrando) return cerrado;
    cerrando = true;
    clearTimeout(temporizador);
    servidor.close(() => { servidor.removeAllListeners(); resolverCerrado(); });
    servidor.closeIdleConnections();
    return cerrado;
  }

  const escuchar = () => new Promise<void>((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(opciones.puerto ?? 47529, '127.0.0.1', () => { servidor.off('error', reject); resolve(); });
  });
  await escuchar();
  // Un puerto efímero que fetch y los navegadores prohíben no sirve: se vuelve a pedir uno al sistema.
  for (let intento = 0; opciones.puerto === 0 && intento < 20; intento++) {
    const asignado = servidor.address();
    if (!asignado || typeof asignado === 'string' || !puertoProhibido(asignado.port)) break;
    await new Promise<void>((resolve) => { servidor.close(() => resolve()); });
    await escuchar();
  }
  const direccion = servidor.address();
  if (!direccion || typeof direccion === 'string') throw new Error('No se pudo abrir el servidor local.');
  url = `http://127.0.0.1:${direccion.port}`;
  renovar();
  return { url, cerrar, cerrado };
}
