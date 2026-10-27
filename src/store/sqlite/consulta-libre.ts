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

/**
 * Ejecuta SQL libre de solo lectura sobre una copia curada en memoria, en un proceso hijo con plazo.
 * better-sqlite3 no puede interrumpir una consulta: solo matar el proceso detiene una que no termina.
 */
export class ConsultaLibreSqlite implements ConsultaLibre {
  private readonly hijos = new Set<ChildProcess>();

  /** `scriptHijo` solo se cambia en las pruebas, para simular un proceso hijo que muere. */
  constructor(
    private readonly db: Db,
    private readonly scriptHijo: string = SCRIPT_HIJO,
  ) {}

  get procesosActivos(): number {
    return this.hijos.size;
  }

  async consultar(sql: string, opciones: OpcionesConsulta): Promise<ResultadoConsulta> {
    const { filas, caracteres, caracteresCelda, milisegundos } = opciones.limites;
    const pedido: PedidoHijo = { imagen: this.imagenCopia(opciones.tiposNegativos), sql, limites: { filas, caracteres, caracteresCelda } };
    const respuesta = await this.enHijo(pedido, milisegundos);
    if (!respuesta.ok) throw new ErrorMiSiiMcp('CONSULTA_RECHAZADA', `Consulta rechazada: ${respuesta.mensaje}`);
    return { columnas: respuesta.columnas, filas: respuesta.filas, truncado: respuesta.truncado };
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

  /** Resuelve cuando el hijo ya terminó, para que `procesosActivos` nunca cuente procesos que siguen vivos. */
  private enHijo(pedido: PedidoHijo, milisegundos: number): Promise<RespuestaHijo> {
    return new Promise((resolver, rechazar) => {
      // stderr va por una tubería y nunca hacia la salida de este proceso: en el servidor MCP, stdout es el canal JSON-RPC.
      const hijo = fork(this.scriptHijo, [], { serialization: 'advanced', execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      this.hijos.add(hijo);
      HIJOS_VIVOS.add(hijo);
      let respuesta: RespuestaHijo | null = null;
      let vencido = false;
      let diagnostico = '';
      // Hay que consumir la tubería aunque solo se guarde el comienzo, o un hijo muy ruidoso se bloquearía al llenarla.
      hijo.stderr?.setEncoding('utf8');
      hijo.stderr?.on('data', (trozo: string) => {
        if (diagnostico.length <= MAX_DIAGNOSTICO) diagnostico += trozo;
      });
      const plazo = setTimeout(() => {
        vencido = true;
        hijo.kill();
      }, milisegundos);
      const terminar = (motivo: string, accion?: string): void => {
        clearTimeout(plazo);
        this.hijos.delete(hijo);
        HIJOS_VIVOS.delete(hijo);
        if (respuesta) resolver(respuesta);
        else rechazar(new ErrorMiSiiMcp('CONSULTA_INTERRUMPIDA', motivo, { accion }));
      };
      hijo.on('message', (mensaje) => {
        respuesta ??= mensaje as RespuestaHijo;
        hijo.kill();
      });
      hijo.on('error', (error) => {
        // Sin pid no hubo proceso. Un envío fallido termina en 'close' y un kill fallido no se reintenta.
        if (hijo.pid === undefined) terminar(`No se pudo iniciar el proceso de consulta: ${error.message}`, ACCION_FALLA_INTERNA);
      });
      hijo.on('close', (codigo, senal) => {
        if (vencido) {
          terminar(`La consulta superó el plazo de ${milisegundos} ms y se detuvo.`);
          return;
        }
        // Un hijo que muere sin responder (dist roto, módulo nativo que no carga) no es un problema de la consulta.
        const salida = diagnostico.trim();
        const detalle = salida === '' ? '' : ` Salida de error: ${salida.slice(0, MAX_DIAGNOSTICO)}${salida.length > MAX_DIAGNOSTICO ? '…' : ''}`;
        terminar(`El proceso de consulta terminó sin responder (${senal ?? `código ${codigo}`}).${detalle}`, ACCION_FALLA_INTERNA);
      });
      if (hijo.connected) hijo.send(pedido);
    });
  }
}
