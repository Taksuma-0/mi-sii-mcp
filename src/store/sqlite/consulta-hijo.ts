// Proceso hijo de `ConsultaLibreSqlite`: abre en memoria la imagen de la copia curada y ejecuta consultas de lectura.
// Corre aislado para que el padre pueda matarlo si una consulta no termina (SQLite viene sin callback de progreso).
// Atiende varias consultas: conserva la copia mientras su firma no cambie, así el padre no la reenvía cada vez.
// Autocontenido (solo módulos de Node y better-sqlite3) y con sintaxis TypeScript borrable: corre compilado desde `dist`
// y como `.ts` desde el código fuente.
import Database from 'better-sqlite3';

export interface LimitesHijo {
  readonly filas: number;
  readonly caracteres: number;
  readonly caracteresCelda: number;
}

export interface PedidoHijo {
  /** Identifica la copia (cambia cuando cambian los datos). */
  readonly firma: string;
  /** La copia serializada; solo viene cuando el hijo aún no tiene la de esta firma. */
  readonly imagen?: Buffer;
  readonly sql: string;
  readonly limites: LimitesHijo;
}

export type RespuestaHijo =
  | { readonly ok: true; readonly columnas: string[]; readonly filas: unknown[][]; readonly truncado: boolean }
  | { readonly ok: false; readonly mensaje: string };

const MARCA_RECORTE = '…[recortado]';

let copia: { readonly firma: string; readonly db: Database.Database } | null = null;

function baseDe(firma: string, imagen: Buffer | undefined): Database.Database | null {
  if (imagen) {
    copia?.db.close();
    const db = new Database(imagen);
    db.pragma('query_only = ON');
    copia = { firma, db };
  }
  return copia?.firma === firma ? copia.db : null;
}

function ejecutar({ firma, imagen, sql, limites }: PedidoHijo): RespuestaHijo {
  try {
    const db = baseDe(firma, imagen);
    if (!db) return { ok: false, mensaje: 'el proceso de consulta no tiene la copia de los datos; reintenta.' };
    const sentencia = db.prepare(sql);
    if (!sentencia.reader || !sentencia.readonly) {
      return { ok: false, mensaje: 'solo se permite una sentencia de lectura que devuelva filas.' };
    }
    const columnas = sentencia.columns().map((c) => c.name);
    const filas: unknown[][] = [];
    let truncado = false;
    let largo = 2; // `[]` del JSON compacto de las filas
    for (const cruda of sentencia.raw(true).iterate() as Iterable<unknown[]>) {
      if (filas.length >= limites.filas) {
        truncado = true;
        break;
      }
      const fila = cruda.map((valor) => {
        if (Buffer.isBuffer(valor)) {
          truncado = true;
          return `[blob de ${valor.length} bytes]`;
        }
        if (typeof valor === 'string' && valor.length > limites.caracteresCelda) {
          truncado = true;
          return valor.slice(0, limites.caracteresCelda) + MARCA_RECORTE;
        }
        return valor;
      });
      const extra = JSON.stringify(fila).length + (filas.length > 0 ? 1 : 0);
      if (largo + extra > limites.caracteres) {
        truncado = true;
        break;
      }
      largo += extra;
      filas.push(fila);
    }
    return { ok: true, columnas, filas, truncado };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : String(e) };
  }
}

process.on('message', (mensaje) => {
  process.send?.(ejecutar(mensaje as PedidoHijo));
});
