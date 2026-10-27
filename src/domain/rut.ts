import { ErrorMiSiiMcp } from './errores.js';

export interface Rut {
  readonly cuerpo: number;
  readonly dv: string;
  /** Forma canónica `12345678-9`. */
  readonly canonico: string;
}

/** Dígito verificador módulo 11. */
export function calcularDv(cuerpo: number): string {
  let suma = 0;
  let multiplicador = 2;
  let n = cuerpo;
  while (n > 0) {
    suma += (n % 10) * multiplicador;
    n = Math.floor(n / 10);
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

export function parseRut(entrada: string): Rut {
  const limpio = entrada.replace(/[.\s-]/g, '').toUpperCase();
  if (!/^\d{1,9}[0-9K]$/.test(limpio)) {
    throw new ErrorMiSiiMcp('RUT_INVALIDO', `RUT inválido: "${entrada}"`);
  }
  const cuerpo = Number(limpio.slice(0, -1));
  const dv = limpio.slice(-1);
  if (cuerpo === 0 || calcularDv(cuerpo) !== dv) {
    throw new ErrorMiSiiMcp('RUT_INVALIDO', `Dígito verificador incorrecto: "${entrada}"`);
  }
  return { cuerpo, dv, canonico: `${cuerpo}-${dv}` };
}

/** `22.222.222-2` */
export function formatearRut(rut: Rut): string {
  return `${String(rut.cuerpo).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${rut.dv}`;
}
