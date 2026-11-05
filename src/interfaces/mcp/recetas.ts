import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

/** Cierre común de toda receta: las reglas que el asistente nunca rompe. */
const REGLAS = 'Nunca pidas la clave tributaria ni la ClaveÚnica: si falta la sesión, usa cuenta_conectar. Solo lee el SII; no es asesoría tributaria: recomienda confirmar con un contador cuando haya dinero en juego.';

const RUT = z.string().describe('RUT del contribuyente, por ejemplo 22.222.222-2');
const PERIODO = z.string().regex(/^\d{4}-\d{2}$/, 'Usa el formato AAAA-MM').describe('Período tributario AAAA-MM; si no se indica, el mes anterior');

/**
 * Cómo presentar la respuesta: la misma plantilla con que responden las herramientas, con lo propio de cada receta en la
 * tabla y el informe visual que conviene ofrecer.
 */
const presentaAsi = (tabla: string, informe: string): string =>
  [
    'Presenta así:',
    '1. Primera línea: la conclusión con su ícono (✅ cuadra o al día, ⚠️ revisar, ⛔ urgente, ℹ️ falta un dato).',
    `2. Una tabla corta con ${tabla}.`,
    '3. Los hallazgos o diferencias, cada uno con su ícono, del más grave al más leve; si no hay, dilo en una línea.',
    '4. «Siguientes pasos» en una línea, con lo que conviene pedir después, y la fecha de los datos.',
    `5. Ofrece: «si quieres, lo veo en un informe visual» (informe_visual ${informe}).`,
  ].join('\n');

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
          presentaAsi('débito y crédito del RCV frente al F29, remanente y total a pagar', `con tipo iva, rut ${rut} y el periodo revisado`),
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
          '1. Si falta la cartola del mes, pide importarla (banco_importar o la página que abre cuenta_conectar).',
          '2. banco_conciliar del mes: revisa los movimientos sin conciliar y pregunta qué son antes de asignarlos o descartarlos.',
          '3. cuentas_pendientes para lo que falta cobrar o pagar.',
          '4. contabilidad_libro (compras, ventas, honorarios y banco) y contabilidad_asientos, con exportar si los quiere en Excel.',
          '5. contabilidad_resultado del mes (devengado y, si hay cartola, percibido).',
          'Nombra los archivos exportados.',
          presentaAsi('el resultado del mes, lo pendiente por cobrar y pagar, y lo que quedó por clasificar', `con tipo iva, rut ${rut} y el periodo del cierre`),
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
          presentaAsi('cada pendiente: qué es, cuándo vence y cuánto pagar', rut ? `con tipo vencimientos y rut ${rut}` : 'con tipo cartera'),
        ].join('\n'),
      ),
  );

  servidor.registerPrompt(
    'preparar_renta',
    {
      title: 'Preparar la renta',
      description: 'Junta lo que el SII ya sabe para el F22, lo cruza con lo guardado y estima el resultado antes de abril.',
      argsSchema: z.object({ rut: RUT, anio: z.string().regex(/^\d{4}$/, 'Usa el año tributario AAAA').describe('Año tributario AAAA (año comercial + 1)').optional() }),
    },
    ({ rut, anio }) =>
      mensaje(
        [
          `Prepara con mi-sii-mcp la renta de ${rut}${anio ? ` del año tributario ${anio}` : ' del año tributario en curso'}:`,
          '1. renta_sincronizar de ese año (F22, boletas emitidas, declaraciones juradas de terceros y lo que el SII prepara para el F22) y renta_resumen.',
          '2. Persona: fuentes_oficiales (con regla=true) para los datos públicos del año y luego renta_estimar; si hay F22, compáralo.',
          '3. Empresa: cierre_proyectar del año comercial y regimen_simular si quiere comparar regímenes; revisa en renta_resumen los PPM y el comparativo de F29 y RCV que prepara el SII.',
          '4. ahorro_oportunidades para lo que aún se puede hacer antes del 31 de diciembre o de declarar.',
          'Di qué falta para confirmar la estimación.',
          presentaAsi('cuánto saldría a pagar o a devolver y las diferencias con el F22 o con lo informado por terceros', `con tipo renta y rut ${rut}`),
        ].join('\n'),
      ),
  );

  servidor.registerPrompt(
    'ahorro_tributario',
    {
      title: 'Pagar menos impuestos, legalmente',
      description: 'Busca las oportunidades legales que sostienen los datos guardados y simula su efecto, con su norma oficial.',
      argsSchema: z.object({ rut: RUT }),
    },
    ({ rut }) =>
      mensaje(
        [
          `Revisa con mi-sii-mcp cómo ${rut} puede pagar menos impuestos de forma legal:`,
          '1. sii_panorama: si faltan el RCV o los F29 recientes, sincronizar antes.',
          '2. ahorro_oportunidades: explica cada una con su norma y el enlace oficial, el monto y qué hacer.',
          '3. Empresa: cierre_proyectar del año en curso y regimen_simular con los socios. Persona: renta_estimar con y sin APV régimen B o gastos efectivos.',
          'Ordena por monto y di qué datos faltan para confirmar cada una. Solo operaciones reales y con respaldo: nunca sugieras simular gastos, compras ni contratos.',
          presentaAsi('cada oportunidad: su norma, el monto estimado y qué hacer', `con tipo renta y rut ${rut}`),
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
          '2. A las que tengan F29 vencidos o por vencer, f29_estimar del mes; a las con F29 por confirmar, sincronizar ese mes; a las que tengan hallazgos críticos, iva_hallazgos.',
          '3. A las sin sesión, ofrece conectarlas con cuenta_conectar; a las con datos viejos, sincronizar el mes.',
          presentaAsi('una fila por cuenta, ordenada por urgencia: qué vence, cuánto pagar y el siguiente paso', 'con tipo cartera'),
        ].join('\n'),
      ),
  );
}
