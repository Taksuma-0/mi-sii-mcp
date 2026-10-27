import { ErrorMiSiiMcp } from '../../domain/errores.js';
import type { Periodo } from '../../domain/periodo.js';
import type { Rut } from '../../domain/rut.js';
import type { BheEmitidaMes, BoletaHonorariosEmitida, InformeBheEmitidas, InformeBheEmitidasMes } from '../../domain/tipos.js';
import type { SumideroRespuestas } from '../../ports/index.js';
import { entero as enteroBhe, filaBoleta, IGUAL, leerInformeMensualBhe, sanearBhe, VALOR, valorDe, type InformeMensualBhe } from './bhe.js';
import { exigirSesion, type Http } from './http.js';

const URL_INFORME = 'https://loa.sii.cl/cgi_IMT/TMBCOC_InformeAnualBhe.cgi';
const URL_INFORME_MENSUAL = 'https://loa.sii.cl/cgi_IMT/TMBCOC_InformeMensualBhe.cgi';
const SUPERFICIE = 'bhe.emitidas.anual';
const INFORME = 'el informe anual de boletas de honorarios emitidas';

/** Meses en el orden del informe: cada columna de un mes es la clave `<mes><N>` (`ene1` … `dic7`). */
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;
/** Número de columna de cada dato del mes. */
const COLUMNA = { bruto: 1, retencionTerceros: 2, retencionPropia: 3, folioInicial: 4, folioFinal: 5, vigentes: 6, anuladas: 7 } as const;

/**
 * `xml_values['clave'] = valor;`, con claves que llevan dígitos (`ene1`, `tot1`). Las sumas (`sum<mes>`, `tot<N>`,
 * `sumtot`) son expresiones que la página calcula en el cliente: se leen como texto y no se usan.
 */
const ASIGNACION = new RegExp(String.raw`xml_values\s*\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]${IGUAL}${VALOR}`, 'g');
const CLAVE_MES = new RegExp(String.raw`^(?:${MESES.join('|')})[1-7]$`);

function inesperado(detalle: string): ErrorMiSiiMcp {
  return new ErrorMiSiiMcp('PORTAL_CAMBIO', `Informe anual de boletas de honorarios emitidas inesperado: ${detalle}.`);
}

/** Entero no negativo con punto de miles opcional; ausente o vacío → null (el SII deja vacíos los meses sin boletas). Otra cosa es PORTAL_CAMBIO. */
function entero(xml: Readonly<Record<string, string>>, clave: string): number | null {
  const v = (xml[clave] ?? '').trim();
  if (v === '') return null;
  if (!/^\d[\d.]*$/.test(v)) throw inesperado(`${clave} = "${v}"`);
  return Number(v.replace(/\./g, ''));
}

function mesDe(xml: Readonly<Record<string, string>>, indice: number): BheEmitidaMes {
  const prefijo = MESES[indice]!;
  const valor = (columna: number): number | null => entero(xml, `${prefijo}${columna}`);
  // Un mes sin boletas viene vacío: los montos y cantidades son 0 y no hay folios (0 tampoco es un folio).
  const cantidad = (columna: number): number => valor(columna) ?? 0;
  const folio = (columna: number): number | null => valor(columna) || null;
  return {
    mes: indice + 1,
    bruto: cantidad(COLUMNA.bruto),
    retencionTerceros: cantidad(COLUMNA.retencionTerceros),
    retencionPropia: cantidad(COLUMNA.retencionPropia),
    vigentes: cantidad(COLUMNA.vigentes),
    anuladas: cantidad(COLUMNA.anuladas),
    folioInicial: folio(COLUMNA.folioInicial),
    folioFinal: folio(COLUMNA.folioFinal),
  };
}

/** Lee el informe ya decodificado; revisa que sea del año y del RUT pedidos antes de tomar sus montos. */
function leerInforme(html: string, rut: Rut, anioComercial: number): InformeBheEmitidas {
  const xml: Record<string, string> = {};
  for (const m of html.matchAll(ASIGNACION)) xml[m[1]!] = valorDe(m, 2);
  if (!Object.keys(xml).some((clave) => CLAVE_MES.test(clave))) throw inesperado('no trae los meses (xml_values de ene1 a dic7)');
  const anio = (xml['anio_consulta'] ?? '').trim();
  if (anio !== String(anioComercial)) throw inesperado(`se pidió el año ${anioComercial} y el SII respondió el año "${anio}"`);
  // El RUT del informe solo se revisa si viene: si es otro, los montos no son de este contribuyente.
  const rutInforme = (xml['rut_arrastre'] ?? '').trim();
  const dvInforme = (xml['dv_arrastre'] ?? '').trim().toUpperCase();
  if ((rutInforme !== '' && rutInforme !== String(rut.cuerpo)) || (dvInforme !== '' && dvInforme !== rut.dv)) throw inesperado('es de otro RUT');
  return {
    anioComercial,
    sociedadProfesional: (xml['es_sociedad_profesionales'] ?? '').trim().toUpperCase() === 'SI',
    meses: MESES.map((_, i) => mesDe(xml, i)),
  };
}

/**
 * Informe anual de boletas de honorarios electrónicas emitidas por el contribuyente en un año comercial: los 12 meses
 * con bruto, retenciones, folios y boletas vigentes y anuladas. Una sola página; la evidencia se guarda sin el nombre
 * del contribuyente.
 */
export async function bheEmitidasAnual(http: Http, sumidero: SumideroRespuestas, rut: Rut, anioComercial: number): Promise<InformeBheEmitidas> {
  const parametros = { rut_arrastre: String(rut.cuerpo), dv_arrastre: rut.dv, cbanoinformeanual: String(anioComercial) };
  const consulta = new URLSearchParams(parametros);
  const r = exigirSesion(await http.solicitar(`${URL_INFORME}?${consulta.toString()}`, { headers: { Accept: 'text/html,application/xhtml+xml,*/*' } }));
  if (r.status === 401) throw new ErrorMiSiiMcp('SESION_REQUERIDA', 'El SII no reconoció la sesión (401).');
  if (r.status === 429) throw new ErrorMiSiiMcp('SII_LIMITE', 'El SII limitó las consultas; reintenta más tarde.');
  sumidero({ superficie: SUPERFICIE, parametros, cuerpo: sanearBhe(r.texto, INFORME), obtenidoEn: new Date().toISOString() });
  if (r.status === 403) throw new ErrorMiSiiMcp('SII_RECHAZO', `El SII rechazó la consulta de ${SUPERFICIE} (403).`);
  return leerInforme(r.texto, rut, anioComercial);
}

/** Campos que cada boleta emitida debe traer, además del folio y el estado: sin ellos no se sabe a quién ni por cuánto. */
const OBLIGATORIOS_EMITIDA = ['rutreceptor', 'dvreceptor', 'totalhonorarios', 'retencion_emisor', 'retencion_receptor', 'honorariosliquidos'] as const;

/**
 * El informe mensual debe ser del RUT, año y mes pedidos; cada dato solo se revisa si viene (el mes puede venir sin cero
 * a la izquierda).
 */
function revisarMes(xml: Readonly<Record<string, string>>, rut: Rut, periodo: Periodo): void {
  const distinto = (clave: string, esperado: number | string): boolean => {
    const v = (xml[clave] ?? '').trim().toUpperCase();
    return v !== '' && (typeof esperado === 'number' ? enteroBhe(v) !== esperado : v !== esperado);
  };
  if (distinto('anio_consulta', periodo.anio) || distinto('mes_consulta', periodo.mes)) {
    throw inesperado(`se pidió ${periodo.texto} y el SII respondió ${xml['anio_consulta'] ?? '?'}-${xml['mes_consulta'] ?? '?'}`);
  }
  if (distinto('rut_arrastre', rut.cuerpo) || distinto('dv_arrastre', rut.dv)) throw inesperado('el informe mensual es de otro RUT');
}

const emitidas = (rut: Rut, periodo: Periodo): InformeMensualBhe<BoletaHonorariosEmitida> => ({
  url: URL_INFORME_MENSUAL,
  superficie: 'bhe.emitidas.mensual',
  nombre: 'boletas de honorarios emitidas',
  boleta: (n, campos) => {
    const f = filaBoleta(n, campos, OBLIGATORIOS_EMITIDA);
    return {
      rut: rut.canonico,
      periodo: periodo.texto,
      folio: f.folio,
      rutReceptor: f.rut('rutreceptor', 'dvreceptor', 'receptor'),
      nombreReceptor: f.texto('nombrereceptor'),
      fecha: f.fecha('fecha_boleta'),
      fechaEmision: f.fecha('fechaemision'),
      bruto: f.monto('totalhonorarios'),
      retencionEmisor: f.monto('retencion_emisor'),
      retencionReceptor: f.monto('retencion_receptor'),
      liquido: f.monto('honorariosliquidos'),
      sociedadProfesional: f.sociedadProfesional,
      anulada: f.anulada,
      fechaAnulacion: f.anulada ? f.fecha('fechaanulacion') : null,
    };
  },
  // El emisor es siempre el contribuyente: el folio basta para reconocer una boleta repetida.
  clave: (b) => String(b.folio),
  controles: [
    { clave: 'suma_honorarios', descripcion: 'honorarios por', monto: (b) => b.bruto },
    { clave: 'suma_retencion_receptor', descripcion: 'una retención de terceros de', monto: (b) => b.retencionReceptor },
    { clave: 'suma_retencion_emisor', descripcion: 'una retención propia de', monto: (b) => b.retencionEmisor },
    { clave: 'suma_liquido', descripcion: 'un líquido de', monto: (b) => b.liquido },
  ],
  revisar: (xml) => revisarMes(xml, rut, periodo),
});

/**
 * Informe mensual de boletas de honorarios electrónicas emitidas por el contribuyente: boleta por boleta, con la misma
 * paginación y controles que las recibidas. Nunca guarda la identidad del emisor, el correo del receptor ni el código de
 * barras. Devuelve null ante un vacío ambiguo (sin boletas ni `total_boletas`).
 */
export function bheEmitidasMes(http: Http, sumidero: SumideroRespuestas, rut: Rut, periodo: Periodo): Promise<InformeBheEmitidasMes | null> {
  return leerInformeMensualBhe(http, sumidero, emitidas(rut, periodo), rut, periodo);
}
