import type { MovimientoBancario, ParConciliado, TipoPartida } from '../domain/banco.js';
import { diasEntre } from '../domain/fechas.js';

/**
 * Algo que debería verse en el banco: una factura, una boleta, un F29 pagado o una devolución del F22, con el monto con el
 * signo que tendría en la cartola (+ abono, − cargo) y la fecha desde la que se espera.
 */
export interface Partida {
  readonly tipo: TipoPartida;
  readonly clave: string;
  readonly rutContraparte: string | null;
  readonly nombre: string | null;
  readonly fecha: string;
  readonly monto: number;
}

export interface ResultadoConciliacionBanco {
  /** Pares automáticos nuevos (los fijados a mano no se repiten aquí). */
  readonly pares: readonly ParConciliado[];
  /** Huellas de movimientos sin partida, por fecha; los descartados a mano no cuentan. */
  readonly movimientosSinPar: readonly string[];
  /** Claves de partidas sin movimiento, por fecha. */
  readonly partidasSinPar: readonly string[];
}

/** Días que el movimiento puede ir antes y después de la partida: una factura se paga hasta meses después; un impuesto, al declarar. */
const VENTANA: Readonly<Record<'documento' | 'impuesto', readonly [number, number]>> = { documento: [-5, 120], impuesto: [-3, 10] };
const ventanaDe = (tipo: TipoPartida): readonly [number, number] => (tipo === 'f29' || tipo === 'f22' ? VENTANA.impuesto : VENTANA.documento);

/** El cuerpo del RUT (sin DV) aparece en la glosa, con o sin puntos, sin ser parte de otro número. */
function glosaTraeRut(descripcion: string, rut: string | null): boolean {
  const cuerpo = rut?.split('-')[0]?.replace(/\./g, '');
  if (!cuerpo) return false;
  return new RegExp(`(^|\\D)${cuerpo}(\\D|$)`).test(descripcion.replace(/\./g, ''));
}

const porFechaYClave = (a: Partida, b: Partida): number => a.fecha.localeCompare(b.fecha) || a.clave.localeCompare(b.clave);

/**
 * Concilia movimientos bancarios con partidas: mismo monto exacto, con el movimiento dentro de la ventana de la partida.
 * Primero empareja los que traen el RUT de la contraparte en la glosa; después, por la fecha más cercana. Es uno a uno y
 * determinista (partidas por fecha y clave, movimientos por fecha y huella). Lo fijado a mano se respeta: esos movimientos
 * y partidas no se vuelven a emparejar.
 */
export function conciliarBanco(movimientos: readonly MovimientoBancario[], partidas: readonly Partida[], fijados: readonly ParConciliado[]): ResultadoConciliacionBanco {
  const movsFijados = new Set(fijados.map((f) => f.huella));
  const partidasFijadas = new Set(fijados.flatMap((f) => (f.clave === null ? [] : [f.clave])));
  const libres = [...movimientos].filter((m) => !movsFijados.has(m.huella)).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.huella.localeCompare(b.huella));
  const pendientes = [...partidas].filter((p) => !partidasFijadas.has(p.clave)).sort(porFechaYClave);
  const usados = new Set<string>();
  const pares = new Map<string, ParConciliado>();

  const candidatos = (p: Partida): { mov: MovimientoBancario; dias: number }[] => {
    const [antes, despues] = ventanaDe(p.tipo);
    return libres
      .filter((m) => !usados.has(m.huella) && m.monto === p.monto)
      .map((mov) => ({ mov, dias: diasEntre(p.fecha, mov.fecha) }))
      .filter(({ dias }) => dias >= antes && dias <= despues);
  };
  const emparejar = (p: Partida, mov: MovimientoBancario, dias: number, criterio: ParConciliado['criterio']): void => {
    usados.add(mov.huella);
    pares.set(p.clave, { huella: mov.huella, tipo: p.tipo, clave: p.clave, criterio, dias });
  };

  for (const p of pendientes) {
    const conRut = candidatos(p).filter(({ mov }) => glosaTraeRut(mov.descripcion, p.rutContraparte));
    const mejor = conRut.sort((a, b) => Math.abs(a.dias) - Math.abs(b.dias))[0];
    if (mejor) emparejar(p, mejor.mov, mejor.dias, 'monto_rut');
  }
  for (const p of pendientes) {
    if (pares.has(p.clave)) continue;
    // Entre dos igual de cerca gana el movimiento más antiguo: `libres` ya va por fecha y huella y el orden es estable.
    const mejor = candidatos(p).sort((a, b) => Math.abs(a.dias) - Math.abs(b.dias))[0];
    if (mejor) emparejar(p, mejor.mov, mejor.dias, 'monto_fecha');
  }

  return {
    pares: pendientes.flatMap((p) => pares.get(p.clave) ?? []),
    movimientosSinPar: libres.filter((m) => !usados.has(m.huella)).map((m) => m.huella),
    partidasSinPar: pendientes.filter((p) => !pares.has(p.clave)).map((p) => p.clave),
  };
}
