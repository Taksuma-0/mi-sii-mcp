import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { consultaSql, esquemaDatos, LIMITES_CONSULTA } from '../../app/consulta-libre.js';
import { documentos, f29Historial, hallazgos, plazos, resumenIva } from '../../app/consultas.js';
import type { DepsApp } from '../../app/deps.js';
import { sincronizarCuenta } from '../../app/cuenta.js';
import { panorama } from '../../app/panorama.js';
import { listarPerfilesConRenovacion } from '../../app/perfiles.js';
import { releerF29 } from '../../app/releer-f29.js';
import { resumenRenta, sincronizarRenta } from '../../app/renta.js';
import { sincronizar } from '../../app/sincronizar.js';
import { esErrorImpuestocl, type CodigoError } from '../../domain/errores.js';
import { parsePeriodo } from '../../domain/periodo.js';
import { parseRut } from '../../domain/rut.js';
import { lineaReintento, textoDocumentos, textoHallazgos, textoHistorialF29, textoCuenta, textoPerfiles, textoPlazos, textoReintentables, textoReintentablesCuenta, textoReintentablesRenta, textoReleerF29, textoRenta, textoResumenIva, textoResumenRenta, textoSync } from '../formato.js';

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
  'f29_releer',
  'perfil_sincronizar',
  'renta_sincronizar',
  'renta_resumen',
] as const;

/** Lo que lee el asistente al conectarse: flujo de uso, regla de la clave y cobertura (máximo 1 500 caracteres). */
export const INSTRUCCIONES_MCP = [
  '1. Empieza con perfiles_listar (RUT y sesión) y sii_panorama (lo guardado); a una persona sin IVA, parte por renta_sincronizar y renta_resumen.',
  '2. Si falta o está viejo, usa sincronizar por tramos de hasta 12 meses e informa el avance por tramo. Trae rcv y f29 por defecto; propuesta y bhe (boletas de honorarios recibidas) son opcionales. renta_sincronizar trae el F22 por año tributario; perfil_sincronizar, el perfil y las empresas autorizadas.',
  '3. Para IVA, retenciones y plazos prefiere iva_resumen, iva_hallazgos, f29_historial y plazos_proximos: aplican las reglas. Para la renta, renta_resumen. Si un F29 no cuadra o se actualizó impuestocl, f29_releer relee los PDF guardados sin ir al SII.',
  '4. Para cruces y preguntas libres, llama una vez a datos_esquema y luego a consulta_sql (solo lectura).',
  '5. Nunca pidas la clave tributaria ni intentes un login. Ante SESION_REQUERIDA (o CLAVE_RECHAZADA, RUT_BLOQUEADO_LOCAL), indica a la persona que abra «Abrir impuestocl.cmd» (doble clic en la carpeta impuestocl) y conecte su cuenta ahí; solo si prefiere la terminal, dale el comando del mensaje (login-navegador para ClaveÚnica). Después reintenta.',
  '6. Reintenta solo si el mensaje dice «Reintentar: ahora mismo» o «más tarde» (o lista «Reintentables más tarde»); con «Reintentar: no», sigue la acción indicada.',
  '7. Cobertura: RCV (compras y ventas), F29, propuesta de F29, boletas de honorarios recibidas y emitidas, renta F22, perfil tributario y empresas autorizadas. No es asesoría tributaria.',
].join('\n');

export interface OpcionesMcp {
  /** Comando que la persona ejecuta en su terminal para iniciar sesión; por defecto supone `impuestocl` en el PATH. */
  readonly comandoLogin?: (rut: string) => string;
  /**
   * Comando del login en el navegador (ClaveÚnica o clave escrita en la página real del SII). Por defecto supone
   * `impuestocl` en el PATH; si solo se indicó `comandoLogin`, no se menciona (no se sabe cómo llamarlo).
   */
  readonly comandoLoginNavegador?: (rut: string) => string;
}

/** Los dos comandos con que la persona entra por su cuenta. */
interface ComandosLogin {
  readonly clave: (rut: string) => string;
  readonly navegador: ((rut: string) => string) | null;
}

const COMANDO_LOGIN_POR_DEFECTO = (rut: string): string => `impuestocl login ${rut} --guardar-clave`;
const COMANDO_LOGIN_NAVEGADOR_POR_DEFECTO = (rut: string): string => `impuestocl login-navegador --rut ${rut}`;
/** Errores que se resuelven con un login nuevo de la persona, no con un reintento. */
const ERRORES_DE_SESION: ReadonlySet<CodigoError> = new Set<CodigoError>(['SESION_REQUERIDA', 'CLAVE_RECHAZADA', 'RUT_BLOQUEADO_LOCAL']);
/**
 * Errores que también se resuelven entrando, con la frase que explica por qué. Sus acciones por defecto
 * (`impuestocl perfil agregar`, "inicia sesión") nombran un comando fuera del PATH del asistente, o ninguno.
 */
const EXPLICACION_DE_LOGIN: ReadonlyMap<CodigoError, string> = new Map<CodigoError, string>([
  ['PERFIL_NO_EXISTE', 'El login con la clave de ese RUT crea su perfil.'],
  ['SIN_PERMISO', 'La sesión actual no tiene permiso para ese RUT: hay que entrar con la clave de ese contribuyente.'],
]);

interface ResultadoHerramienta {
  [clave: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const RUT = z.string().describe('RUT del contribuyente, por ejemplo 22.222.222-2');
const PERIODO = z.string().regex(/^\d{4}-\d{2}$/, 'Usa el formato AAAA-MM').describe('Período tributario AAAA-MM');
const ANIO_TRIBUTARIO = z.string().regex(/^\d{4}$/, 'Usa el año tributario AAAA').describe('Año tributario AAAA (año comercial + 1): 2026 es la renta del año 2025');
const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const respuesta = (texto: string, datos: unknown): ResultadoHerramienta => ({
  content: [{ type: 'text', text: `${texto}\n\n${JSON.stringify(datos, null, 2)}` }],
});

/** Qué hacer cuando hace falta entrar: la persona lo hace por su cuenta y el asistente nunca maneja la clave. */
function guiaLogin(comandos: ComandosLogin, rutTexto: string | undefined, explicacion?: string): string {
  let rut = '<rut>';
  try {
    if (rutTexto !== undefined) rut = parseRut(rutTexto).canonico;
  } catch {
    // RUT ilegible: el comando queda con el marcador.
  }
  const antes = explicacion === undefined ? '' : `${explicacion} `;
  const navegador = comandos.navegador
    ? ` Si entra con ClaveÚnica, que ejecute \`${comandos.navegador(rut)}\`: abre la página real del SII en su navegador y la sesión no se renueva sola.`
    : '';
  return `${antes}Pide a la persona que abra «Abrir impuestocl.cmd» (doble clic en la carpeta impuestocl), escriba ${rut} y su clave tributaria en la página y deje marcado «Mantener conectada»; también puede entrar ahí con ClaveÚnica. Si prefiere su propia terminal: \`${comandos.clave(rut)}\` (con --guardar-clave la sesión se renueva sola).${navegador} Después reintenta. Nunca pidas la clave en el chat.`;
}

/** La guía de login que corresponde a un código de error, o `null` si el error no se resuelve entrando. `codigo` es texto porque los errores de sincronización no lo tipan. */
function guiaDelCodigo(comandos: ComandosLogin, codigo: string, rut: string | undefined): string | null {
  const explicacion = (EXPLICACION_DE_LOGIN as ReadonlyMap<string, string>).get(codigo);
  if (explicacion === undefined && !(ERRORES_DE_SESION as ReadonlySet<string>).has(codigo)) return null;
  return guiaLogin(comandos, rut, explicacion);
}

/** Convierte los errores de dominio en resultados de error; en los que se resuelven entrando, `rut` es el de la llamada y arma el comando de login. */
function crearSeguro(comandos: ComandosLogin) {
  return async (fn: () => ResultadoHerramienta | Promise<ResultadoHerramienta>, rut?: string): Promise<ResultadoHerramienta> => {
    try {
      return await fn();
    } catch (e) {
      if (!esErrorImpuestocl(e)) throw e;
      // La acción por defecto de estos errores nombra `impuestocl login` o `impuestocl perfil agregar`, que no están en el PATH del asistente.
      const accion = guiaDelCodigo(comandos, e.codigo, rut) ?? `Acción sugerida: ${e.accion}`;
      return { content: [{ type: 'text', text: `Error [${e.codigo}]: ${e.message}\n${accion}\n${lineaReintento(e.codigo)}` }], isError: true };
    }
  };
}

/** Ninguna herramienta recibe claves: el login lo hace la persona en la interfaz local «Abrir impuestocl.cmd» o en su terminal con `opciones.comandoLogin`. */
export function crearServidorMcp(deps: DepsApp, version: string, opciones: OpcionesMcp = {}): McpServer {
  const comandoLogin: ComandosLogin = {
    clave: opciones.comandoLogin ?? COMANDO_LOGIN_POR_DEFECTO,
    navegador: opciones.comandoLoginNavegador ?? (opciones.comandoLogin ? null : COMANDO_LOGIN_NAVEGADOR_POR_DEFECTO),
  };
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
      seguro(async () => {
        const perfiles = await listarPerfilesConRenovacion(deps);
        // Sin perfiles, el primer paso es el login (registra el perfil solo); `impuestocl perfil agregar` no abre sesión ni está en el PATH.
        const texto = perfiles.length === 0 ? `No hay perfiles todavía. ${guiaLogin(comandoLogin, undefined, 'El login con la clave de un RUT crea su perfil.')}` : textoPerfiles(perfiles);
        return respuesta(texto, perfiles);
      }),
  );

  servidor.registerTool(
    'sii_panorama',
    {
      title: 'Panorama local del SII',
      description: 'Muestra el panorama de todos los meses almacenados localmente para un RUT, con montos y cobertura de RCV (compras y ventas) y F29 y, si se sincronizaron, la propuesta de F29, las boletas de honorarios recibidas y la renta (F22) por año tributario, además de los datos de la cuenta. No requiere un período y no descarga datos del SII: consulta solo lo almacenado localmente.',
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
        // La propuesta es opt-in: el sufijo aparece solo si algún mes la tiene guardada.
        const conPropuesta = r.periodos.filter((p) => p.propuesta !== undefined);
        const sufijoPropuesta = conPropuesta.length > 0 ? ` Propuesta del SII: ${conPropuesta.length}/${meses} meses consultados, ${conPropuesta.filter((p) => p.propuesta?.sinPropuesta === false).length} con propuesta.` : '';
        // Las boletas de honorarios también son opt-in: su sufijo aparece solo si algún mes las consultó.
        const conBoletas = r.periodos.filter((p) => typeof p.honorarios === 'object').length;
        const sufijoBoletas = conBoletas > 0 ? ` Boletas de honorarios recibidas: ${conBoletas}/${meses} meses consultados.` : '';
        // La renta es anual y opt-in: su sufijo aparece solo si hay algún F22 guardado.
        const sufijoRenta = r.renta ? ` Renta (F22): ${r.renta.length} ${r.renta.length === 1 ? 'año tributario guardado' : 'años tributarios guardados'}.` : '';
        const sufijo = `${sufijoPropuesta}${sufijoBoletas}${sufijoRenta}`;
        return respuesta(`Panorama local: ${meses} meses. Fuentes: RCV (compras y ventas) y F29. Cobertura: ventas ${ventas}/${meses}, compras ${compras}/${meses} y F29 ${f29}/${meses} meses consultados.${sufijo}`, r);
      }, rut),
  );

  servidor.registerTool(
    'sincronizar',
    {
      title: 'Sincronizar con el SII',
      description:
        'Trae desde el portal del SII el RCV (compras y ventas) y el F29 de un rango de meses y los guarda en la base local. Solo lee el SII: nunca presenta ni modifica nada allí. Por defecto trae rcv y f29 (propuesta y bhe son opcionales); con superficies puedes elegir, y «propuesta» (opcional, no va por defecto) agrega la propuesta de F29 del SII: crédito, remanente y retención propuestos, sin débito ni total a pagar; «bhe» (opcional, no va por defecto) agrega las boletas de honorarios recibidas del mes, con su retención, que se cruza con el código 151 del F29. La renta (F22) no va aquí: usa renta_sincronizar, y el perfil y las empresas autorizadas, perfil_sincronizar. Admite hasta 120 meses por llamada; para historia larga llama por tramos de 12 meses, así avanzas por partes y evitas que el cliente agote el plazo de espera. Si no hay sesión, la respuesta indica cómo conectar la cuenta en la página «Abrir impuestocl.cmd»; nunca pidas la clave en el chat.',
      inputSchema: z.object({ rut: RUT, desde: PERIODO, hasta: PERIODO.optional(), superficies: z.array(z.enum(['rcv', 'f29', 'propuesta', 'bhe'])).min(1).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ rut, desde, hasta, superficies }, ctx) =>
      seguro(async () => {
        // Si el cliente cancela (notifications/cancelled), se termina la superficie en curso y no se traen más meses.
        const r = await sincronizar(deps, rut, parsePeriodo(desde), parsePeriodo(hasta ?? desde), superficies ?? ['rcv', 'f29'], ctx.mcpReq.signal);
        // Los errores de sesión no se lanzan: vienen en `abortado`; SIN_PERMISO no es fatal y queda en los errores de cada período.
        // El comando de login se agrega aquí, una sola vez.
        const codigos = [...(r.abortado ? [r.abortado.codigo] : []), ...r.periodos.flatMap((p) => p.errores.map((e) => e.codigo))];
        const guia = codigos.map((c) => guiaDelCodigo(comandoLogin, c, r.rut)).find((g) => g !== null);
        const texto = [textoSync(r), textoReintentables(r), guia].filter((t) => t !== null).join('\n');
        return respuesta(texto, r);
      }, rut),
  );

  servidor.registerTool(
    'perfil_sincronizar',
    {
      title: 'Sincronizar la cuenta del SII',
      description:
        'Trae del SII el perfil tributario (si está autorizado a declarar el F29 hasta el día 20, régimen y segmento) y las empresas que el contribuyente puede consultar, y reemplaza `representa` del perfil por las empresas activas que informa el SII (lo que el SII reporta sobrescribe lo que se haya anotado a mano). Solo lee el SII; de las empresas autorizadas guarda RUT, razón social (que puede ser el nombre de una persona), privilegios y fecha de desautorización, y no guarda correos, teléfonos ni direcciones. Los plazos del F29 usan el día 20 solo si el SII lo autoriza (si no, el 12): sincroniza la cuenta antes de revisar plazos. Si no hay sesión, la respuesta indica cómo conectar la cuenta en la página «Abrir impuestocl.cmd»; nunca pidas la clave en el chat.',
      inputSchema: z.object({ rut: RUT }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ rut }, ctx) =>
      seguro(async () => {
        const r = await sincronizarCuenta(deps, rut, ctx.mcpReq.signal);
        // Igual que sincronizar: los errores de sesión vienen en `abortado` o en los errores de cada lectura, y el comando de login se agrega una sola vez.
        const codigos = [...(r.abortado ? [r.abortado.codigo] : []), ...r.errores.map((e) => e.codigo)];
        const guia = codigos.map((c) => guiaDelCodigo(comandoLogin, c, r.rut)).find((g) => g !== null);
        return respuesta([textoCuenta(r), textoReintentablesCuenta(r), guia].filter((t): t is string => typeof t === 'string').join('\n'), r);
      }, rut),
  );

  servidor.registerTool(
    'renta_sincronizar',
    {
      title: 'Sincronizar la renta (F22)',
      description:
        'Trae del SII la declaración anual de renta (F22) de un rango de años tributarios (AAAA; el año tributario es el año comercial + 1) y la guarda en la base local: las declaraciones del año, su conclusión y, del folio vigente, los códigos con su glosa, las observaciones y los eventos. A una persona (no a una empresa) le trae además el informe anual de boletas de honorarios emitidas del año comercial y, de los meses con boletas, su detalle boleta por boleta (a quién, bruto y retenciones; no repite meses que ya calzan); con el año tributario siguiente al actual (p. ej. 2027 en 2026) ves las boletas del año en curso aunque aún no haya F22. A cualquier perfil le trae también las rentas informadas por terceros: las declaraciones juradas (DJ) que otros presentaron sobre él, como la 1879 (quien pagó honorarios y retuvo) o la 1887 (sueldos del empleador), con cada informante, sus meses, montos y si el SII observó su declaración. Máximo 10 años por llamada. Solo lee el SII y no guarda nombres, domicilio, cuenta ni banco. Si el SII responde vacío donde había datos, se conservan los guardados. Si no hay sesión, la respuesta indica cómo conectar la cuenta en la página «Abrir impuestocl.cmd»; nunca pidas la clave en el chat.',
      inputSchema: z.object({ rut: RUT, desde: ANIO_TRIBUTARIO, hasta: ANIO_TRIBUTARIO.optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ rut, desde, hasta }, ctx) =>
      seguro(async () => {
        const r = await sincronizarRenta(deps, rut, desde, hasta, ctx.mcpReq.signal);
        // Igual que sincronizar: los errores de sesión vienen en `abortado` o en los errores de cada año, y el comando de login se agrega una sola vez.
        const codigos = [...(r.abortado ? [r.abortado.codigo] : []), ...r.anios.flatMap((a) => a.errores.map((e) => e.codigo))];
        const guia = codigos.map((c) => guiaDelCodigo(comandoLogin, c, r.rut)).find((g) => g !== null);
        return respuesta([textoRenta(r), textoReintentablesRenta(r), guia].filter((t): t is string => typeof t === 'string').join('\n'), r);
      }, rut),
  );

  servidor.registerTool(
    'renta_resumen',
    {
      title: 'Resumen de la renta (F22)',
      description:
        'Muestra la renta (F22) guardada localmente por año tributario: folio vigente, conclusión del SII, impuesto pagado, giro y remanente, los códigos del resultado con su glosa del SII, observaciones y eventos. De una persona muestra además sus boletas de honorarios emitidas del año comercial (vigentes, anuladas, bruto y retención) y su cruce con los códigos 547 (ingresos brutos) y 492 (retención) del F22, que vienen reajustados por IPC: cuadra si el F22 trae entre 0 % y 10 % más; con el detalle boleta por boleta, también sus 5 principales pagadores. También muestra lo informado por terceros (DJ): cada informante con sus meses, monto y estado, con un aviso si su declaración está observada por el SII; en la DJ 1879 cruza la retención informada con las boletas emitidas a ese RUT y la total con las boletas del año y con el 492 del F22 (cuadra o difiere por cuánto). Para preguntas como «¿a quién le emití boletas?» o por mes y receptor, usa consulta_sql sobre bhe_emitida. Lo informado por terceros está en dj_tercero. No va al SII: si no hay datos, usa renta_sincronizar. Los demás códigos están en f22_valor y las boletas por mes en bhe_emitida_mes (consulta_sql).',
      inputSchema: z.object({ rut: RUT, anio: ANIO_TRIBUTARIO.optional() }),
      annotations: SOLO_LECTURA,
    },
    async ({ rut, anio }) =>
      seguro(() => {
        const r = resumenRenta(deps, rut, anio);
        return respuesta(textoResumenRenta(r), r);
      }, rut),
  );

  servidor.registerTool(
    'f29_releer',
    {
      title: 'Releer el F29 guardado',
      description:
        'Relee los PDF ya guardados con el lector actual, sin ir al SII: vuelve a leer el PDF del F29 de cada folio que trajo una sincronización anterior y actualiza sus valores si cambian. Una lectura que no cuadra no reemplaza a una guardada que sí cuadra. Úsala tras actualizar impuestocl o ante un F29 leído que no cuadra; sin rango relee todos los meses guardados.',
      inputSchema: z.object({ rut: RUT, desde: PERIODO.optional(), hasta: PERIODO.optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ rut, desde, hasta }) =>
      seguro(async () => {
        const r = await releerF29(deps, rut, desde, hasta);
        return respuesta(textoReleerF29(r), r);
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
      description: 'Hallazgos de conciliación de IVA (descuadres, F29 faltantes, facturas por reclamar, cambios posteriores al F29 y, si se sincronizaron las boletas de honorarios recibidas, la retención de honorarios frente al código 151) de todos los meses con datos, o de un rango.',
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
      description: 'Por cada mes del rango: si el F29 está presentado, folio, débitos, créditos y total a pagar; si se sincronizaron las boletas de honorarios recibidas del mes, también la retención declarada (código 151) junto a la de esas boletas.',
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
      description: `Ejecuta una sola sentencia SELECT (o WITH … SELECT) de solo lectura sobre una copia de los datos locales (RCV, F29, propuesta de F29, boletas de honorarios recibidas, renta F22, hallazgos y bitácora de sincronización). Llama antes una vez a datos_esquema: describe tablas, columnas y reglas (signo de las notas de crédito, estados del RCV, códigos del F29). Sin parámetros: escribe los valores como literales. Devuelve como máximo ${LIMITES_CONSULTA.filas} filas y ${LIMITES_CONSULTA.caracteres} caracteres: filtra por RUT y período, agrupa o usa LIMIT.`,
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
