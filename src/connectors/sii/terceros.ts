import { ErrorImpuestocl, esErrorImpuestocl } from '../../domain/errores.js';
import { parseRut, type Rut } from '../../domain/rut.js';
import type { DjInformada, DjTercero } from '../../domain/tipos.js';
import type { SumideroRespuestas } from '../../ports/index.js';
import { esObjeto, mensajeDeError, numeroChileno, texto } from './campos.js';
import type { Http } from './http.js';
import { HOST_SDI, postSdi } from './sdi.js';

// «Consulta de declaraciones juradas de renta informadas por terceros» (SPA djconsultarentaui). Contrato verificado en
// vivo el 27-10-2026 con la DJ 1879; la forma de las columnas de las demás DJ (p. ej. la 1887) NO está verificada.
const BASE = `${HOST_SDI}/djconsultarentaui/services/data/facadeService`;
const NAMESPACE = 'cl.sii.sdi.lob.renta.djconsultarenta.data.api.interfaces.FacadeService';
const REFERER = `${HOST_SDI}/djconsultarentaui/internet/`;

/** Tope de páginas del detalle de una DJ: más que eso es un portal que no avanza. */
export const MAX_PAGINAS_DJ = 50;

/** Período de la consulta: el año tributario seguido de `00` (AT2026 → `202600`). */
const periodoDj = (anioTributario: number): string => `${anioTributario}00`;

/** Llama a una operación de la fachada y devuelve su `data` (null si no vino), o lanza el error del SII. */
async function consultar(http: Http, sumidero: SumideroRespuestas, op: string, superficie: string, data: Record<string, unknown>): Promise<unknown> {
  const crudo = await postSdi(http, sumidero, { superficie, url: `${BASE}/${op}`, namespace: `${NAMESPACE}/${op}`, referer: REFERER, data, conPage: true });
  if (!esObjeto(crudo)) throw new ErrorImpuestocl('PORTAL_CAMBIO', `Respuesta inesperada de las rentas informadas por terceros (${op}).`);
  const metaData = esObjeto(crudo['metaData']) ? crudo['metaData'] : {};
  const error = mensajeDeError(metaData['errors']) ?? mensajeDeError(crudo['errorMsg']);
  if (error) throw new ErrorImpuestocl(/autoriza/i.test(error) ? 'SIN_PERMISO' : 'SII_RECHAZO', `Rentas informadas por terceros: ${error}`);
  return crudo['data'] ?? null;
}

const cambio = (detalle: string): ErrorImpuestocl => new ErrorImpuestocl('PORTAL_CAMBIO', `Tabla inesperada de las rentas informadas por terceros: ${detalle}.`);

/** Una celda de dato: su texto (null si vacía) y si el SII la marca como RUT de contacto. */
interface CeldaDato {
  readonly valor: string | null;
  readonly contactoRut: boolean;
}

/** Tabla del SII ya resuelta: una cabecera por columna y las filas de datos con una celda por columna. */
interface TablaDj {
  readonly cabeceras: readonly string[];
  readonly datos: readonly (readonly CeldaDato[])[];
  readonly cantRegistros: number | null;
}

/** Entradas de un objeto con claves numéricas (`"00"`, `"01"`, …) ordenadas por número: JS ordena `"10"` antes que `"00"`. */
function porIndice(obj: Record<string, unknown>, que: string): [number, unknown][] {
  return Object.entries(obj)
    .map(([k, v]): [number, unknown] => {
      if (!/^\d+$/.test(k)) throw cambio(`${que} con clave "${k}"`);
      return [Number(k), v];
    })
    .sort((a, b) => a[0] - b[0]);
}

const espacios = (t: string): string => t.replace(/\s+/g, ' ').trim();
const enteroPositivo = (v: unknown, defecto: number): number => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : defecto);

/**
 * Resuelve la tabla del SII: `tabla` es un objeto de filas `"00"`, `"01"`, … con `fila` (celdas `"00"`, `"01"`, … , una por
 * columna: la clave es la columna) y `tipoCelda` (`cabecera` o `dato`; otras filas, como totales, se ignoran). En las
 * cabeceras, una celda con texto se aplica a las columnas que cubre su colspan y a las filas que cubre su rowspan; las
 * posiciones cubiertas llegan como `esParteDeSpan` (colspan) o como celdas nulas (rowspan) y no aportan texto. La cabecera
 * de una columna son los textos de arriba abajo unidos con « / ». Un título que cubre todas las columnas no se repite en
 * cada una. Se mapea por el texto de las cabeceras, nunca por la posición.
 */
function leerTabla(t: unknown): TablaDj {
  if (!esObjeto(t) || !esObjeto(t['tabla'])) throw cambio('sin tabla');
  const filas = porIndice(t['tabla'], 'fila').map(([, fila]) => {
    if (!esObjeto(fila) || !esObjeto(fila['fila'])) throw cambio('fila sin celdas');
    const celdas = porIndice(fila['fila'], 'celda').map(([i, c]): [number, Record<string, unknown>] => {
      if (!esObjeto(c)) throw cambio('celda que no es un objeto');
      return [i, c];
    });
    return { tipo: texto(fila['tipoCelda']), celdas };
  });
  const maximo = Math.max(0, ...filas.flatMap((f) => f.celdas.map(([i]) => i + 1)));
  const columnas = enteroPositivo(t['cantidadColumnas'], maximo);
  const cabecerasSii = filas.filter((f) => f.tipo === 'cabecera');
  if (cabecerasSii.length === 0 || columnas === 0) throw cambio('sin cabeceras');
  const partes: string[][] = Array.from({ length: columnas }, () => []);
  // Posiciones (fila de cabecera, columna) que ya cubre un rowspan de más arriba: su celda nula no aporta.
  const cubiertas = new Set<string>();
  cabecerasSii.forEach((fila, r) => {
    for (const [i, c] of fila.celdas) {
      const valor = texto(c['value']);
      if (c['esParteDeSpan'] === true || valor === null || cubiertas.has(`${r}|${i}`) || i >= columnas) continue;
      const colspan = enteroPositivo(c['colspan'], 1);
      const rowspan = enteroPositivo(c['rowspan'], 1);
      if (colspan >= columnas && columnas > 1) continue;
      for (let j = i; j < Math.min(columnas, i + colspan); j++) {
        partes[j]!.push(espacios(valor));
        for (let k = 1; k < rowspan; k++) cubiertas.add(`${r + k}|${j}`);
      }
    }
  });
  const cabeceras = partes.map((p, j) => (p.length === 0 ? `Columna ${j + 1}` : p.join(' / ')));
  const datos = filas
    .filter((f) => f.tipo === 'dato')
    .map((f) => {
      const fila: CeldaDato[] = Array.from({ length: columnas }, () => ({ valor: null, contactoRut: false }));
      for (const [i, c] of f.celdas) if (i < columnas) fila[i] = { valor: texto(c['value']), contactoRut: c['contactoRut'] === true };
      return fila;
    });
  const cant = t['cantRegistros'];
  return { cabeceras, datos, cantRegistros: typeof cant === 'number' && Number.isInteger(cant) && cant >= 0 ? cant : null };
}

// --- resumen ---------------------------------------------------------------------------------------------------------

/** Columna del resumen que dice cuántos informantes o casos hay (la 1879 trae `cantRegistros` 0 con 2 informantes). */
const CANTIDAD = /cantidad|casos/i;

/** Una DJ del resumen, o null si no trae datos: todas sus celdas vacías o en 0 (el SII lista DJ ajenas así). */
function djDelResumen(dj: number, titulo: string | null, resumen: unknown): DjInformada | null {
  const tabla = leerTabla(resumen);
  const fila = tabla.datos[0];
  const conDatos = (tabla.cantRegistros ?? 0) > 0 || tabla.datos.some((f) => f.some((c) => c.valor !== null && (numeroChileno(c.valor) ?? 1) !== 0));
  if (!conDatos || fila === undefined) return null;
  const valores: Record<string, string | null> = {};
  tabla.cabeceras.forEach((c, j) => {
    if (!(c in valores)) valores[c] = fila[j]!.valor;
  });
  const columnaCantidad = tabla.cabeceras.findIndex((c) => CANTIDAD.test(c));
  const cantidad = columnaCantidad < 0 ? null : numeroChileno(fila[columnaCantidad]!.valor);
  const registros = tabla.cantRegistros !== null && tabla.cantRegistros > 0 ? tabla.cantRegistros : cantidad !== null && Number.isInteger(cantidad) && cantidad >= 0 ? cantidad : null;
  return { dj, titulo, registros, resumen: valores };
}

/**
 * DJ que terceros informaron sobre el contribuyente en el año tributario y que traen datos (`getAgenteRetenedor`), por
 * número. Vacía si el SII no informa ninguna. No pide datos de contacto (`getContribuyente*`).
 */
export async function djInformadas(http: Http, sumidero: SumideroRespuestas, _rut: Rut, anioTributario: number): Promise<DjInformada[]> {
  const data = await consultar(http, sumidero, 'getAgenteRetenedor', 'terceros.resumen', { periodo: periodoDj(anioTributario) });
  if (data === null) return [];
  if (!Array.isArray(data)) throw cambio('el resumen no es una lista');
  const porDj = new Map<number, DjInformada>();
  for (const item of data) {
    if (!esObjeto(item) || !esObjeto(item['listAgenteRetenedor'])) throw cambio('resumen sin listAgenteRetenedor');
    const titulo = texto(item['title']);
    for (const [clave, valor] of Object.entries(item['listAgenteRetenedor'])) {
      if (!/^\d+$/.test(clave)) throw cambio(`DJ "${clave}"`);
      if (!esObjeto(valor)) throw cambio(`DJ ${clave} sin resumen`);
      const dj = djDelResumen(Number(clave), titulo, valor['resumen']);
      if (dj !== null && !porDj.has(dj.dj)) porDj.set(dj.dj, dj);
    }
  }
  return [...porDj.values()].sort((a, b) => a.dj - b.dj);
}

// --- detalle ---------------------------------------------------------------------------------------------------------

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
/** Última parte de una cabecera resuelta (`«Periodo … / ENE»` → `ENE`). */
const ultima = (cabecera: string): string => cabecera.split(' / ').at(-1)!;

// Columnas de identificación, por el texto de su cabecera (verificadas con la 1879).
const ES_RUT = /\brut\b/i;
const ES_NOMBRE = /nombre|raz[oó]n social/i;
const ES_ESTADO = /^estado$/i;
const ES_CERTIFICADO = /certificado/i;
const ES_FOLIO = /^folio$/i;
const ES_FECHA = /fecha/i;
/** Columnas de texto conocidas que no son montos ni se guardan aparte. */
const ES_OTRA = /tipo de formulario|origen/i;

/** Retención de honorarios: columnas «Monto Retenido … / Honorarios …» (verificado con la 1879); se suman todas sus tasas. */
const ES_RETENCION_HONORARIOS = (c: string): boolean => /retenid/i.test(c) && /honorario/i.test(c);
/**
 * Renta del sueldo en la DJ del empleador (1887): «Renta Total Neta Pagada», «Remuneración neta/imponible/pagada» o
 * «Sueldo», sin impuestos, retenciones ni directores. NO verificado en vivo: la 1887 aún no tiene datos para probarla.
 */
const ES_RENTA_SUELDO = (c: string): boolean =>
  /renta\s+(?:total\s+)?neta\s+pagada|remuneraci[oó]n(?:es)?\s+(?:total\s+)?(?:neta|imponible|l[ií]quida|pagada)|\bsueldos?\b/i.test(c) && !/impuesto|retenid|retenci[oó]n|director/i.test(c);
/** «Impuesto Único Retenido» (1887). NO verificado en vivo. */
const ES_IMPUESTO_UNICO = (c: string): boolean => /impuesto\s+[uú]nico/i.test(c);

/** `DD-MM-AAAA` o `DD/MM/AAAA` → `AAAA-MM-DD`; null si no calza. */
function fechaIso(v: string | null): string | null {
  const m = v === null ? null : /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}

/** Un mes marcado: «X» o cualquier texto que no sea vacío, «-», «.» ni «0». */
const marcado = (v: string | null): boolean => v !== null && !/^[-.0]$/.test(v);
/** Valores que el SII usa como «vacío» en una celda de monto. */
const vacioMonto = (v: string | null): boolean => v === null || v === '-';

/** Cómo leer las filas de una DJ: qué columna es cada dato, a partir de las cabeceras. */
interface Mapa {
  /** Columnas del RUT del informante (cuerpo, «-», DV): se concatenan. */
  readonly rut: readonly number[];
  readonly nombre: number | null;
  readonly estado: number | null;
  readonly certificado: number | null;
  readonly folio: number | null;
  readonly fecha: number | null;
  /** Columna → mes 1 a 12. */
  readonly meses: ReadonlyMap<number, number>;
  /** Columnas de montos, con su cabecera (única). */
  readonly montos: readonly (readonly [number, string])[];
}

const primera = (cabeceras: readonly string[], usadas: ReadonlySet<number>, prueba: (c: string) => boolean): number | null => {
  const j = cabeceras.findIndex((c, i) => !usadas.has(i) && prueba(c));
  return j < 0 ? null : j;
};

function mapear(tabla: TablaDj): Mapa {
  const { cabeceras, datos } = tabla;
  const usadas = new Set<number>();
  const tomar = (j: number | null): number | null => {
    if (j !== null) usadas.add(j);
    return j;
  };
  // El RUT del informante: el grupo de columnas con su misma cabecera (en la 1879, «Rut Declarante» cubre cuerpo, «-» y DV).
  const conContacto = datos[0]?.findIndex((c) => c.contactoRut) ?? -1;
  const ancla = conContacto >= 0 ? conContacto : cabeceras.findIndex((c) => ES_RUT.test(ultima(c)));
  const rut = ancla < 0 ? [] : cabeceras.flatMap((c, j) => (c === cabeceras[ancla] ? [j] : []));
  rut.forEach((j) => usadas.add(j));
  const meses = new Map<number, number>();
  cabeceras.forEach((c, j) => {
    const mes = MESES.indexOf(ultima(c).toUpperCase());
    if (!usadas.has(j) && mes >= 0) {
      meses.set(j, mes + 1);
      usadas.add(j);
    }
  });
  const nombre = tomar(primera(cabeceras, usadas, (c) => ES_NOMBRE.test(ultima(c))));
  const estado = tomar(primera(cabeceras, usadas, (c) => ES_ESTADO.test(ultima(c))));
  const certificado = tomar(primera(cabeceras, usadas, (c) => ES_CERTIFICADO.test(ultima(c))));
  const folio = tomar(primera(cabeceras, usadas, (c) => ES_FOLIO.test(ultima(c))));
  const fecha = tomar(primera(cabeceras, usadas, (c) => ES_FECHA.test(ultima(c))));
  cabeceras.forEach((c, j) => {
    if (ES_OTRA.test(ultima(c))) usadas.add(j);
  });
  // Monto: una columna sin ningún texto que no sea un número chileno (vacía o «-» vale null).
  const montos: [number, string][] = [];
  const nombres = new Set<string>();
  cabeceras.forEach((c, j) => {
    if (usadas.has(j) || !datos.every((f) => vacioMonto(f[j]!.valor) || numeroChileno(f[j]!.valor) !== null)) return;
    let unico = c;
    for (let n = 2; nombres.has(unico); n++) unico = `${c} (${n})`;
    nombres.add(unico);
    montos.push([j, unico]);
  });
  return { rut, nombre, estado, certificado, folio, fecha, meses, montos };
}

/** Suma de los montos no nulos de las columnas que pasan la prueba; undefined si no hay ninguno. */
function sumaDe(montos: Readonly<Record<string, number | null>>, prueba: (c: string) => boolean): number | undefined {
  const valores = Object.entries(montos).flatMap(([c, v]) => (v !== null && prueba(c) ? [v] : []));
  return valores.length === 0 ? undefined : valores.reduce((s, v) => s + v, 0);
}
/** El monto de la primera columna que pasa la prueba (NO verificado: con varias, se toma la de más a la izquierda). */
function primeroDe(montos: Readonly<Record<string, number | null>>, prueba: (c: string) => boolean): number | undefined {
  const v = Object.entries(montos).find(([c]) => prueba(c))?.[1];
  return v === null || v === undefined ? undefined : v;
}

function filaDe(dj: number, mapa: Mapa, fila: readonly CeldaDato[]): DjTercero {
  const valor = (j: number | null): string | null => (j === null ? null : fila[j]!.valor);
  if (mapa.rut.length === 0) throw cambio(`la DJ ${dj} no trae una columna con el RUT del informante`);
  let informanteRut: string;
  try {
    informanteRut = parseRut(mapa.rut.map((j) => fila[j]!.valor ?? '').join('')).canonico;
  } catch (e) {
    if (esErrorImpuestocl(e)) throw cambio(`la DJ ${dj} trae un RUT de informante inválido`);
    throw e;
  }
  const folio = numeroChileno(valor(mapa.folio));
  if (folio === null || !Number.isInteger(folio) || folio <= 0) throw cambio(`la DJ ${dj} trae una fila sin folio válido`);
  const nombre = valor(mapa.nombre);
  const estado = valor(mapa.estado);
  const montos: Record<string, number | null> = {};
  for (const [j, c] of mapa.montos) montos[c] = vacioMonto(fila[j]!.valor) ? null : numeroChileno(fila[j]!.valor);
  const retencionHonorarios = sumaDe(montos, ES_RETENCION_HONORARIOS);
  const rentaSueldo = primeroDe(montos, ES_RENTA_SUELDO);
  const impuestoUnicoRetenido = primeroDe(montos, ES_IMPUESTO_UNICO);
  return {
    dj,
    informanteRut,
    informanteNombre: nombre === null || /^[\s.\-]*$/.test(nombre) ? null : nombre,
    estado,
    observada: estado !== null && /\bobservada\b/i.test(estado) && !/\bno\s+observada\b/i.test(estado),
    certificado: valor(mapa.certificado),
    folio,
    fechaPresentacion: fechaIso(valor(mapa.fecha)),
    meses: [...mapa.meses].filter(([j]) => marcado(fila[j]!.valor)).map(([, mes]) => mes).sort((a, b) => a - b),
    montos,
    ...(retencionHonorarios === undefined ? {} : { retencionHonorarios }),
    ...(rentaSueldo === undefined ? {} : { rentaSueldo }),
    ...(impuestoUnicoRetenido === undefined ? {} : { impuestoUnicoRetenido }),
  };
}

/** La tabla del detalle de una respuesta de `getDjDetalle`; null si el SII no trae detalle. */
function tablaDetalle(data: unknown): TablaDj | null {
  if (data === null) return null;
  if (!esObjeto(data)) throw cambio('el detalle no es un objeto');
  const lista = data['listDetalle'];
  if (lista === null || lista === undefined) return null;
  if (!esObjeto(lista)) throw cambio('listDetalle no es un objeto');
  const detalle = lista['DETALLE'];
  if (detalle === null || detalle === undefined) return null;
  if (!esObjeto(detalle)) throw cambio('DETALLE no es un objeto');
  return detalle['detalle'] === null || detalle['detalle'] === undefined ? null : leerTabla(detalle['detalle']);
}

/**
 * Detalle de una DJ informada por terceros en el año tributario (`getDjDetalle`): una fila por informante y folio, sin
 * repetir. Pide más páginas (`seccion: "detalle"`) hasta juntar `cantRegistros` filas; una página sin filas nuevas o más
 * de `MAX_PAGINAS_DJ` páginas es PORTAL_CAMBIO. Vacía si el SII no trae detalle.
 */
export async function djDetalle(http: Http, sumidero: SumideroRespuestas, rut: Rut, anioTributario: number, dj: number): Promise<DjTercero[]> {
  const pedir = async (page: number): Promise<TablaDj | null> =>
    tablaDetalle(
      await consultar(http, sumidero, 'getDjDetalle', 'terceros.detalle', {
        periodo: periodoDj(anioTributario),
        rut: String(rut.cuerpo),
        dv: rut.dv,
        dj,
        page,
        key: 0,
        seccion: page === 1 ? '' : 'detalle',
        tipoConsulta: 2,
      }),
    );
  const primeraPagina = await pedir(1);
  if (primeraPagina === null) return [];
  const total = primeraPagina.cantRegistros;
  const filas = new Map<string, DjTercero>();
  const agregar = (tabla: TablaDj): number => {
    const mapa = mapear(tabla);
    let nuevas = 0;
    for (const dato of tabla.datos) {
      const f = filaDe(dj, mapa, dato);
      const clave = `${f.informanteRut}|${f.folio}`;
      if (filas.has(clave)) continue;
      filas.set(clave, f);
      nuevas++;
    }
    return nuevas;
  };
  agregar(primeraPagina);
  for (let page = 2; total !== null && filas.size < total; page++) {
    if (page > MAX_PAGINAS_DJ) throw cambio(`la DJ ${dj} informa ${total} registros y no se completaron en ${MAX_PAGINAS_DJ} páginas`);
    const tabla = await pedir(page);
    if (tabla === null || agregar(tabla) === 0) throw cambio(`la página ${page} de la DJ ${dj} no trajo registros nuevos (van ${filas.size} de ${total})`);
  }
  return [...filas.values()];
}
