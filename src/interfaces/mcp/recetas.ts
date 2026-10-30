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
    'cierre_contable',
    {
      title: 'Cierre contable del mes',
      description: 'Concilia el banco, revisa lo pendiente y arma los libros, los asientos y el resultado del mes para el contador.',
      argsSchema: z.object({ rut: RUT, periodo: PERIODO.optional() }),
    },
    ({ rut, periodo }) =>
      mensaje(
        [
          `Prepara con mi-sii-mcp el cierre contable de ${rut} del mes ${periodo ?? 'anterior al actual'}:`,
          '1. Si falta la cartola del mes, pide importarla (banco_importar o la página «Abrir mi-sii-mcp.cmd»).',
          '2. banco_conciliar del mes: revisa los movimientos sin conciliar y pregunta qué son antes de asignarlos o descartarlos.',
          '3. cuentas_pendientes para lo que falta cobrar o pagar.',
          '4. contabilidad_libro (compras, ventas, honorarios y banco) y contabilidad_asientos, con exportar si los quiere en Excel.',
          '5. contabilidad_resultado del mes (devengado y, si hay cartola, percibido).',
          'Resume en una tabla el resultado, lo pendiente y lo que quedó por clasificar, con los archivos exportados.',
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
          `Revisa con mi-sii-mcp qué tengo pendiente ${rut ? `con ${rut}` : 'en todas mis cuentas (parte por cartera_estado)'}:`,
          '1. novedades: los avisos de la revisión diaria que aún no viste.',
          '2. plazos_proximos con 60 días.',
          '3. iva_hallazgos con severidad critico y luego advertencia.',
          '4. Para cada F29 vencido o por vencer, f29_estimar para saber cuánto pagar.',
          'Ordena por urgencia (lo vencido primero) y di en una línea qué hacer con cada cosa y dónde (el portal del SII).',
        ].join('\n'),
      ),
  );

  servidor.registerPrompt(
    'cartera_semanal',
    {
      title: 'Revisión semanal de la cartera',
      description: 'Para quien lleva varias cuentas (p. ej. un contador): qué cuenta necesita atención esta semana y cuánto hay que pagar.',
    },
    () =>
      mensaje(
        [
          'Revisa con mi-sii-mcp todas las cuentas configuradas:',
          '1. cartera_estado para ver cada cuenta en una línea.',
          '2. A las que tengan F29 vencidos o por vencer, f29_estimar del mes; a las que tengan hallazgos críticos, iva_hallazgos.',
          '3. A las sin sesión, recuerda conectar la cuenta en «Abrir mi-sii-mcp.cmd»; a las con datos viejos, sincronizar el mes.',
          'Responde con una tabla por cuenta ordenada por urgencia: qué vence, cuánto pagar y el siguiente paso.',
        ].join('\n'),
      ),
  );
}
