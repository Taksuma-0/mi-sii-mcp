import type { Hallazgo, Plazo, Severidad } from './tipos.js';

export type TipoAviso = 'hallazgo' | 'plazo' | 'renta' | 'sesion';

/** Algo que merece avisarse; `clave` lo identifica para no repetirlo aunque se vuelva a detectar cada día. */
export interface AvisoCandidato {
  readonly rut: string;
  readonly clave: string;
  readonly tipo: TipoAviso;
  readonly severidad: Severidad;
  readonly titulo: string;
  readonly detalle: string;
}

export interface Aviso extends AvisoCandidato {
  readonly id: number;
  readonly creadoEn: string;
  /** Cuándo se mostró en una notificación del sistema; null si aún no. */
  readonly notificadoEn: string | null;
  /** Cuándo lo vio la persona (en la página o con novedades); null si aún no. */
  readonly vistoEn: string | null;
}

/** Un hallazgo de la conciliación como aviso: su clave es la regla, el período y la primera evidencia. */
export const avisoDeHallazgo = (h: Hallazgo): AvisoCandidato => ({
  rut: h.rut,
  clave: `H:${h.regla}:${h.periodo}:${h.evidencia[0] ?? ''}`,
  tipo: 'hallazgo',
  severidad: h.severidad,
  titulo: `${h.titulo} (${h.periodo})`,
  detalle: h.detalle,
});

/** Un plazo como aviso: una vez cuando está por vencer y otra vez cuando vence. */
export const avisoDePlazo = (p: Plazo): AvisoCandidato => {
  const vencido = p.diasRestantes < 0;
  return {
    rut: p.rut,
    clave: `P:${p.tipo}:${p.referencia ?? p.vence}:${vencido ? 'vencido' : 'proximo'}`,
    tipo: 'plazo',
    severidad: vencido ? 'critico' : 'advertencia',
    titulo: p.descripcion,
    detalle: vencido ? `Venció el ${p.vence} (hace ${-p.diasRestantes} día(s)).` : `Vence el ${p.vence} (en ${p.diasRestantes} día(s)).`,
  };
};
