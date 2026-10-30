import { PLAN_CUENTAS_BASE, type CuentaContable, type TipoCuenta } from '../domain/contabilidad.js';
import { ErrorMiSiiMcp } from '../domain/errores.js';
import { parseRut } from '../domain/rut.js';
import { perfilExistente } from './consultas.js';
import type { DepsApp } from './deps.js';

export interface CuentaDelPlan extends CuentaContable {
  /** La sumó o la renombró el contribuyente; si no, es del plan base. */
  readonly propia: boolean;
}

export interface VistaCuentas {
  readonly rut: string;
  readonly cuentas: readonly CuentaDelPlan[];
  readonly reglas: readonly { readonly rutContraparte: string; readonly cuenta: string; readonly nombreCuenta: string | null }[];
}

const TIPOS: readonly TipoCuenta[] = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto'];
/** A un proveedor solo se le puede asignar una cuenta donde quepa una compra: un gasto o un activo. */
const TIPOS_DE_COMPRA: ReadonlySet<TipoCuenta> = new Set(['gasto', 'activo']);

/** El plan de cuentas del contribuyente: el base con sus cuentas propias encima, por código. */
export function planDeCuentas(deps: DepsApp, rut: string): CuentaDelPlan[] {
  const porCodigo = new Map<string, CuentaDelPlan>(PLAN_CUENTAS_BASE.map((c) => [c.codigo, { ...c, propia: false }]));
  for (const c of deps.store.cuentasPropias(rut)) porCodigo.set(c.codigo, { ...c, propia: true });
  return [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/** Reglas de clasificación de compras del contribuyente: RUT del proveedor → código de cuenta. */
export const reglasDe = (deps: DepsApp, rut: string): Map<string, string> => new Map(deps.store.reglasCuenta(rut).map((r) => [r.rutContraparte, r.cuenta]));

export function vistaCuentas(deps: DepsApp, rutTexto: string): VistaCuentas {
  const perfil = perfilExistente(deps, rutTexto);
  const cuentas = planDeCuentas(deps, perfil.rut);
  const nombre = new Map(cuentas.map((c) => [c.codigo, c.nombre]));
  return { rut: perfil.rut, cuentas, reglas: deps.store.reglasCuenta(perfil.rut).map((r) => ({ ...r, nombreCuenta: nombre.get(r.cuenta) ?? null })) };
}

/** Suma una cuenta al plan del contribuyente, o renombra una existente con el mismo código. */
export function crearCuenta(deps: DepsApp, rutTexto: string, cuenta: CuentaContable): void {
  const perfil = perfilExistente(deps, rutTexto);
  const nombre = cuenta.nombre.trim();
  if (!/^\d{3,6}$/.test(cuenta.codigo)) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'El código de la cuenta va con 3 a 6 dígitos (p. ej. 5210).');
  if (nombre.length < 1 || nombre.length > 80) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', 'El nombre de la cuenta va con 1 a 80 caracteres.');
  if (!TIPOS.includes(cuenta.tipo)) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', `El tipo de la cuenta es uno de: ${TIPOS.join(', ')}.`);
  deps.store.guardarCuentaPropia(perfil.rut, { codigo: cuenta.codigo, nombre, tipo: cuenta.tipo });
}

/** Clasifica las compras de un proveedor en una cuenta de gasto o de activo; con null quita la regla. */
export function asignarCuenta(deps: DepsApp, rutTexto: string, rutContraparteTexto: string, cuenta: string | null): void {
  const perfil = perfilExistente(deps, rutTexto);
  const rutContraparte = parseRut(rutContraparteTexto).canonico;
  if (cuenta !== null) {
    const destino = planDeCuentas(deps, perfil.rut).find((c) => c.codigo === cuenta);
    if (!destino) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', `La cuenta ${cuenta} no está en el plan: créala primero.`);
    if (!TIPOS_DE_COMPRA.has(destino.tipo)) throw new ErrorMiSiiMcp('PARAMETROS_INVALIDOS', `La cuenta ${cuenta} es de ${destino.tipo}: una compra va a una cuenta de gasto o de activo.`);
  }
  deps.store.guardarReglaCuenta(perfil.rut, rutContraparte, cuenta);
}
