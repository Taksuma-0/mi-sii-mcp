import type { ArchivosLocales, ConsultaLibre, ConsultaSesiones, FuenteVersiones, LectorCartola, LectorPdfF29, Reloj, Respaldos, SiiReader, Store, SumideroRespuestas } from '../ports/index.js';

export interface DepsApp {
  readonly store: Store;
  /** SQL libre de solo lectura sobre una copia curada de la base; la aplicación valida, el adaptador ejecuta aislado. */
  readonly consultaLibre: ConsultaLibre;
  /**
   * Lector del SII con sesión activa para el RUT; cada respuesta cruda va al sumidero. `signal` corta las consultas en
   * curso del lector al cancelarse.
   */
  readonly abrirSii: (rut: string, sumidero: SumideroRespuestas, signal?: AbortSignal) => Promise<SiiReader>;
  /** Lector del PDF compacto del F29: el mismo que usa `abrirSii`, para comparar versiones y releer lo guardado. */
  readonly lectorPdfF29: LectorPdfF29;
  readonly sesiones: ConsultaSesiones;
  /** Archivos del equipo: cartolas que indica la persona y exportaciones de libros y asientos. */
  readonly archivos: ArchivosLocales;
  readonly lectorCartola: LectorCartola;
  readonly reloj: Reloj;
  readonly toleranciaPesos: number;
  /** Guarda un archivo de diagnóstico cuando el portal cambió (PORTAL_CAMBIO). */
  readonly diagnostico?: (nombre: string, contenido: string) => void;
  /** Se llama al terminar una sincronización (para persistir cookies). */
  readonly alTerminarSync?: (rut: string) => void;
  /**
   * Vuelve a entrar con la clave guardada en el llavero cuando el SII da la sesión por vencida a mitad de una
   * sincronización; false si no hay clave guardada. Nunca pide una clave.
   */
  readonly renovarSesion?: (rut: string) => Promise<boolean>;
  /** Respaldo diario rotativo de la base (lo usa el mantenimiento de la revisión diaria). */
  readonly respaldos?: Respaldos;
  /** Última versión publicada de mi-sii-mcp, para avisar que hay una nueva; ausente si se apagó el aviso. */
  readonly versiones?: FuenteVersiones;
  /** Versión que está corriendo. */
  readonly versionActual?: string;
}
