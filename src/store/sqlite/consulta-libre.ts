import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorMiSiiMcp } from '../../domain/errores.js';
import type { ConsultaLibre, OpcionesConsulta, ResultadoConsulta } from '../../ports/index.js';
import type { PedidoHijo, RespuestaHijo } from './consulta-hijo.js';
import type { Db } from './db.js';

/** Base adjunta donde se arma la copia; existe solo mientras se construye la imagen. */
const COPIA = 'copia_consulta';

/**
 * Lo único que llega a la copia. Nunca `respuesta_cruda` ni `sincronizacion.error_detalle` (pueden traer tokens
 * de sesión), ni `rcv_documento_snapshot` ni `migracion`.
 */
const tablasCopia = (signo: string): readonly string[] => [
  'contribuyente AS SELECT * FROM main.contribuyente',
  `rcv_resumen AS SELECT *, ${signo} AS signo FROM main.rcv_resumen`,
  `rcv_documento AS SELECT *, ${signo} AS signo FROM main.rcv_documento`,
  'contribuyente_tributario AS SELECT * FROM main.contribuyente_tributario',
  'sii_empresa_autorizada AS SELECT * FROM main.sii_empresa_autorizada',
  'f22_declaracion AS SELECT * FROM main.f22_declaracion',
  'f22_valor AS SELECT * FROM main.f22_valor',
  'f22_observacion AS SELECT * FROM main.f22_observacion',
  'f22_evento AS SELECT * FROM main.f22_evento',
  'f29_declaracion AS SELECT * FROM main.f29_declaracion',
  'f29_valor AS SELECT * FROM main.f29_valor',
  'f29_lectura AS SELECT * FROM main.f29_lectura',
  'f29_propuesta AS SELECT * FROM main.f29_propuesta',
  'f29_propuesta_valor AS SELECT * FROM main.f29_propuesta_valor',
  'bhe_recibida AS SELECT * FROM main.bhe_recibida',
  'bhe_emitida_mes AS SELECT * FROM main.bhe_emitida_mes',
  'bhe_emitida AS SELECT * FROM main.bhe_emitida',
  'dj_tercero AS SELECT * FROM main.dj_tercero',
  'asistente_f22 AS SELECT * FROM main.asistente_f22',
  'banco_importacion AS SELECT * FROM main.banco_importacion',
  'banco_movimiento AS SELECT * FROM main.banco_movimiento',
  'conciliacion_bancaria AS SELECT * FROM main.conciliacion_bancaria',
  'cuenta_contable AS SELECT * FROM main.cuenta_contable',
  'regla_cuenta AS SELECT * FROM main.regla_cuenta',
  'hallazgo AS SELECT * FROM main.hallazgo',
  'sincronizacion AS SELECT id, rut, superficie, periodo, iniciado_en, terminado_en, estado, error_codigo FROM main.sincronizacion',
];

/** El hijo corre compilado junto a este módulo en `dist` y como `.ts` desde el código fuente. */
const SCRIPT_HIJO = ((): string => {
  const js = join(import.meta.dirname, 'consulta-hijo.js');
  return existsSync(js) ? js : join(import.meta.dirname, 'consulta-hijo.ts');
})();

/** Lo que se conserva de la salida de error de un hijo caído: el comienzo basta para ver el motivo. */
const MAX_DIAGNOSTICO = 500;
const ACCION_FALLA_INTERNA = 'Falla interna del proceso de consulta: recompila con `npm.cmd run build` o reinstala dependencias; no es un problema de la consulta.';

/** Hijos vivos de todas las instancias: si este proceso termina, no deben quedar consultas corriendo. */
const HIJOS_VIVOS = new Set<ChildProcess>();
process.on('exit', () => {
  for (const hijo of HIJOS_VIVOS) hijo.kill();
});


/** Segundos que un proceso de consulta espera la siguiente antes de cerrarse. */
const ESPERA_HIJO_MS = 60_000;

/** Un proceso de consulta: lo que tiene cargado, si atiende una consulta y cómo avisar su respuesta o su caída. */
interface Hijo {
  readonly proceso: ChildProcess;
  /** Firma de la copia que ya tiene cargada; null si aún ninguna. */
  firma: string | null;
  diagnostico: string;
  cierre: NodeJS.Timeout | null;
  esperando: { readonly respuesta: (r: RespuestaHijo) => void; readonly caida: (motivo: string, accion?: string) => void } | null;
  /** Plazo (ms) que venció en la consulta en curso; null si no venció. */
  vencido: number | null;
}

/**
 * Ejecuta SQL libre de solo lectura sobre una copia curada en memoria, en un proceso hijo con plazo.
 * better-sqlite3 no puede interrumpir una consulta: solo matar el proceso detiene una que no termina.
 * Para responder rápido, la copia se arma una vez por versión de los datos y un proceso queda esperando la siguiente
 * consulta (se cierra solo tras un minuto sin uso); una consulta en paralelo usa un proceso extra que se cierra al terminar.
 */
export class ConsultaLibreSqlite implements ConsultaLibre {
  private enCurso = 0;
  private creados = 0;
  private enEspera: Hijo | null = null;
  private copia: { readonly firma: string; readonly imagen: Buffer } | null = null;

  /** `scriptHijo` solo se cambia en las pruebas, para simular un proceso hijo que muere. */
  constructor(
    private readonly db: Db,
    private readonly scriptHijo: string = SCRIPT_HIJO,
  ) {}

  /** Consultas en curso (sus procesos están trabajando). */
  get procesosActivos(): number {
    return this.enCurso;
  }

  /** Procesos creados desde el inicio (para comprobar que se reutilizan). */
  get procesosCreados(): number {
    return this.creados;
  }

  /** Procesos vivos esperando la siguiente consulta (0 o 1). */
  get procesosEnEspera(): number {
    return this.enEspera === null ? 0 : 1;
  }

  /** Cierra el proceso que espera; las consultas siguientes abren uno nuevo. */
  cerrar(): void {
    const hijo = this.enEspera;
    this.enEspera = null;
    if (hijo) this.terminarHijo(hijo);
  }

  async consultar(sql: string, opciones: OpcionesConsulta): Promise<ResultadoConsulta> {
    const { filas, caracteres, caracteresCelda, milisegundos } = opciones.limites;
    const { firma, imagen } = this.copiaVigente(opciones.tiposNegativos);
    const hijo = this.tomarHijo();
    this.enCurso += 1;
    try {
      const pedido: PedidoHijo = { firma, ...(hijo.firma === firma ? {} : { imagen }), sql, limites: { filas, caracteres, caracteresCelda } };
      const respuesta = await this.enviar(hijo, pedido, milisegundos);
      hijo.firma = firma;
      this.devolver(hijo);
      if (!respuesta.ok) throw new ErrorMiSiiMcp('CONSULTA_RECHAZADA', `Consulta rechazada: ${respuesta.mensaje}`);
      return { columnas: respuesta.columnas, filas: respuesta.filas, truncado: respuesta.truncado };
    } finally {
      this.enCurso -= 1;
    }
  }

  /**
   * La copia de los datos, armada solo si cambiaron desde la última: `data_version` cambia cuando otro proceso escribe
   * la base y `total_changes()` cuando escribe esta conexión. La firma se toma después de armar la copia, porque armarla
   * también cuenta como cambios de esta conexión.
   */
  private copiaVigente(tiposNegativos: readonly number[]): { readonly firma: string; readonly imagen: Buffer } {
    const firmaActual = (): string => `${String(this.db.pragma('data_version', { simple: true }))}:${String(this.db.prepare('SELECT total_changes()').pluck().get())}:${tiposNegativos.join(',')}`;
    if (this.copia?.firma === firmaActual()) return this.copia;
    const imagen = this.imagenCopia(tiposNegativos);
    this.copia = { firma: firmaActual(), imagen };
    return this.copia;
  }

  /** Arma la copia desde cero en una base `:memory:` adjunta y la serializa; nunca serializa la base real (puede estar en WAL). */
  private imagenCopia(tiposNegativos: readonly number[]): Buffer {
    if (!tiposNegativos.every(Number.isSafeInteger)) throw new TypeError('tiposNegativos debe contener solo enteros.');
    const signo = `CASE WHEN tipo_doc IN (${tiposNegativos.join(', ')}) THEN -1 ELSE 1 END`;
    this.db.exec(`ATTACH DATABASE ':memory:' AS ${COPIA}`);
    try {
      // Una sola transacción: todas las tablas salen de la misma foto aunque otro proceso esté sincronizando.
      this.db.transaction(() => {
        for (const tabla of tablasCopia(signo)) this.db.exec(`CREATE TABLE ${COPIA}.${tabla}`);
      })();
      return this.db.serialize({ attached: COPIA });
    } finally {
      this.db.exec(`DETACH DATABASE ${COPIA}`);
    }
  }

  /** El proceso que espera, si sigue vivo; si no, uno nuevo. */
  private tomarHijo(): Hijo {
    const hijo = this.enEspera;
    this.enEspera = null;
    if (hijo && hijo.proceso.connected && hijo.proceso.exitCode === null) {
      if (hijo.cierre) clearTimeout(hijo.cierre);
      hijo.cierre = null;
      hijo.proceso.ref();
      hijo.proceso.channel?.ref();
      return hijo;
    }
    return this.crearHijo();
  }

  /** Tras una consulta respondida: queda esperando la siguiente si no hay otro esperando; si lo hay, se cierra. */
  private devolver(hijo: Hijo): void {
    if (this.enEspera !== null || !hijo.proceso.connected) {
      this.terminarHijo(hijo);
      return;
    }
    this.enEspera = hijo;
    // Esperando no debe mantener vivo a este proceso (ni el proceso ni su canal).
    hijo.proceso.unref();
    hijo.proceso.channel?.unref();
    hijo.cierre = setTimeout(() => {
      if (this.enEspera === hijo) this.cerrar();
    }, ESPERA_HIJO_MS);
    hijo.cierre.unref();
  }

  private terminarHijo(hijo: Hijo): void {
    if (hijo.cierre) clearTimeout(hijo.cierre);
    hijo.cierre = null;
    hijo.proceso.kill();
  }

  private crearHijo(): Hijo {
    // stderr va por una tubería y nunca hacia la salida de este proceso: en el servidor MCP, stdout es el canal JSON-RPC.
    const proceso = fork(this.scriptHijo, [], { serialization: 'advanced', execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    this.creados += 1;
    HIJOS_VIVOS.add(proceso);
    const hijo: Hijo = { proceso, firma: null, diagnostico: '', cierre: null, esperando: null, vencido: null };
    // Hay que consumir la tubería aunque solo se guarde el comienzo, o un hijo muy ruidoso se bloquearía al llenarla.
    proceso.stderr?.setEncoding('utf8');
    proceso.stderr?.on('data', (trozo: string) => {
      if (hijo.diagnostico.length <= MAX_DIAGNOSTICO) hijo.diagnostico += trozo;
    });
    proceso.on('message', (mensaje) => {
      const esperando = hijo.esperando;
      hijo.esperando = null;
      esperando?.respuesta(mensaje as RespuestaHijo);
    });
    proceso.on('error', (error) => {
      // Sin pid no hubo proceso. Un envío fallido termina en 'close' y un kill fallido no se reintenta.
      if (proceso.pid !== undefined) return;
      HIJOS_VIVOS.delete(proceso);
      const esperando = hijo.esperando;
      hijo.esperando = null;
      esperando?.caida(`No se pudo iniciar el proceso de consulta: ${error.message}`, ACCION_FALLA_INTERNA);
    });
    proceso.on('close', (codigo, senal) => {
      HIJOS_VIVOS.delete(proceso);
      if (hijo.cierre) clearTimeout(hijo.cierre);
      if (this.enEspera === hijo) this.enEspera = null;
      const esperando = hijo.esperando;
      hijo.esperando = null;
      if (!esperando) return;
      if (hijo.vencido !== null) {
        esperando.caida(`La consulta superó el plazo de ${hijo.vencido} ms y se detuvo.`);
        return;
      }
      // Un hijo que muere sin responder (dist roto, módulo nativo que no carga) no es un problema de la consulta.
      const salida = hijo.diagnostico.trim();
      const detalle = salida === '' ? '' : ` Salida de error: ${salida.slice(0, MAX_DIAGNOSTICO)}${salida.length > MAX_DIAGNOSTICO ? '…' : ''}`;
      esperando.caida(`El proceso de consulta terminó sin responder (${senal ?? `código ${codigo}`}).${detalle}`, ACCION_FALLA_INTERNA);
    });
    return hijo;
  }

  /** Envía el pedido y espera la respuesta; si vence el plazo, mata el proceso y la consulta falla al cerrarse este. */
  private enviar(hijo: Hijo, pedido: PedidoHijo, milisegundos: number): Promise<RespuestaHijo> {
    return new Promise((resolver, rechazar) => {
      const plazo = setTimeout(() => {
        hijo.vencido = milisegundos;
        hijo.proceso.kill();
      }, milisegundos);
      hijo.esperando = {
        respuesta: (r) => {
          clearTimeout(plazo);
          resolver(r);
        },
        caida: (motivo, accion) => {
          clearTimeout(plazo);
          rechazar(new ErrorMiSiiMcp('CONSULTA_INTERRUMPIDA', motivo, accion ? { accion } : {}));
        },
      };
      if (hijo.proceso.connected) hijo.proceso.send(pedido);
    });
  }
}
