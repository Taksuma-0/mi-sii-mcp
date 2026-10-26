// Proceso hijo de `ConsultaLibreSqlite`: abre en memoria la imagen de la copia curada y ejecuta una sola consulta de lectura.
// Corre aislado para que el padre pueda matarlo si la consulta no termina (SQLite viene sin callback de progreso).
// Autocontenido (solo módulos de Node y better-sqlite3) y con sintaxis TypeScript borrable: corre compilado desde `dist`
// y como `.ts` desde el código fuente.
import Database from 'better-sqlite3';

export interface LimitesHijo {
  readonly filas: number;
  readonly caracteres: number;
  readonly caracteresCelda: number;
}

export interface PedidoHijo {
  readonly imagen: Buffer;
  readonly sql: string;
  readonly limites: LimitesHijo;
}

export type RespuestaHijo =
  | { readonly ok: true; readonly columnas: string[]; readonly filas: unknown[][]; readonly truncado: boolean }
  | { readonly ok: false; readonly mensaje: string };

const MARCA_RECORTE = '…[recortado]';

function ejecutar({ imagen, sql, limites }: PedidoHijo): RespuestaHijo {
  try {
    const db = new Database(imagen);
    db.pragma('query_only = ON');
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
    // Sin `db.close()`: el padre mata este proceso apenas recibe la respuesta.
    return { ok: true, columnas, filas, truncado };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : String(e) };
  }
}

process.once('message', (mensaje) => {
  process.send?.(ejecutar(mensaje as PedidoHijo));
});
