import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { documentos, f29Historial, hallazgos, plazos, resumenIva } from '../../app/consultas.js';
import type { DepsApp } from '../../app/deps.js';
import { panorama } from '../../app/panorama.js';
import { listarPerfiles } from '../../app/perfiles.js';
import { sincronizar } from '../../app/sincronizar.js';
import { esErrorImpuestocl } from '../../domain/errores.js';
import { parsePeriodo } from '../../domain/periodo.js';
import { parseRut } from '../../domain/rut.js';
import { textoDocumentos, textoHallazgos, textoHistorialF29, textoPerfiles, textoPlazos, textoResumenIva, textoSync } from '../formato.js';

export const HERRAMIENTAS = ['perfiles_listar', 'sii_panorama', 'sincronizar', 'iva_resumen', 'iva_hallazgos', 'rcv_documentos', 'f29_historial', 'plazos_proximos'] as const;

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

async function seguro(fn: () => ResultadoHerramienta | Promise<ResultadoHerramienta>): Promise<ResultadoHerramienta> {
  try {
    return await fn();
  } catch (e) {
    if (!esErrorImpuestocl(e)) throw e;
    return { content: [{ type: 'text', text: `Error [${e.codigo}]: ${e.message}\nAcción sugerida: ${e.accion}` }], isError: true };
  }
}

/** Ninguna herramienta recibe claves: el login se hace solo en la terminal con `impuestocl login <rut>`. */
export function crearServidorMcp(deps: DepsApp, version: string): McpServer {
  const servidor = new McpServer({ name: 'impuestocl', version });

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
      }),
  );

  servidor.registerTool(
    'sincronizar',
    {
      title: 'Sincronizar con el SII',
      description:
        'Trae desde el portal del SII el RCV (compras y ventas) y el F29 de un rango de meses y los guarda en la base local. Solo lee el SII: nunca presenta ni modifica nada allí. Si no hay sesión, pide a la persona ejecutar `impuestocl login <rut>` en su terminal.',
      inputSchema: z.object({ rut: RUT, desde: PERIODO, hasta: PERIODO.optional(), superficies: z.array(z.enum(['rcv', 'f29'])).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ rut, desde, hasta, superficies }) =>
      seguro(async () => {
        const r = await sincronizar(deps, rut, parsePeriodo(desde), parsePeriodo(hasta ?? desde), superficies ?? ['rcv', 'f29']);
        return respuesta(textoSync(r), r);
      }),
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
      }),
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
      }),
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
      }),
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
      }),
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
      }),
  );

  return servidor;
}
