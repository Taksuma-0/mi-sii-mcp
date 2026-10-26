import type { ConsultaLibre, ConsultaSesiones, Reloj, SiiReader, Store, SumideroRespuestas } from '../ports/index.js';

export interface DepsApp {
  readonly store: Store;
  /** SQL libre de solo lectura sobre una copia curada de la base; la aplicación valida, el adaptador ejecuta aislado. */
  readonly consultaLibre: ConsultaLibre;
  /** Lector del SII con sesión activa para el RUT; cada respuesta cruda va al sumidero. */
  readonly abrirSii: (rut: string, sumidero: SumideroRespuestas) => Promise<SiiReader>;
  readonly sesiones: ConsultaSesiones;
  readonly reloj: Reloj;
  readonly toleranciaPesos: number;
  /** Guarda un archivo de diagnóstico cuando el portal cambió (PORTAL_CAMBIO). */
  readonly diagnostico?: (nombre: string, contenido: string) => void;
  /** Se llama al terminar una sincronización (para persistir cookies). */
  readonly alTerminarSync?: (rut: string) => void;
}
