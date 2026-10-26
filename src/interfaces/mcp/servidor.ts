import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { consultaSql, esquemaDatos, LIMITES_CONSULTA } from '../../app/consulta-libre.js';
import { documentos, f29Historial, hallazgos, plazos, resumenIva } from '../../app/consultas.js';
import type { DepsApp } from '../../app/deps.js';
import { panorama } from '../../app/panorama.js';
import { listarPerfiles } from '../../app/perfiles.js';
import { sincronizar } from '../../app/sincronizar.js';
import { esErrorImpuestocl } from '../../domain/errores.js';
import { parsePeriodo } from '../../domain/periodo.js';
import { parseRut } from '../../domain/rut.js';
import { textoDocumentos, textoHallazgos, textoHistorialF29, textoPerfiles, textoPlazos, textoResumenIva, textoSync } from '../formato.js';

export const HERRAMIENTAS = [
  'perfiles_listar',
  'sii_panorama',
  'sincronizar',
  'iva_resumen',
  'iva_hallazgos',
  'rcv_documentos',
  'f29_historial',
  'plazos_proximos',
  'consulta_sql',
  'datos_esquema',
] as const;

/** Lo que lee el asistente al conectarse: flujo de uso, regla de la clave y cobertura (máximo 1 500 caracteres). */
export const INSTRUCCIONES_MCP = [
  '1. Empieza con perfiles_listar para conocer los RUT y el estado de su sesión; luego sii_panorama para ver qué meses hay guardados.',
  '2. Si faltan meses o están viejos, usa sincronizar por tramos de hasta 12 meses e informa el avance a la persona en cada tramo.',
  '3. Para IVA y conciliación prefiere iva_resumen, iva_hallazgos, f29_historial y plazos_proximos: aplican las reglas del dominio.',
  '4. Para cruces y preguntas libres, llama una vez a datos_esquema y luego a consulta_sql (solo lectura).',
  '5. Nunca pidas la clave tributaria ni intentes un login. Ante SESION_REQUERIDA (o CLAVE_RECHAZADA, RUT_BLOQUEADO_LOCAL), muestra a la persona el comando de login del mensaje para que lo ejecute en su terminal, o indícale «Abrir impuestocl.cmd»; después reintenta.',
  '6. Cobertura actual: solo RCV (compras y ventas) y F29. No es asesoría tributaria.',
].join('\n');

export interface OpcionesMcp {
  /** Comando que la persona ejecuta en su terminal para iniciar sesión; por defecto supone `impuestocl` en el PATH. */
  readonly comandoLogin?: (rut: string) => string;
}

const COMANDO_LOGIN_POR_DEFECTO = (rut: string): string => `impuestocl login ${rut} --guardar-clave`;
/** Errores que se resuelven con un login nuevo de la persona, no con un reintento. */
const ERRORES_DE_SESION: ReadonlySet<string> = new Set(['SESION_REQUERIDA', 'CLAVE_RECHAZADA', 'RUT_BLOQUEADO_LOCAL']);

interface ResultadoHerramienta {
  [clave: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const RUT = z.string().describe('RUT del contribuyente, por ejemplo 22.222.222-2');
const PERIODO = z.string().regex(/^\d{4}-\d{2}$/, 'Usa el formato AAAA-MM').describe('Período tributario AAAA-MM');
const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const respuesta = (texto: string, datos: unknown): ResultadoHerramienta => ({
  content: [{ type: 'text', text: `${texto}\n\n${JSON.stringify(datos, null, 2)}` }],
});

/** Qué hacer ante un error de sesión: la persona entra por su cuenta y el asistente nunca maneja la clave. */
function guiaLogin(comandoLogin: (rut: string) => string, rutTexto: string | undefined): string {
  let rut = '<rut>';
  try {
    if (rutTexto !== undefined) rut = parseRut(rutTexto).canonico;
  } catch {
    // RUT ilegible: el comando queda con el marcador.
  }
  return `Pide a la persona que ejecute en su propia terminal: \`${comandoLogin(rut)}\` (con --guardar-clave la sesión se renueva sola), o que entre con «Abrir impuestocl.cmd». Después reintenta. Nunca pidas la clave en el chat.`;
}

/** Convierte los errores de dominio en resultados de error; en los de sesión, `rut` es el de la llamada y arma el comando de login. */
function crearSeguro(comandoLogin: (rut: string) => string) {
  return async (fn: () => ResultadoHerramienta | Promise<ResultadoHerramienta>, rut?: string): Promise<ResultadoHerramienta> => {
    try {
      return await fn();
    } catch (e) {
      if (!esErrorImpuestocl(e)) throw e;
      // La acción por defecto de estos errores nombra `impuestocl login`, que no está en el PATH del asistente.
      const accion = ERRORES_DE_SESION.has(e.codigo) ? guiaLogin(comandoLogin, rut) : `Acción sugerida: ${e.accion}`;
      return { content: [{ type: 'text', text: `Error [${e.codigo}]: ${e.message}\n${accion}` }], isError: true };
    }
  };
}

/** Ninguna herramienta recibe claves: el login lo hace la persona en la interfaz local «Abrir impuestocl.cmd» o en su terminal con `opciones.comandoLogin`. */
export function crearServidorMcp(deps: DepsApp, version: string, opciones: OpcionesMcp = {}): McpServer {
  const comandoLogin = opciones.comandoLogin ?? COMANDO_LOGIN_POR_DEFECTO;
  const seguro = crearSeguro(comandoLogin);
  const servidor = new McpServer({ name: 'impuestocl', version }, { instructions: INSTRUCCIONES_MCP });

  servidor.registerTool(
    'perfiles_listar',
    {
      title: 'Perfiles configurados',
      description: 'Lista los contribuyentes configurados (persona natural y empresa) y el estado de su sesión SII. Úsala primero para saber qué RUT consultar.',
      inputSchema: z.object({}),
      annotations: SOLO_LECTURA,
    },
    async () =>
      seguro(() => {
        const perfiles = listarPerfiles(deps);
        return respuesta(textoPerfiles(perfiles), perfiles);
      }),
  );

  servidor.registerTool(
    'sii_panorama',
    {
      title: 'Panorama local del SII',
      description: 'Muestra el panorama de todos los meses almacenados localmente para un RUT, con montos y cobertura de RCV (compras y ventas) y F29. No requiere un período y no descarga datos del SII: consulta solo lo almacenado localmente.',
      inputSchema: z.object({ rut: RUT }),
      annotations: SOLO_LECTURA,
    },
    async ({ rut }) =>
      seguro(() => {
        const r = panorama(deps, rut);
        const meses = r.periodos.length;
        const ventas = r.periodos.filter((p) => p.disponibilidad.ventasRcv).length;
        const compras = r.periodos.filter((p) => p.disponibilidad.comprasRcv).length;
        const f29 = r.periodos.filter((p) => p.disponibilidad.f29).length;
        return respuesta(`Panorama local: ${meses} meses. Fuentes: RCV (compras y ventas) y F29. Cobertura: ventas ${ventas}/${meses}, compras ${compras}/${meses} y F29 ${f29}/${meses} meses consultados.`, r);
      }, rut),
  );

  servidor.registerTool(
    'sincronizar',
    {
      title: 'Sincronizar con el SII',
      description:
        'Trae desde el portal del SII el RCV (compras y ventas) y el F29 de un rango de meses y los guarda en la base local. Solo lee el SII: nunca presenta ni modifica nada allí. Admite hasta 120 meses por llamada; para historia larga llama por tramos de 12 meses, así avanzas por partes y evitas que el cliente agote el plazo de espera. Si no hay sesión, la respuesta trae el comando de login para que la persona lo ejecute en su terminal (o conecte desde «Abrir impuestocl.cmd»); nunca pidas la clave en el chat.',
      inputSchema: z.object({ rut: RUT, desde: PERIODO, hasta: PERIODO.optional(), superficies: z.array(z.enum(['rcv', 'f29'])).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ rut, desde, hasta, superficies }) =>
      seguro(async () => {
        const r = await sincronizar(deps, rut, parsePeriodo(desde), parsePeriodo(hasta ?? desde), superficies ?? ['rcv', 'f29']);
        // Los errores de sesión no se lanzan: vienen en `abortado`, así que el comando de login se agrega aquí.
        const sesion = r.abortado !== null && ERRORES_DE_SESION.has(r.abortado.codigo);
        return respuesta(sesion ? `${textoSync(r)}\n${guiaLogin(comandoLogin, r.rut)}` : textoSync(r), r);
      }, rut),
  );

  servidor.registerTool(
    'iva_resumen',
    {
      title: 'Resumen de IVA del mes',
      description:
        'Compara el débito y el crédito del RCV con el F29 presentado, revisa el remanente, los documentos pendientes y los plazos, y entrega los hallazgos de un mes. Lee solo la base local: revisa "frescura" y sincroniza si los datos están viejos.',
      inputSchema: z.object({ rut: RUT, periodo: PERIODO }),
      annotations: SOLO_LECTURA,
    },
    async ({ rut, periodo }) =>
      seguro(() => {
        const r = resumenIva(deps, rut, periodo);
        return respuesta(textoResumenIva(r), r);
      }, rut),
  );

  servidor.registerTool(
    'iva_hallazgos',
    {
      title: 'Hallazgos de conciliación',
      description: 'Hallazgos de conciliación de IVA (descuadres, F29 faltantes, facturas por reclamar, cambios posteriores al F29) de todos los meses con datos, o de un rango.',
      inputSchema: z.object({ rut: RUT, desde: PERIODO.optional(), hasta: PERIODO.optional(), severidad: z.enum(['info', 'advertencia', 'critico']).optional() }),
      annotations: SOLO_LECTURA,
    },
    async ({ rut, desde, hasta, severidad }) =>
      seguro(() => {
        const hs = hallazgos(deps, rut, { desde, hasta, severidad });
        return respuesta(textoHallazgos(hs), hs);
      }, rut),
  );

  servidor.registerTool(
    'rcv_documentos',
    {
      title: 'Documentos del RCV',
      description: 'Lista paginada (50 por página) de documentos del RCV de un mes, con filtros por lado, estado, tipo de documento y contraparte.',
      inputSchema: z.object({
        rut: RUT,
        periodo: PERIODO,
        lado: z.enum(['COMPRA', 'VENTA']).optional(),
        estado: z.enum(['REGISTRO', 'PENDIENTE', 'NO_INCLUIR', 'RECLAMADO']).optional(),
        tipo_doc: z.number().int().optional(),
        rut_contraparte: z.string().optional(),
        pagina: z.number().int().min(1).optional(),
      }),
      annotations: SOLO_LECTURA,
    },
    async (a) =>
      seguro(() => {
        const filtro = { lado: a.lado, estado: a.estado, tipoDoc: a.tipo_doc, rutContraparte: a.rut_contraparte ? parseRut(a.rut_contraparte).canonico : undefined };
        const p = documentos(deps, a.rut, a.periodo, filtro, a.pagina ?? 1, 50);
        return respuesta(textoDocumentos(p), p);
      }, a.rut),
  );

  servidor.registerTool(
    'f29_historial',
    {
      title: 'Historial del F29',
      description: 'Por cada mes del rango: si el F29 está presentado, folio, débitos, créditos y total a pagar.',
      inputSchema: z.object({ rut: RUT, desde: PERIODO, hasta: PERIODO }),
      annotations: SOLO_LECTURA,
    },
    async ({ rut, desde, hasta }) =>
      seguro(() => {
        const h = f29Historial(deps, rut, desde, hasta);
        return respuesta(textoHistorialF29(h), h);
      }, rut),
  );

  servidor.registerTool(
    'plazos_proximos',
    {
      title: 'Plazos próximos',
      description: 'Vencimientos próximos: F29 por presentar y facturas recibidas cuyo plazo de reclamo (8 días) está por vencer.',
      inputSchema: z.object({ rut: RUT, dias: z.number().int().min(1).max(365).optional() }),
      annotations: SOLO_LECTURA,
    },
    async ({ rut, dias }) =>
      seguro(() => {
        const ps = plazos(deps, rut, dias ?? 30);
        return respuesta(textoPlazos(ps), ps);
      }, rut),
  );

  servidor.registerTool(
    'consulta_sql',
    {
      title: 'Consulta SQL libre',
      description: `Ejecuta una sola sentencia SELECT (o WITH … SELECT) de solo lectura sobre una copia de los datos locales (RCV, F29, hallazgos y bitácora de sincronización). Llama antes una vez a datos_esquema: describe tablas, columnas y reglas (signo de las notas de crédito, estados del RCV, códigos del F29). Sin parámetros: escribe los valores como literales. Devuelve como máximo ${LIMITES_CONSULTA.filas} filas y ${LIMITES_CONSULTA.caracteres} caracteres: filtra por RUT y período, agrupa o usa LIMIT.`,
      inputSchema: z.object({ sql: z.string().describe('Una sola sentencia SELECT o WITH … SELECT') }),
      annotations: SOLO_LECTURA,
    },
    async ({ sql }) =>
      seguro(async () => {
        const r = await consultaSql(deps, sql);
        const n = r.filas.length;
        const texto = r.truncado ? `Resultado recortado: primeras ${n} filas, con posibles celdas acortadas. Usa LIMIT, GROUP BY o filtros para acotarlo.` : `${n} ${n === 1 ? 'fila' : 'filas'}`;
        // JSON compacto: la sangría solo gastaría tokens.
        return { content: [{ type: 'text', text: `${texto}\n\n${JSON.stringify({ columnas: r.columnas, filas: r.filas, truncado: r.truncado })}` }] };
      }),
  );

  servidor.registerTool(
    'datos_esquema',
    {
      title: 'Esquema de los datos',
      description: 'Describe las tablas que ve consulta_sql: cada columna con su tipo y significado, y las reglas para interpretar montos, notas de crédito, estados del RCV, códigos del F29 y la ausencia de datos. Llámala una vez antes de escribir consultas.',
      inputSchema: z.object({}),
      annotations: SOLO_LECTURA,
    },
    async () =>
      seguro(() => {
        const e = esquemaDatos();
        return respuesta(`Esquema de ${e.tablas.length} tablas y ${e.reglas.length} reglas de interpretación para consulta_sql.`, e);
      }),
  );

  return servidor;
}
