import type { F29Valores } from '../domain/tipos.js';
import { formatearClp } from '../domain/formato.js';
import { CODIGO_F29, montoF29 } from './mapeo-f29.js';

/** Monto a pagar sin las condonaciones y rebajas que descuenta el 91 (779: reducción de la multa o del pago). */
const CODIGO_REBAJA_PAGO = '779';

/**
 * Autocontrol de un F29 leído: las relaciones que el formulario cumple siempre entre los totales y lo que arrastra o paga.
 * Devuelve las incoherencias en texto legible; vacío si cuadra o si no aplica (F29 no leído, o 538/537 sin dato). Un
 * código ausente en el PDF compacto vale 0 salvo el 91 y el 547, que solo se comparan si vienen ambos. Una incoherencia
 * suele indicar que el PDF se leyó mal o que el SII cambió el formulario.
 */
export function verificarCoherenciaF29(v: F29Valores | null): string[] {
  const debitos = montoF29(v, CODIGO_F29.TOTAL_DEBITOS);
  const creditos = montoF29(v, CODIGO_F29.TOTAL_CREDITOS);
  if (v === null || debitos === null || creditos === null) return [];
  const out: string[] = [];
  const clp = formatearClp;
  const valor = (codigo: string): number => v.valores[codigo] ?? 0;

  const determinado = Math.max(debitos - creditos, 0);
  if (valor(CODIGO_F29.IVA_DETERMINADO) !== determinado) {
    out.push(
      `el ${CODIGO_F29.IVA_DETERMINADO} (IVA determinado) es ${clp(valor(CODIGO_F29.IVA_DETERMINADO))} y debería ser ${clp(determinado)} (${CODIGO_F29.TOTAL_DEBITOS} menos ${CODIGO_F29.TOTAL_CREDITOS}, sin bajar de 0)`,
    );
  }

  const sobrante = Math.max(creditos - debitos, 0);
  const remanente = valor(CODIGO_F29.REMANENTE_PERIODO_SIGUIENTE);
  if (debitos >= creditos) {
    if (remanente !== 0) {
      out.push(`el ${CODIGO_F29.REMANENTE_PERIODO_SIGUIENTE} (remanente para el período siguiente) es ${clp(remanente)} pero el débito (${CODIGO_F29.TOTAL_DEBITOS}) no es menor que el crédito (${CODIGO_F29.TOTAL_CREDITOS}), así que debería ser 0`);
    }
  } else if (remanente > sobrante) {
    out.push(`el ${CODIGO_F29.REMANENTE_PERIODO_SIGUIENTE} (remanente para el período siguiente) es ${clp(remanente)} y no puede superar el crédito sobrante de ${clp(sobrante)}`);
  }

  const total = v.valores[CODIGO_F29.TOTAL_DETERMINADO];
  const aPagar = v.valores[CODIGO_F29.TOTAL_A_PAGAR];
  if (total !== undefined && aPagar !== undefined) {
    if (aPagar > total) {
      out.push(`el ${CODIGO_F29.TOTAL_A_PAGAR} (total a pagar) es ${clp(aPagar)} y supera el ${CODIGO_F29.TOTAL_DETERMINADO} (total determinado) de ${clp(total)}`);
    } else if (aPagar < total && valor(CODIGO_REBAJA_PAGO) <= 0) {
      out.push(`el ${CODIGO_F29.TOTAL_A_PAGAR} (total a pagar) es ${clp(aPagar)} y debería ser igual al ${CODIGO_F29.TOTAL_DETERMINADO} (total determinado) de ${clp(total)}`);
    }
  }
  return out;
}

/**
 * Una lectura del F29 es confiable si está leída, el autocontrol aplica (538 y 537 con dato según `montoF29`) y no tiene
 * incoherencias. `verificarCoherenciaF29` devuelve vacío también cuando no aplica: para decidir si una lectura puede
 * reemplazar a otra se usa esta función, no el vacío.
 */
export function lecturaConfiable(v: F29Valores | null): boolean {
  if (montoF29(v, CODIGO_F29.TOTAL_DEBITOS) === null || montoF29(v, CODIGO_F29.TOTAL_CREDITOS) === null) return false;
  return verificarCoherenciaF29(v).length === 0;
}

/** Por qué una lectura no es confiable, en texto; null si lo es. */
export function motivoNoConfiable(v: F29Valores | null): string | null {
  if (lecturaConfiable(v)) return null;
  const incoherencias = verificarCoherenciaF29(v);
  if (incoherencias.length > 0) return `no cuadra (${incoherencias.join('; ')})`;
  return `no trae el ${CODIGO_F29.TOTAL_DEBITOS} y el ${CODIGO_F29.TOTAL_CREDITOS} legibles para verificarla`;
}
