import { createHash } from 'node:crypto';
import type { Perfil, RespuestaCruda, TipoContribuyente } from '../../domain/tipos.js';
import type { Db } from './db.js';

export const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex');

interface FilaContribuyente {
  rut: string;
  alias: string;
  tipo: TipoContribuyente;
  razon_social: string | null;
  representa_json: string;
}

const aPerfil = (f: FilaContribuyente): Perfil => ({
  rut: f.rut,
  alias: f.alias,
  tipo: f.tipo,
  razonSocial: f.razon_social,
  representa: JSON.parse(f.representa_json) as string[],
});

export class SqliteStore {
  constructor(private readonly db: Db) {}

  guardarContribuyente(perfil: Perfil): void {
    this.db
      .prepare(
        `INSERT INTO contribuyente (rut, alias, tipo, razon_social, representa_json)
         VALUES (@rut, @alias, @tipo, @razonSocial, @representa)
         ON CONFLICT (rut) DO UPDATE SET
           alias = excluded.alias,
           tipo = excluded.tipo,
           razon_social = COALESCE(excluded.razon_social, contribuyente.razon_social),
           representa_json = excluded.representa_json`,
      )
      .run({ rut: perfil.rut, alias: perfil.alias, tipo: perfil.tipo, razonSocial: perfil.razonSocial, representa: JSON.stringify(perfil.representa) });
  }

  contribuyente(rut: string): Perfil | null {
    const f = this.db.prepare('SELECT rut, alias, tipo, razon_social, representa_json FROM contribuyente WHERE rut = ?').get(rut) as FilaContribuyente | undefined;
    return f ? aPerfil(f) : null;
  }

  contribuyentes(): Perfil[] {
    return (this.db.prepare('SELECT rut, alias, tipo, razon_social, representa_json FROM contribuyente ORDER BY alias').all() as FilaContribuyente[]).map(aPerfil);
  }

  iniciarSincronizacion(rut: string, superficie: string, periodo: string, inicio: string): number {
    const r = this.db.prepare('INSERT INTO sincronizacion (rut, superficie, periodo, iniciado_en) VALUES (?, ?, ?, ?)').run(rut, superficie, periodo, inicio);
    return Number(r.lastInsertRowid);
  }

  terminarSincronizacion(id: number, fin: string, estado: 'ok' | 'error', error?: { codigo: string; detalle: string }): void {
    this.db
      .prepare('UPDATE sincronizacion SET terminado_en = ?, estado = ?, error_codigo = ?, error_detalle = ? WHERE id = ?')
      .run(fin, estado, error?.codigo ?? null, error?.detalle ?? null, id);
  }

  guardarRespuestaCruda(sincronizacionId: number, respuesta: RespuestaCruda): void {
    this.db
      .prepare('INSERT INTO respuesta_cruda (sincronizacion_id, superficie, parametros_json, cuerpo, sha256, obtenido_en) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sincronizacionId, respuesta.superficie, JSON.stringify(respuesta.parametros), respuesta.cuerpo, sha256(respuesta.cuerpo), respuesta.obtenidoEn);
  }
}
