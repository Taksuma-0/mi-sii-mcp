import type { Db } from '../../src/store/sqlite/db.js';

/** Cuenta resultados de lecturas reales, sin sustituir lo que devuelve SQLite. */
export function medirLecturas(db: Db) {
  const lecturas: { sql: string; filas: number }[] = [];
  const instrumentada = new Proxy(db, {
    get(target, propiedad) {
      if (propiedad === 'prepare') return (sql: string) => {
        const sentencia = target.prepare(sql);
        return new Proxy(sentencia, {
          get(statement, metodo) {
            const valor = Reflect.get(statement, metodo, statement) as unknown;
            if (typeof valor !== 'function') return valor;
            return (...parametros: unknown[]) => {
              const resultado: unknown = Reflect.apply(valor, statement, parametros);
              if (/^\s*SELECT\b/i.test(sql) && (metodo === 'all' || metodo === 'get')) {
                lecturas.push({ sql, filas: Array.isArray(resultado) ? resultado.length : resultado === undefined ? 0 : 1 });
              }
              return resultado;
            };
          },
        });
      };
      const valor = Reflect.get(target, propiedad, target) as unknown;
      return typeof valor === 'function' ? valor.bind(target) : valor;
    },
  });
  return { db: instrumentada, lecturas };
}
