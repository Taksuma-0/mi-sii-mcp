import * as z from 'zod';
import { ErrorImpuestocl } from '../../domain/errores.js';
import { parseRut } from '../../domain/rut.js';
import type { EmpresaAutorizada } from '../../domain/tipos.js';
import type { SumideroRespuestas } from '../../ports/index.js';
import { esObjeto, texto } from './campos.js';
import type { Http } from './http.js';
import { HOST_SDI, postSdi } from './sdi.js';

const URL_EMPRESAS = `${HOST_SDI}/consdcvinternetui/services/data/facadeService/getDcvEmpresasAutorizadas`;
const NAMESPACE = 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getDcvEmpresasAutorizadas';
const REFERER = `${HOST_SDI}/consdcvinternetui/`;
export const SUPERFICIE_EMPRESAS = 'cuenta.empresas';

const Sobre = z
  .object({
    respEstado: z.object({ codRespuesta: z.union([z.number(), z.string()]).nullish(), msgeRespuesta: z.string().nullish() }).loose(),
    data: z.array(z.unknown()).nullish(),
  })
  .loose();

/** Campos de cada fila que se guardan como evidencia; el resto (usuario autenticado, RUT con formato…) no. */
const CAMPOS_FILA = ['usrEmpRut', 'usrEmpDv', 'usrPrivilegios', 'usrFechaDesautorizacion', 'empFechaDesautorizacion', 'razonSocONombreEmp'] as const;

/**
 * Evidencia de las empresas autorizadas: solo una lista permitida de campos de cada fila y el estado de la respuesta.
 * Nunca lanza.
 */
export function sanearEmpresas(cuerpo: unknown): unknown {
  const sobre = esObjeto(cuerpo) ? cuerpo : {};
  const data = Array.isArray(sobre['data'])
    ? sobre['data'].flatMap((fila) => (esObjeto(fila) ? [Object.fromEntries(CAMPOS_FILA.map((campo) => [campo, fila[campo] ?? null]))] : []))
    : null;
  const estado = esObjeto(sobre['respEstado']) ? sobre['respEstado'] : {};
  return { data, respEstado: { codRespuesta: estado['codRespuesta'] ?? null, msgeRespuesta: estado['msgeRespuesta'] ?? null } };
}

function empresaDe(fila: unknown): EmpresaAutorizada {
  if (!esObjeto(fila)) throw new ErrorImpuestocl('PORTAL_CAMBIO', 'Empresa autorizada inesperada en la respuesta del SII (la fila no es un objeto).');
  let rutEmpresa: string;
  try {
    rutEmpresa = parseRut(`${texto(fila['usrEmpRut']) ?? ''}-${texto(fila['usrEmpDv']) ?? ''}`).canonico;
  } catch (cause) {
    throw new ErrorImpuestocl('PORTAL_CAMBIO', 'Empresa autorizada inesperada en la respuesta del SII (RUT o dígito verificador inválido).', { cause });
  }
  return {
    rutEmpresa,
    razonSocial: texto(fila['razonSocONombreEmp']),
    privilegios: texto(fila['usrPrivilegios']),
    fechaDesautorizacion: texto(fila['usrFechaDesautorizacion']) ?? texto(fila['empFechaDesautorizacion']),
  };
}

/**
 * Empresas que el contribuyente de la sesión puede consultar en el SII (`getDcvEmpresasAutorizadas`). Funciona sin la
 * cookie TOKEN. Cada fila trae su fecha de desautorización: null mientras sigue activa.
 */
export async function empresasAutorizadas(http: Http, sumidero: SumideroRespuestas): Promise<EmpresaAutorizada[]> {
  const crudo = await postSdi(http, sumidero, {
    superficie: SUPERFICIE_EMPRESAS,
    url: URL_EMPRESAS,
    namespace: NAMESPACE,
    referer: REFERER,
    data: {},
    conPage: true,
    exigeToken: false,
    sanear: sanearEmpresas,
  });
  const sobre = Sobre.safeParse(crudo);
  if (!sobre.success) throw new ErrorImpuestocl('PORTAL_CAMBIO', 'Respuesta inesperada de las empresas autorizadas.', { detalle: sobre.error.message });
  const codigo = sobre.data.respEstado.codRespuesta;
  if (codigo === undefined || codigo === null) throw new ErrorImpuestocl('PORTAL_CAMBIO', 'La respuesta de las empresas autorizadas no trae código de respuesta.');
  if (String(codigo) !== '0') {
    const mensaje = sobre.data.respEstado.msgeRespuesta?.trim() || `código ${String(codigo)}`;
    throw new ErrorImpuestocl(/autoriza/i.test(mensaje) ? 'SIN_PERMISO' : 'SII_RECHAZO', `Empresas autorizadas: ${mensaje}`);
  }
  if (!Array.isArray(sobre.data.data)) throw new ErrorImpuestocl('PORTAL_CAMBIO', 'La respuesta de las empresas autorizadas no trae la lista de empresas.');
  return sinDuplicados(sobre.data.data.map(empresaDe));
}

/** Una fila por RUT de empresa (es la clave de lo guardado): la vigente gana a la desautorizada; a igualdad, la primera. */
function sinDuplicados(empresas: readonly EmpresaAutorizada[]): EmpresaAutorizada[] {
  const porRut = new Map<string, EmpresaAutorizada>();
  for (const e of empresas) {
    const previa = porRut.get(e.rutEmpresa);
    if (!previa || (previa.fechaDesautorizacion !== null && e.fechaDesautorizacion === null)) porRut.set(e.rutEmpresa, e);
  }
  return [...porRut.values()];
}
