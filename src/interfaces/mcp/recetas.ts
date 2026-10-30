import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

/** Cierre común de toda receta: las reglas que el asistente nunca rompe. */
const REGLAS = 'Nunca pidas la clave tributaria ni la ClaveÚnica: si falta la sesión, pide abrir «Abrir mi-sii-mcp.cmd». Solo lee el SII; no es asesoría tributaria: recomienda confirmar con un contador cuando haya dinero en juego.';

const RUT = z.string().describe('RUT del contribuyente, por ejemplo 22.222.222-2');
const PERIODO = z.string().regex(/^\d{4}-\d{2}$/, 'Usa el formato AAAA-MM').describe('Período tributario AAAA-MM; si no se indica, el mes anterior');

const mensaje = (texto: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `${texto}\n\n${REGLAS}` } }] });

/**
 * Recetas (prompts MCP): consultas listas que el cliente muestra en su menú, para que nadie tenga que saber qué herramienta
 * pedir. Cada una devuelve un mensaje con las herramientas a usar, en orden, y cómo responder.
 */
export function registrarRecetas(servidor: McpServer): void {
  servidor.registerPrompt(
    'revision_mensual',
    {
      title: 'Revisión del mes',
      description: 'Revisa el IVA de un mes: datos al día, conciliación con el F29, hallazgos, F29 estimado si falta y vencimientos.',
      argsSchema: z.object({ rut: RUT, periodo: PERIODO.optional() }),
    },
    ({ rut, periodo }) =>
      mensaje(
        [
          `Revisa con mi-sii-mcp el IVA de ${rut} del mes ${periodo ?? 'anterior al actual'}:`,
          '1. sii_panorama: si ese mes no está guardado o está viejo, sincronizar ese mes con las superficies rcv, f29, propuesta y bhe.',
          '2. iva_resumen e iva_hallazgos del mes.',
          '3. Si el F29 no está presentado, f29_estimar para el monto a pagar y los días de atraso.',
          '4. plazos_proximos.',
          'Responde primero la conclusión en una frase, luego una tabla corta (débito, crédito, remanente y total) y al final los pasos sugeridos.',
        ].join('\n'),
      ),
  );

  servidor.registerPrompt(
    'que_tengo_pendiente',
    {
      title: '¿Qué tengo pendiente?',
      description: 'Vencimientos, F29 por presentar con su monto estimado y hallazgos críticos, de una cuenta o de todas.',
      argsSchema: z.object({ rut: RUT.optional() }),
    },
    ({ rut }) =>
      mensaje(
        [
          `Revisa con mi-sii-mcp qué tengo pendiente ${rut ? `con ${rut}` : 'en todas mis cuentas (parte por perfiles_listar)'}:`,
          '1. plazos_proximos con 60 días.',
          '2. iva_hallazgos con severidad critico y luego advertencia.',
          '3. Para cada F29 vencido o por vencer, f29_estimar para saber cuánto pagar.',
          'Ordena por urgencia (lo vencido primero) y di en una línea qué hacer con cada cosa y dónde (el portal del SII).',
        ].join('\n'),
      ),
  );
}
