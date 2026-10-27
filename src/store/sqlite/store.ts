import { createHash } from 'node:crypto';
import {
  claveDocumento,
  type BoletaHonorarios,
  type DisponibilidadFuentes,
  type DocumentoRcv,
  type EstadoRcv,
  type F29Declaracion,
  type F29Valores,
  type Hallazgo,
  type Lado,
  type LecturaF29,
  type LecturaFolioF29,
  type Naturaleza,
  type OrigenLecturaF29,
  type Perfil,
  type PropuestaF29,
  type RcvResumen,
  type RcvResumenFila,
  type RespuestaCruda,
  type Severidad,
  type SnapshotRcv,
  type TipoContribuyente,
  type TotalesBheMes,
} from '../../domain/tipos.js';
import type { DocumentosPaginados, FiltroDocumentos, FiltroHallazgos, Frescura, HallazgoGuardado, LecturaF29Guardada, PdfF29Guardado, Store } from '../../ports/index.js';
import type { Db } from './db.js';

export const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex');

/** Huella estable de un documento: solo campos con significado tributario, en orden fijo. */
export const huellaDocumento = (d: DocumentoRcv): string =>
  sha256(
    [
      d.estado,
      d.tipoDoc,
      d.rutContraparte,
      d.folio,
      d.fechaEmision ?? '',
      d.montoExento,
      d.montoNeto,
      d.montoIva,
      d.montoIvaNoRecuperable,
      d.montoIvaUsoComun,
      d.montoTotal,
    ].join('|'),
  );

interface FilaContribuyente {
  rut: string;
  alias: string;
  tipo: TipoContribuyente;
  razon_social: string | null;
  representa_json: string;
}
interface FilaBhe {
  rut_emisor: string;
  folio: number;
  nombre_emisor: string | null;
  fecha: string | null;
  bruto: number;
  retencion: number;
  liquido: number;
  sociedad_profesional: number;
  anulada: number;
  fecha_anulacion: string | null;
}
interface FilaResumen {
  lado: Lado;
  estado_rcv: EstadoRcv;
  tipo_doc: number;
  descripcion: string | null;
  cantidad: number;
  exento: number;
  neto: number;
  iva: number;
  total: number;
}
interface FilaDocumento {
  rut: string;
  periodo: string;
  lado: Lado;
  estado_rcv: EstadoRcv;
  tipo_doc: number;
  rut_contraparte: string;
  folio: number;
  razon_social: string | null;
  fecha_emision: string | null;
  fecha_recepcion: string | null;
  fecha_acuse: string | null;
  monto_exento: number;
  monto_neto: number;
  monto_iva: number;
  monto_iva_no_recuperable: number;
  monto_iva_uso_comun: number;
  monto_total: number;
  tipo_compra: string | null;
  evento_receptor: string | null;
}
interface FilaDeclaracion {
  rut: string;
  periodo: string;
  folio: number;
  estado: string;
  estado_id: number | null;
  fecha_presentacion: string | null;
  codigo_interno: number | null;
  total_a_pagar: number | null;
}
interface FilaHallazgo {
  rut: string;
  periodo: string;
  regla: string;
  severidad: Severidad;
  naturaleza: Naturaleza;
  titulo: string;
  detalle: string;
  datos_json: string;
  version_reglas: string;
  calculado_en: string;
}

const aPerfil = (f: FilaContribuyente): Perfil => ({
  rut: f.rut,
  alias: f.alias,
  tipo: f.tipo,
  razonSocial: f.razon_social,
  representa: JSON.parse(f.representa_json) as string[],
});

const aDocumento = (f: FilaDocumento): DocumentoRcv => ({
  rut: f.rut,
  periodo: f.periodo,
  lado: f.lado,
  estado: f.estado_rcv,
  tipoDoc: f.tipo_doc,
  rutContraparte: f.rut_contraparte,
  folio: f.folio,
  razonSocial: f.razon_social,
  fechaEmision: f.fecha_emision,
  fechaRecepcion: f.fecha_recepcion,
  fechaAcuse: f.fecha_acuse,
  montoExento: f.monto_exento,
  montoNeto: f.monto_neto,
  montoIva: f.monto_iva,
  montoIvaNoRecuperable: f.monto_iva_no_recuperable,
  montoIvaUsoComun: f.monto_iva_uso_comun,
  montoTotal: f.monto_total,
  tipoCompra: f.tipo_compra,
  eventoReceptor: f.evento_receptor,
});

const aDeclaracion = (f: FilaDeclaracion): F29Declaracion => ({
  rut: f.rut,
  periodo: f.periodo,
  folio: f.folio,
  estado: f.estado,
  estadoId: f.estado_id,
  fechaPresentacion: f.fecha_presentacion,
  codigoInterno: f.codigo_interno,
  totalAPagar: f.total_a_pagar,
});

const ORDEN_DOCUMENTOS = 'lado, tipo_doc, folio, estado_rcv, rut_contraparte';

function condicionesDocumentos(rut: string, periodo: string, filtro: FiltroDocumentos) {
  const condiciones = ['rut = @rut', 'periodo = @periodo'];
  const parametros: Record<string, unknown> = { rut, periodo };
  if (filtro.lado) {
    condiciones.push('lado = @lado');
    parametros['lado'] = filtro.lado;
  }
  if (filtro.estado) {
    condiciones.push('estado_rcv = @estado');
    parametros['estado'] = filtro.estado;
  }
  if (filtro.tipoDoc !== undefined) {
    condiciones.push('tipo_doc = @tipoDoc');
    parametros['tipoDoc'] = filtro.tipoDoc;
  }
  if (filtro.rutContraparte) {
    condiciones.push('rut_contraparte = @rutContraparte');
    parametros['rutContraparte'] = filtro.rutContraparte;
  }
  return { condiciones: condiciones.join(' AND '), parametros };
}

export class SqliteStore implements Store {
  constructor(private readonly db: Db) {}

  // --- contribuyentes ------------------------------------------------------------------
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

  // --- sincronizaciones y evidencia -----------------------------------------------------
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

  // --- RCV --------------------------------------------------------------------------------
  reemplazarRcv(
    sincronizacionId: number,
    rut: string,
    periodo: string,
    lado: Lado,
    resumenes: readonly RcvResumen[],
    documentos: readonly DocumentoRcv[],
    obtenidoEn: string,
  ): void {
    const insResumen = this.db.prepare(
      `INSERT OR REPLACE INTO rcv_resumen (rut, periodo, lado, estado_rcv, tipo_doc, descripcion, cantidad, exento, neto, iva, total, sincronizacion_id, obtenido_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insDocumento = this.db.prepare(
      `INSERT OR REPLACE INTO rcv_documento (rut, periodo, lado, estado_rcv, tipo_doc, rut_contraparte, folio, razon_social, fecha_emision, fecha_recepcion, fecha_acuse,
         monto_exento, monto_neto, monto_iva, monto_iva_no_recuperable, monto_iva_uso_comun, monto_total, tipo_compra, evento_receptor, sincronizacion_id, obtenido_en)
       VALUES (@rut, @periodo, @lado, @estado, @tipoDoc, @rutContraparte, @folio, @razonSocial, @fechaEmision, @fechaRecepcion, @fechaAcuse,
         @montoExento, @montoNeto, @montoIva, @montoIvaNoRecuperable, @montoIvaUsoComun, @montoTotal, @tipoCompra, @eventoReceptor, @sincronizacionId, @obtenidoEn)`,
    );
    const insSnapshot = this.db.prepare(
      'INSERT OR REPLACE INTO rcv_documento_snapshot (sincronizacion_id, rut, periodo, clave_doc, estado_rcv, sha256_fila) VALUES (?, ?, ?, ?, ?, ?)',
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM rcv_resumen WHERE rut = ? AND periodo = ? AND lado = ?').run(rut, periodo, lado);
      this.db.prepare('DELETE FROM rcv_documento WHERE rut = ? AND periodo = ? AND lado = ?').run(rut, periodo, lado);
      for (const r of resumenes) {
        for (const f of r.filas) {
          insResumen.run(rut, periodo, lado, r.estado, f.tipoDoc, f.descripcion, f.cantidad, f.exento, f.neto, f.iva, f.total, sincronizacionId, obtenidoEn);
        }
      }
      for (const d of documentos) {
        insDocumento.run({ ...d, rut, periodo, lado, sincronizacionId, obtenidoEn });
        insSnapshot.run(sincronizacionId, rut, periodo, claveDocumento(d), d.estado, huellaDocumento(d));
      }
    })();
  }

  resumenesRcv(rut: string, periodo: string): RcvResumen[] {
    const filas = this.db
      .prepare('SELECT lado, estado_rcv, tipo_doc, descripcion, cantidad, exento, neto, iva, total FROM rcv_resumen WHERE rut = ? AND periodo = ? ORDER BY lado, estado_rcv, tipo_doc')
      .all(rut, periodo) as FilaResumen[];
    const grupos = new Map<string, { lado: Lado; estado: EstadoRcv; filas: RcvResumenFila[] }>();
    for (const f of filas) {
      const clave = `${f.lado}|${f.estado_rcv}`;
      let grupo = grupos.get(clave);
      if (!grupo) {
        grupo = { lado: f.lado, estado: f.estado_rcv, filas: [] };
        grupos.set(clave, grupo);
      }
      grupo.filas.push({ tipoDoc: f.tipo_doc, descripcion: f.descripcion, cantidad: f.cantidad, exento: f.exento, neto: f.neto, iva: f.iva, total: f.total });
    }
    return [...grupos.values()].map((g) => ({ rut, periodo, lado: g.lado, estado: g.estado, filas: g.filas }));
  }

  documentosRcv(rut: string, periodo: string, filtro: FiltroDocumentos = {}): DocumentoRcv[] {
    const { condiciones, parametros } = condicionesDocumentos(rut, periodo, filtro);
    const filas = this.db
      .prepare(`SELECT * FROM rcv_documento WHERE ${condiciones} ORDER BY ${ORDEN_DOCUMENTOS}`)
      .all(parametros) as FilaDocumento[];
    return filas.map(aDocumento);
  }

  documentosRcvPaginados(rut: string, periodo: string, filtro: FiltroDocumentos, pagina: number, tamano: number): DocumentosPaginados {
    const { condiciones, parametros } = condicionesDocumentos(rut, periodo, filtro);
    const { total } = this.db.prepare(`SELECT COUNT(*) AS total FROM rcv_documento WHERE ${condiciones}`).get(parametros) as { total: number };
    const p = Number.isFinite(pagina) ? Math.max(1, Math.trunc(pagina)) : 1;
    const t = Number.isFinite(tamano) ? Math.min(200, Math.max(1, Math.trunc(tamano))) : 50;
    const offset = (p - 1) * t;
    // También evita enviar a SQLite offsets enormes que exceden su entero de 64 bits.
    if (offset >= total) return { total, documentos: [] };
    const filas = this.db.prepare(
      `SELECT * FROM rcv_documento WHERE ${condiciones} ORDER BY ${ORDEN_DOCUMENTOS} LIMIT @limite OFFSET @offset`,
    ).all({ ...parametros, limite: t, offset }) as FilaDocumento[];
    return { total, documentos: filas.map(aDocumento) };
  }

  snapshotsRcv(rut: string, periodo: string): SnapshotRcv[] {
    const filas = this.db
      .prepare(
        `SELECT s.id, s.superficie, s.iniciado_en, f.clave_doc, f.estado_rcv, f.sha256_fila
         FROM sincronizacion s LEFT JOIN rcv_documento_snapshot f ON f.sincronizacion_id = s.id
         WHERE s.rut = ? AND s.periodo = ? AND s.superficie IN ('rcv.VENTA', 'rcv.COMPRA') AND s.estado = 'ok'
         ORDER BY s.iniciado_en, s.id, f.clave_doc`,
      )
      .all(rut, periodo) as { id: number; superficie: string; iniciado_en: string; clave_doc: string | null; estado_rcv: EstadoRcv; sha256_fila: string }[];
    const fotos = new Map<number, { sincronizacionId: number; lado: Lado; obtenidoEn: string; filas: Array<SnapshotRcv['filas'][number]> }>();
    for (const f of filas) {
      let foto = fotos.get(f.id);
      if (!foto) {
        foto = { sincronizacionId: f.id, lado: f.superficie === 'rcv.VENTA' ? 'VENTA' : 'COMPRA', obtenidoEn: f.iniciado_en, filas: [] };
        fotos.set(f.id, foto);
      }
      if (f.clave_doc !== null) foto.filas.push({ clave: f.clave_doc, estado: f.estado_rcv, sha: f.sha256_fila });
    }
    return [...fotos.values()];
  }

  // --- F29 ----------------------------------------------------------------------------------
  guardarF29(
    sincronizacionId: number,
    rut: string,
    periodo: string,
    declaraciones: readonly F29Declaracion[],
    valores: readonly F29Valores[],
    obtenidoEn: string,
    lecturas: readonly LecturaFolioF29[] = [],
  ): void {
    const insDeclaracion = this.db.prepare(
      `INSERT OR REPLACE INTO f29_declaracion (rut, periodo, folio, estado, estado_id, fecha_presentacion, codigo_interno, total_a_pagar, sincronizacion_id, obtenido_en)
       VALUES (@rut, @periodo, @folio, @estado, @estadoId, @fechaPresentacion, @codigoInterno, @totalAPagar, @sincronizacionId, @obtenidoEn)`,
    );
    const insValor = this.db.prepare('INSERT OR REPLACE INTO f29_valor (rut, periodo, folio, codigo, valor) VALUES (?, ?, ?, ?, ?)');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM f29_declaracion WHERE rut = ? AND periodo = ?').run(rut, periodo);
      this.db.prepare('DELETE FROM f29_valor WHERE rut = ? AND periodo = ?').run(rut, periodo);
      for (const d of declaraciones) insDeclaracion.run({ ...d, rut, periodo, sincronizacionId, obtenidoEn });
      for (const v of valores) for (const [codigo, valor] of Object.entries(v.valores)) insValor.run(rut, periodo, v.folio, codigo, valor);
      // Una lectura vale mientras su folio siga declarado y con valores; las nuevas reemplazan a las anteriores.
      const declarados = new Set(declaraciones.map((d) => d.folio));
      const conLectura = valores.filter((v) => declarados.has(v.folio) && Object.keys(v.valores).length > 0);
      this.db
        .prepare('DELETE FROM f29_lectura WHERE rut = ? AND periodo = ? AND folio NOT IN (SELECT value FROM json_each(?))')
        .run(rut, periodo, JSON.stringify(conLectura.map((v) => v.folio)));
      for (const l of lecturas) {
        const v = conLectura.find((x) => x.folio === l.folio);
        if (v) this.escribirLectura(rut, periodo, l.folio, l, Object.keys(v.valores).length);
      }
    })();
  }

  reemplazarValoresFolioF29(rut: string, periodo: string, folio: number, valores: Readonly<Record<string, number>>, lectura: LecturaF29): void {
    const insValor = this.db.prepare('INSERT INTO f29_valor (rut, periodo, folio, codigo, valor) VALUES (?, ?, ?, ?, ?)');
    this.db.transaction(() => {
      const declarado = this.db.prepare('SELECT 1 FROM f29_declaracion WHERE rut = ? AND periodo = ? AND folio = ?').get(rut, periodo, folio);
      if (declarado === undefined) throw new Error(`No hay una declaración F29 de ${rut} en ${periodo} con folio ${folio}.`);
      this.db.prepare('DELETE FROM f29_valor WHERE rut = ? AND periodo = ? AND folio = ?').run(rut, periodo, folio);
      for (const [codigo, valor] of Object.entries(valores)) insValor.run(rut, periodo, folio, codigo, valor);
      this.escribirLectura(rut, periodo, folio, lectura, Object.keys(valores).length);
    })();
  }

  lecturaF29(rut: string, periodo: string, folio: number): LecturaF29Guardada | null {
    const f = this.db
      .prepare('SELECT version_lector, origen, leido_en, codigos, coherente FROM f29_lectura WHERE rut = ? AND periodo = ? AND folio = ?')
      .get(rut, periodo, folio) as { version_lector: string; origen: OrigenLecturaF29; leido_en: string; codigos: number; coherente: number } | undefined;
    if (!f) return null;
    return { versionLector: f.version_lector, origen: f.origen, leidoEn: f.leido_en, codigos: f.codigos, coherente: f.coherente === 1 };
  }

  pdfsF29Guardados(rut: string, desde?: string, hasta?: string): PdfF29Guardado[] {
    // El base64 de "%PDF" empieza con "JVBERi"; el quinto byte ("-") se revisa al decodificar.
    const filas = this.db
      .prepare(
        `SELECT json_extract(r.parametros_json, '$.periodo') AS periodo, json_extract(r.parametros_json, '$.folio') AS folio, r.cuerpo, r.obtenido_en
         FROM respuesta_cruda r JOIN sincronizacion s ON s.id = r.sincronizacion_id
         WHERE s.rut = @rut AND r.superficie = 'f29.formCompacto' AND substr(r.cuerpo, 1, 6) = 'JVBERi'
           AND json_extract(r.parametros_json, '$.periodo') = s.periodo
           AND (@desde IS NULL OR s.periodo >= @desde) AND (@hasta IS NULL OR s.periodo <= @hasta)
         ORDER BY r.obtenido_en DESC, r.id DESC`,
      )
      .all({ rut, desde: desde ?? null, hasta: hasta ?? null }) as { periodo: string; folio: unknown; cuerpo: string; obtenido_en: string }[];
    const elegidos = new Map<string, PdfF29Guardado>();
    for (const f of filas) {
      if (typeof f.folio !== 'number' || !Number.isSafeInteger(f.folio) || f.folio <= 0) continue;
      const clave = `${f.periodo}|${f.folio}`;
      if (elegidos.has(clave)) continue;
      const bytes = Buffer.from(f.cuerpo, 'base64');
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') continue;
      elegidos.set(clave, { periodo: f.periodo, folio: f.folio, bytes: new Uint8Array(bytes), obtenidoEn: f.obtenido_en });
    }
    return [...elegidos.values()].sort((a, b) => a.periodo.localeCompare(b.periodo) || a.folio - b.folio);
  }

  private escribirLectura(rut: string, periodo: string, folio: number, l: LecturaF29, codigos: number): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO f29_lectura (rut, periodo, folio, version_lector, origen, leido_en, codigos, coherente)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(rut, periodo, folio, l.versionLector, l.origen, l.leidoEn, codigos, l.coherente ? 1 : 0);
  }

  declaracionesF29(rut: string, periodo: string): F29Declaracion[] {
    return (this.db.prepare('SELECT * FROM f29_declaracion WHERE rut = ? AND periodo = ? ORDER BY folio').all(rut, periodo) as FilaDeclaracion[]).map(aDeclaracion);
  }

  valoresF29(rut: string, periodo: string, folio: number): F29Valores | null {
    const filas = this.db.prepare('SELECT codigo, valor FROM f29_valor WHERE rut = ? AND periodo = ? AND folio = ?').all(rut, periodo, folio) as { codigo: string; valor: number }[];
    if (filas.length === 0) return null;
    return { rut, periodo, folio, valores: Object.fromEntries(filas.map((f) => [f.codigo, f.valor])) };
  }

  // --- propuesta F29 ---------------------------------------------------------------------
  reemplazarPropuestaF29(sincronizacionId: number, rut: string, periodo: string, propuesta: PropuestaF29, obtenidoEn: string): void {
    const insValor = this.db.prepare('INSERT INTO f29_propuesta_valor (rut, periodo, lista, codigo, valor) VALUES (?, ?, ?, ?, ?)');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM f29_propuesta WHERE rut = ? AND periodo = ?').run(rut, periodo);
      this.db.prepare('DELETE FROM f29_propuesta_valor WHERE rut = ? AND periodo = ?').run(rut, periodo);
      this.db
        .prepare(
          `INSERT INTO f29_propuesta (rut, periodo, tipo_propuesta, descripcion_tipo, estado_calculo, sin_propuesta, sincronizacion_id, obtenido_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(rut, periodo, propuesta.tipoPropuesta, propuesta.descripcionTipo, propuesta.estadoCalculo, propuesta.sinPropuesta ? 1 : 0, sincronizacionId, obtenidoEn);
      for (const [codigo, valor] of Object.entries(propuesta.propuestos)) insValor.run(rut, periodo, 'propuesto', codigo, valor);
      for (const [codigo, valor] of Object.entries(propuesta.administrativos)) insValor.run(rut, periodo, 'administrativo', codigo, valor);
    })();
  }

  propuestaF29(rut: string, periodo: string): PropuestaF29 | null {
    const f = this.db
      .prepare('SELECT tipo_propuesta, descripcion_tipo, estado_calculo, sin_propuesta FROM f29_propuesta WHERE rut = ? AND periodo = ?')
      .get(rut, periodo) as { tipo_propuesta: number | null; descripcion_tipo: string | null; estado_calculo: number | null; sin_propuesta: number } | undefined;
    if (!f) return null;
    const filas = this.db.prepare('SELECT lista, codigo, valor FROM f29_propuesta_valor WHERE rut = ? AND periodo = ?').all(rut, periodo) as { lista: string; codigo: string; valor: number }[];
    const de = (lista: string): Record<string, number> => Object.fromEntries(filas.filter((v) => v.lista === lista).map((v) => [v.codigo, v.valor]));
    return {
      rut,
      periodo,
      tipoPropuesta: f.tipo_propuesta,
      descripcionTipo: f.descripcion_tipo,
      estadoCalculo: f.estado_calculo,
      propuestos: de('propuesto'),
      administrativos: de('administrativo'),
      sinPropuesta: f.sin_propuesta === 1,
    };
  }

  // --- boletas de honorarios recibidas -----------------------------------------------------
  reemplazarBhe(sincronizacionId: number, rut: string, periodo: string, boletas: readonly BoletaHonorarios[], obtenidoEn: string): void {
    // Una boleta pertenece a un solo mes: si ya estaba guardada en otro, pasa al mes que la trae ahora.
    const ins = this.db.prepare(
      `INSERT OR REPLACE INTO bhe_recibida (rut, periodo, rut_emisor, folio, nombre_emisor, fecha, bruto, retencion, liquido, sociedad_profesional, anulada, fecha_anulacion, sincronizacion_id, obtenido_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM bhe_recibida WHERE rut = ? AND periodo = ?').run(rut, periodo);
      for (const b of boletas) {
        ins.run(
          rut,
          periodo,
          b.rutEmisor,
          b.folio,
          b.nombreEmisor,
          b.fecha,
          b.bruto,
          b.retencion,
          b.liquido,
          b.sociedadProfesional ? 1 : 0,
          b.anulada ? 1 : 0,
          b.fechaAnulacion,
          sincronizacionId,
          obtenidoEn,
        );
      }
    })();
  }

  boletasHonorarios(rut: string, periodo: string): BoletaHonorarios[] {
    const filas = this.db
      .prepare(
        `SELECT rut_emisor, folio, nombre_emisor, fecha, bruto, retencion, liquido, sociedad_profesional, anulada, fecha_anulacion
         FROM bhe_recibida WHERE rut = ? AND periodo = ? ORDER BY COALESCE(fecha, ''), rut_emisor, folio`,
      )
      .all(rut, periodo) as FilaBhe[];
    return filas.map((f) => ({
      rut,
      periodo,
      rutEmisor: f.rut_emisor,
      folio: f.folio,
      nombreEmisor: f.nombre_emisor,
      fecha: f.fecha,
      bruto: f.bruto,
      retencion: f.retencion,
      liquido: f.liquido,
      sociedadProfesional: f.sociedad_profesional === 1,
      anulada: f.anulada === 1,
      fechaAnulacion: f.fecha_anulacion,
    }));
  }

  totalesBhe(rut: string, periodo: string): TotalesBheMes {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS cantidad, COALESCE(SUM(anulada), 0) AS anuladas,
           COALESCE(SUM(CASE WHEN anulada = 0 THEN bruto END), 0) AS bruto,
           COALESCE(SUM(CASE WHEN anulada = 0 THEN retencion END), 0) AS retencion,
           COALESCE(SUM(CASE WHEN anulada = 0 THEN liquido END), 0) AS liquido
         FROM bhe_recibida WHERE rut = ? AND periodo = ?`,
      )
      .get(rut, periodo) as TotalesBheMes;
  }

  ultimaSincronizacion(rut: string, superficie: string, periodo: string): { readonly estado: 'en_curso' | 'ok' | 'error'; readonly errorCodigo: string | null } | null {
    const f = this.db
      .prepare('SELECT estado, error_codigo FROM sincronizacion WHERE rut = ? AND superficie = ? AND periodo = ? ORDER BY id DESC LIMIT 1')
      .get(rut, superficie, periodo) as { estado: 'en_curso' | 'ok' | 'error'; error_codigo: string | null } | undefined;
    return f ? { estado: f.estado, errorCodigo: f.error_codigo } : null;
  }

  // --- frescura ---------------------------------------------------------------------------
  disponibilidadFuentes(rut: string, periodo: string): DisponibilidadFuentes {
    const superficies = this.db.prepare(
      `SELECT DISTINCT superficie FROM sincronizacion WHERE rut = ? AND periodo = ? AND estado = 'ok'
       AND superficie IN ('rcv.VENTA', 'rcv.COMPRA', 'f29', 'f29.propuesta', 'bhe.recibidas')`,
    ).all(rut, periodo) as { superficie: string }[];
    const conocidas = new Set(superficies.map((s) => s.superficie));
    return {
      ventasRcv: conocidas.has('rcv.VENTA'),
      comprasRcv: conocidas.has('rcv.COMPRA'),
      f29: conocidas.has('f29'),
      propuestaF29: conocidas.has('f29.propuesta'),
      bheRecibidas: conocidas.has('bhe.recibidas'),
    };
  }

  frescura(rut: string, periodo: string): Frescura {
    const consulta = this.db.prepare(`SELECT MAX(terminado_en) AS t FROM sincronizacion WHERE rut = ? AND periodo = ? AND estado = 'ok' AND superficie LIKE ?`);
    return {
      rcv: (consulta.get(rut, periodo, 'rcv.%') as { t: string | null }).t,
      f29: (consulta.get(rut, periodo, 'f29') as { t: string | null }).t,
      propuesta: (consulta.get(rut, periodo, 'f29.propuesta') as { t: string | null }).t,
      bhe: (consulta.get(rut, periodo, 'bhe.recibidas') as { t: string | null }).t,
    };
  }

  periodosConDatos(rut: string): string[] {
    return (this.db.prepare(`SELECT DISTINCT periodo FROM sincronizacion WHERE rut = ? AND estado = 'ok' AND periodo GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' ORDER BY periodo`).all(rut) as { periodo: string }[]).map((f) => f.periodo);
  }

  // --- hallazgos ----------------------------------------------------------------------------
  reemplazarHallazgos(rut: string, periodo: string, hallazgos: readonly Hallazgo[], versionReglas: string, calculadoEn: string): void {
    const ins = this.db.prepare(
      `INSERT INTO hallazgo (rut, periodo, regla, severidad, naturaleza, titulo, detalle, datos_json, version_reglas, calculado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM hallazgo WHERE rut = ? AND periodo = ?').run(rut, periodo);
      for (const h of hallazgos) {
        ins.run(rut, periodo, h.regla, h.severidad, h.naturaleza, h.titulo, h.detalle, JSON.stringify({ montos: h.montos, evidencia: h.evidencia }), versionReglas, calculadoEn);
      }
    })();
  }

  hallazgos(rut: string, filtro: FiltroHallazgos = {}): HallazgoGuardado[] {
    const condiciones = ['rut = @rut'];
    const parametros: Record<string, unknown> = { rut };
    if (filtro.desde) {
      condiciones.push('periodo >= @desde');
      parametros['desde'] = filtro.desde;
    }
    if (filtro.hasta) {
      condiciones.push('periodo <= @hasta');
      parametros['hasta'] = filtro.hasta;
    }
    if (filtro.severidad) {
      condiciones.push('severidad = @severidad');
      parametros['severidad'] = filtro.severidad;
    }
    const filas = this.db
      .prepare(
        `SELECT * FROM hallazgo WHERE ${condiciones.join(' AND ')}
         ORDER BY periodo DESC, CASE severidad WHEN 'critico' THEN 0 WHEN 'advertencia' THEN 1 ELSE 2 END, id`,
      )
      .all(parametros) as FilaHallazgo[];
    return filas.map((f) => {
      const datos = JSON.parse(f.datos_json) as { montos: Hallazgo['montos']; evidencia: string[] };
      return {
        regla: f.regla,
        severidad: f.severidad,
        naturaleza: f.naturaleza,
        rut: f.rut,
        periodo: f.periodo,
        titulo: f.titulo,
        detalle: f.detalle,
        montos: datos.montos,
        evidencia: datos.evidencia,
        versionReglas: f.version_reglas,
        calculadoEn: f.calculado_en,
      };
    });
  }
}
