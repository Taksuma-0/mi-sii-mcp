import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fechaEnSantiago } from '../../domain/fechas.js';
import { periodoAnterior, periodoDeFecha } from '../../domain/periodo.js';
import { paginaLocal } from './pagina.js';
import { verificar, errorPublico, type EntradaVerificacion, type ResultadoVerificacion } from './verificar.js';

export interface ServidorLocal {
  readonly url: string;
  readonly cerrado: Promise<void>;
  cerrar(): Promise<void>;
}

interface OpcionesServidor {
  readonly puerto?: number;
  readonly verificar?: (entrada: EntradaVerificacion) => Promise<ResultadoVerificacion>;
  readonly inactividadMs?: number;
  readonly ahora?: () => Date;
}

class ErrorHttp extends Error {
  constructor(readonly estado: number, readonly codigo: string, readonly mensaje: string) { super(mensaje); }
}

const LIMITE_BODY = 16 * 1024;

function leerJson(req: IncomingMessage): Promise<unknown> {
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
      if (bytes > LIMITE_BODY) acabar(new ErrorHttp(413, 'SOLICITUD_GRANDE', 'La solicitud supera el tamaño permitido.'));
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

export async function crearServidorLocal(opciones: OpcionesServidor = {}): Promise<ServidorLocal> {
  const token = randomBytes(32).toString('hex');
  const nonce = randomBytes(18).toString('base64');
  const ejecutar = opciones.verificar ?? verificar;
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
        responder(res, 200, paginaLocal(token, nonce, mes), true);
        return;
      }
      if (req.method === 'GET' && req.url === '/estado') { responder(res, 200, { aplicacion: 'impuestocl-local-v1', ocupado }); return; }
      if (req.method !== 'POST' || (req.url !== '/verificar' && req.url !== '/cerrar')) throw new ErrorHttp(404, 'NO_ENCONTRADO', 'Esta ruta no está disponible.');
      if (req.headers.origin !== url || req.headers['x-csrf-token'] !== token) throw new ErrorHttp(403, 'ORIGEN_INVALIDO', 'La solicitud no proviene de esta aplicación. Vuelve a abrir el lanzador local.');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw new ErrorHttp(415, 'FORMATO_INVALIDO', 'La solicitud debe usar JSON.');
      if (ocupado || cerrando) throw new ErrorHttp(409, 'OCUPADO', 'Hay una consulta en curso. Espera a que termine.');
      // Reservar antes de leer el body evita dos envíos simultáneos.
      ocupado = true;
      clearTimeout(temporizador);
      try {
        const datos = await leerJson(req);
        if (req.url === '/cerrar') {
          if (!datos || typeof datos !== 'object' || Array.isArray(datos) || Object.keys(datos).length !== 0) throw new ErrorHttp(400, 'SOLICITUD_INVALIDA', 'La solicitud de cierre no es válida.');
          responder(res, 200, { cerrado: true });
          // Permite enviar la respuesta antes de cerrar sockets inactivos.
          res.once('finish', () => { void cerrar(); });
          return;
        }
        if (!entradaValida(datos)) throw new ErrorHttp(400, 'SOLICITUD_INVALIDA', 'Completa el RUT, la clave y el mes.');
        const resultado = await ejecutar(datos);
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

  await new Promise<void>((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(opciones.puerto ?? 47529, '127.0.0.1', () => { servidor.off('error', reject); resolve(); });
  });
  const direccion = servidor.address();
  if (!direccion || typeof direccion === 'string') throw new Error('No se pudo abrir el servidor local.');
  url = `http://127.0.0.1:${direccion.port}`;
  renovar();
  return { url, cerrar, cerrado };
}
