import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import type { LimitesConsulta, OpcionesConsulta } from '../../src/ports/index.js';
import { signoTipoDoc, TIPOS_DOC_NEGATIVOS } from '../../src/reconciliation/mapeo-f29.js';
import { ConsultaLibreSqlite } from '../../src/store/sqlite/consulta-libre.js';
import { abrirDb, type Db } from '../../src/store/sqlite/db.js';
import { SqliteStore } from '../../src/store/sqlite/store.js';
import { codigoDe } from '../helpers/errores.js';
import { declaracion, documento, fila, perfilEmpresa, perfilPersona, resumen, RUT_EMPRESA, RUT_PERSONA, RUT_PROVEEDOR, valores } from '../helpers/fabricas.js';
import { sembrarMes, T_SEMBRADO } from '../helpers/sembrar.js';

const LIMITES: LimitesConsulta = { filas: 200, caracteres: 40_000, caracteresCelda: 1_000, milisegundos: 15_000 };
const OPCIONES: OpcionesConsulta = { limites: LIMITES, tiposNegativos: TIPOS_DOC_NEGATIVOS };
const MARCA = '…[recortado]';
const TOKEN = 'TOKEN-FALSO-123';
const TABLAS_COPIA = ['bhe_emitida', 'bhe_emitida_mes', 'bhe_recibida', 'contribuyente', 'contribuyente_tributario', 'f22_declaracion', 'f22_evento', 'f22_observacion', 'f22_valor', 'f29_declaracion', 'f29_lectura', 'f29_propuesta', 'f29_propuesta_valor', 'f29_valor', 'hallazgo', 'rcv_documento', 'rcv_resumen', 'sii_empresa_autorizada', 'sincronizacion'];

/** Sentencias que nunca deben correr; reciben la carpeta temporal donde está la base real. */
const PROHIBIDAS: readonly (readonly [string, (carpeta: string) => string])[] = [
  ['INSERT', () => "INSERT INTO hallazgo (rut, periodo, regla, severidad, naturaleza, titulo, detalle, datos_json, version_reglas, calculado_en) VALUES ('22222222-2', '2026-09', 'X', 'alta', 'x', 'x', 'x', '{}', 'v', 't')"],
  ['DELETE', () => 'DELETE FROM rcv_documento'],
  ['DROP', () => 'DROP TABLE contribuyente'],
  ['ATTACH del archivo', (carpeta) => `ATTACH DATABASE '${join(carpeta, 'real.db')}' AS x`],
  ['VACUUM INTO', (carpeta) => `VACUUM INTO '${join(carpeta, 'fuga.db')}'`],
  ['PRAGMA de escritura', () => 'PRAGMA user_version = 5'],
  ['dos sentencias', () => 'SELECT 1; SELECT 2'],
  ['load_extension', () => "SELECT load_extension('x')"],
];

const abiertas: Db[] = [];
const carpetas: string[] = [];

afterEach(() => {
  for (const db of abiertas.splice(0)) db.close();
  for (const carpeta of carpetas.splice(0)) rmSync(carpeta, { recursive: true, force: true });
});

function carpetaTemporal(): string {
  const carpeta = mkdtempSync(join(tmpdir(), 'impuestocl-consulta-'));
  carpetas.push(carpeta);
  return carpeta;
}

function base(ruta = ':memory:'): { db: Db; store: SqliteStore; consulta: ConsultaLibreSqlite } {
  const db = abrirDb(ruta);
  abiertas.push(db);
  return { db, store: new SqliteStore(db), consulta: new ConsultaLibreSqlite(db) };
}

/** Empresa en tres meses (con notas de crédito y F29) y persona en dos meses. */
function sembrar(store: SqliteStore): void {
  store.guardarContribuyente(perfilEmpresa({ razonSocial: 'Ñandú Comercial Ltda.' }));
  store.guardarContribuyente(perfilPersona());
  ['2026-07', '2026-08', '2026-09'].forEach((periodo, i) => {
    sembrarMes(store, periodo, {
      resumenes: [resumen({ periodo, filas: [fila(33, 1_000_000, 190_000), fila(61, 100_000, 19_000)] })],
      documentos: [documento({ periodo, folio: 100 + i }), documento({ periodo, folio: 200 + i, tipoDoc: 61 })],
      declaraciones: [declaracion({ periodo })],
      valores: [valores({ '538': 1234.5 }, { periodo })],
    });
  });
  for (const periodo of ['2026-08', '2026-09']) {
    sembrarMes(store, periodo, { resumenes: [resumen({ rut: RUT_PERSONA, periodo })] }, RUT_PERSONA);
  }
}

/** El ErrorImpuestocl con que rechaza la promesa; falla la prueba si termina de otra forma. */
async function falla(promesa: Promise<unknown>): Promise<ErrorImpuestocl> {
  try {
    await promesa;
  } catch (e) {
    if (e instanceof ErrorImpuestocl) return e;
    throw e;
  }
  throw new Error('La promesa debía rechazarse con un ErrorImpuestocl.');
}

const conPlazo = (milisegundos: number): OpcionesConsulta => ({ ...OPCIONES, limites: { ...LIMITES, milisegundos } });
const serie = (hasta: number, columnas = 'x'): string =>
  `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${hasta}) SELECT ${columnas} FROM c`;

describe('ConsultaLibreSqlite', () => {
  it('devuelve columnas y filas sobre varios meses y RUT', async () => {
    const { store, consulta } = base();
    sembrar(store);
    expect(await consulta.consultar('SELECT rut, COUNT(DISTINCT periodo) AS meses FROM rcv_resumen GROUP BY rut ORDER BY rut', OPCIONES)).toEqual({
      columnas: ['rut', 'meses'],
      filas: [[RUT_PERSONA, 2], [RUT_EMPRESA, 3]],
      truncado: false,
    });
  });

  it('signo coincide con signoTipoDoc en rcv_resumen y rcv_documento', async () => {
    const { store, consulta } = base();
    sembrar(store);
    for (const tabla of ['rcv_resumen', 'rcv_documento']) {
      const { filas } = await consulta.consultar(`SELECT DISTINCT tipo_doc, signo FROM ${tabla} ORDER BY tipo_doc`, OPCIONES);
      expect(filas).toEqual([[33, 1], [61, -1]]);
      expect(filas).toEqual(filas.map(([tipo]) => [tipo, signoTipoDoc(tipo as number)]));
    }
  });

  it('funciona sobre una base en archivo en modo WAL', async () => {
    const { db, store, consulta } = base(join(carpetaTemporal(), 'x.db'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    sembrar(store);
    expect((await consulta.consultar('SELECT COUNT(*) AS n FROM rcv_documento', OPCIONES)).filas).toEqual([[6]]);
  });

  it.each(PROHIBIDAS)('rechaza sentencias no permitidas: %s', async (_nombre, armar) => {
    const carpeta = carpetaTemporal();
    const { store, consulta } = base(join(carpeta, 'real.db'));
    sembrar(store);
    expect(await codigoDe(consulta.consultar(armar(carpeta), OPCIONES))).toBe('CONSULTA_RECHAZADA');
    expect(existsSync(join(carpeta, 'fuga.db'))).toBe(false);
    expect(store.contribuyentes()).toHaveLength(2);
  });

  it('no expone datos sensibles', async () => {
    const { store, consulta } = base();
    sembrar(store);
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'rcv.VENTA', '2026-10', T_SEMBRADO);
    store.guardarRespuestaCruda(id, { superficie: 'rcv.resumen', parametros: { conversationId: TOKEN }, cuerpo: `{"conversationId":"${TOKEN}"}`, obtenidoEn: T_SEMBRADO });
    store.terminarSincronizacion(id, T_SEMBRADO, 'error', { codigo: 'PORTAL_CAMBIO', detalle: `respuesta cruda con ${TOKEN}` });
    for (const sql of ['SELECT * FROM respuesta_cruda', 'SELECT * FROM rcv_documento_snapshot', 'SELECT error_detalle FROM sincronizacion']) {
      expect(await codigoDe(consulta.consultar(sql, OPCIONES))).toBe('CONSULTA_RECHAZADA');
    }
    const maestro = await consulta.consultar('SELECT name FROM sqlite_master', OPCIONES);
    expect(maestro.filas.map(([nombre]) => nombre).sort()).toEqual(TABLAS_COPIA);
    expect(JSON.stringify(await consulta.consultar('SELECT * FROM sqlite_master', OPCIONES))).not.toContain(TOKEN);
    for (const tabla of TABLAS_COPIA) {
      expect(JSON.stringify(await consulta.consultar(`SELECT * FROM ${tabla}`, OPCIONES))).not.toContain(TOKEN);
    }
    const sincronizaciones = await consulta.consultar("SELECT * FROM sincronizacion WHERE estado = 'error'", OPCIONES);
    expect(sincronizaciones.columnas).not.toContain('error_detalle');
    expect(sincronizaciones.filas).toHaveLength(1);
  });

  it('recorta por filas', async () => {
    const { consulta } = base();
    const recortado = await consulta.consultar(serie(250), OPCIONES);
    expect(recortado.filas).toEqual(Array.from({ length: 200 }, (_, i) => [i + 1]));
    expect(recortado.truncado).toBe(true);
    const justo = await consulta.consultar(serie(200), OPCIONES);
    expect(justo.filas).toHaveLength(200);
    expect(justo.truncado).toBe(false);
  });

  it('recorta por caracteres', async () => {
    const { consulta } = base();
    const { filas, truncado } = await consulta.consultar(serie(100, 'x, hex(zeroblob(450)) AS texto'), OPCIONES);
    expect(truncado).toBe(true);
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.length).toBeLessThan(100);
    expect(JSON.stringify(filas).length).toBeLessThanOrEqual(40_000);
    // Se detiene en la primera fila que ya no cabe, no antes.
    expect(JSON.stringify([...filas, [filas.length + 1, '0'.repeat(900)]]).length).toBeGreaterThan(40_000);
  });

  it('recorta celdas largas y BLOB', async () => {
    const { consulta } = base();
    const largo = await consulta.consultar('SELECT hex(zeroblob(1500)) AS largo', OPCIONES);
    // 3 000 caracteres quedan en 1 000 más la marca.
    expect(largo.filas).toEqual([['0'.repeat(1_000) + MARCA]]);
    expect(largo.truncado).toBe(true);
    expect(await consulta.consultar('SELECT zeroblob(10) AS b', OPCIONES)).toEqual({ columnas: ['b'], filas: [['[blob de 10 bytes]']], truncado: true });
  });

  it('interrumpe una consulta sin fin y sigue respondiendo', async () => {
    const { store, consulta } = base();
    sembrar(store);
    const inicio = performance.now();
    const pendiente = consulta.consultar('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c', conPlazo(500));
    expect(consulta.procesosActivos).toBe(1);
    expect(await codigoDe(pendiente)).toBe('CONSULTA_INTERRUMPIDA');
    expect(performance.now() - inicio).toBeLessThan(5_000);
    expect(consulta.procesosActivos).toBe(0);
    expect((await consulta.consultar('SELECT COUNT(*) AS n FROM contribuyente', OPCIONES)).filas).toEqual([[2]]);
    expect(consulta.procesosActivos).toBe(0);
  });

  describe('un hijo que muere sin responder', () => {
    const MARCA_STDERR = 'MARCA-STDERR-HIJO';

    /** Un script de hijo que escribe en stderr y sale con error, como un `dist` roto o un módulo nativo que no carga. */
    function hijoCaido(cuerpo: string): string {
      const ruta = join(carpetaTemporal(), 'hijo-caido.mjs');
      writeFileSync(ruta, cuerpo);
      return ruta;
    }

    it('informa una falla interna con el extracto de stderr, sin invitar a simplificar la consulta', async () => {
      const db = abrirDb(':memory:');
      abiertas.push(db);
      const consulta = new ConsultaLibreSqlite(db, hijoCaido(`console.error('${MARCA_STDERR} ' + 'x'.repeat(5000)); process.exit(7);`));

      const error = await falla(consulta.consultar('SELECT 1', OPCIONES));

      expect(error).toBeInstanceOf(ErrorImpuestocl);
      expect(error.codigo).toBe('CONSULTA_INTERRUMPIDA');
      expect(error.message).toContain('código 7');
      expect(error.message).toContain(MARCA_STDERR);
      // Solo los primeros ~500 caracteres de stderr: nada de los 5 000.
      expect(error.message.length).toBeLessThan(800);
      expect(error.accion).toMatch(/Falla interna/);
      expect(error.accion).toContain('npm.cmd run build');
      expect(error.accion).toMatch(/no es un problema de la consulta/);
      expect(error.accion).not.toMatch(/Simplifica/);
      expect(consulta.procesosActivos).toBe(0);
    });

    it('con un script inexistente informa lo que dijo Node', async () => {
      const db = abrirDb(':memory:');
      abiertas.push(db);
      const consulta = new ConsultaLibreSqlite(db, join(carpetaTemporal(), 'no-existe.js'));

      const error = await falla(consulta.consultar('SELECT 1', OPCIONES));

      expect(error.codigo).toBe('CONSULTA_INTERRUMPIDA');
      expect(error.message).toMatch(/Salida de error:.*no-existe\.js/s);
      expect(error.accion).toMatch(/Falla interna/);
      expect(consulta.procesosActivos).toBe(0);
    });

    it('un plazo vencido sigue pidiendo simplificar la consulta', async () => {
      const db = abrirDb(':memory:');
      abiertas.push(db);
      const consulta = new ConsultaLibreSqlite(db);

      const error = await falla(consulta.consultar('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c', conPlazo(300)));

      expect(error.codigo).toBe('CONSULTA_INTERRUMPIDA');
      expect(error.message).toMatch(/superó el plazo de 300 ms/);
      expect(error.accion).toMatch(/Simplifica la consulta/);
    });
  });

  it('no cambia la base real', async () => {
    const { db, store, consulta } = base();
    sembrar(store);
    const antes = db.serialize();
    const carpeta = carpetaTemporal();
    for (const [, armar] of PROHIBIDAS) await codigoDe(consulta.consultar(armar(carpeta), OPCIONES));
    for (const sql of ['SELECT * FROM rcv_documento', 'SELECT name FROM sqlite_master', serie(250), 'SELECT zeroblob(10)', 'SELECT * FROM respuesta_cruda']) {
      await codigoDe(consulta.consultar(sql, OPCIONES));
    }
    await codigoDe(consulta.consultar('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c', conPlazo(300)));
    expect(db.serialize().equals(antes)).toBe(true);
  });

  it('UTF-8, NULL y REAL', async () => {
    const { store, consulta } = base();
    sembrar(store);
    const sql = `SELECT c.rut, c.razon_social, v.valor FROM contribuyente c
      LEFT JOIN f29_valor v ON v.rut = c.rut AND v.periodo = '2026-09' AND v.codigo = '538' ORDER BY c.rut`;
    expect((await consulta.consultar(sql, OPCIONES)).filas).toEqual([[RUT_PERSONA, null, null], [RUT_EMPRESA, 'Ñandú Comercial Ltda.', 1234.5]]);
  });

  it('dos consultas en paralelo', async () => {
    const { store, consulta } = base();
    sembrar(store);
    const [perfiles, documentos] = await Promise.all([
      consulta.consultar('SELECT rut FROM contribuyente ORDER BY rut', OPCIONES),
      consulta.consultar('SELECT periodo, COUNT(*) AS n FROM rcv_documento GROUP BY periodo ORDER BY periodo', OPCIONES),
    ]);
    expect(perfiles.filas).toEqual([[RUT_PERSONA], [RUT_EMPRESA]]);
    expect(documentos).toEqual({ columnas: ['periodo', 'n'], filas: [['2026-07', 2], ['2026-08', 2], ['2026-09', 2]], truncado: false });
    expect(consulta.procesosActivos).toBe(0);
  });

  it('resultado vacío conserva columnas', async () => {
    const { store, consulta } = base();
    sembrar(store);
    expect(await consulta.consultar('SELECT rut, alias FROM contribuyente WHERE 0', OPCIONES)).toEqual({ columnas: ['rut', 'alias'], filas: [], truncado: false });
  });

  it('20 000 documentos en archivo WAL en menos de 8 s', async () => {
    const { db, store, consulta } = base(join(carpetaTemporal(), 'x.db'));
    store.guardarContribuyente(perfilEmpresa());
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'rcv.COMPRA', '2026-09', T_SEMBRADO);
    const insertar = db.prepare(
      `INSERT INTO rcv_documento (rut, periodo, lado, estado_rcv, tipo_doc, rut_contraparte, folio, razon_social, fecha_emision, fecha_recepcion,
         monto_exento, monto_neto, monto_iva, monto_iva_no_recuperable, monto_iva_uso_comun, monto_total, tipo_compra, sincronizacion_id, obtenido_en)
       VALUES (?, '2026-09', 'COMPRA', 'REGISTRO', ?, ?, ?, 'PROVEEDOR DEMO LTDA', '2026-09-05', '2026-09-05 10:00:00', 0, 100000, 19000, 0, 0, 119000, '1', ?, ?)`,
    );
    db.transaction(() => {
      for (let folio = 1; folio <= 20_000; folio++) insertar.run(RUT_EMPRESA, folio % 10 === 0 ? 61 : 33, RUT_PROVEEDOR, folio, id, T_SEMBRADO);
    })();
    const inicio = performance.now();
    const { filas } = await consulta.consultar('SELECT COUNT(*) AS n, SUM(signo * monto_iva) AS iva FROM rcv_documento', OPCIONES);
    expect(performance.now() - inicio).toBeLessThan(8_000);
    expect(filas).toEqual([[20_000, (18_000 - 2_000) * 19_000]]);
  });
});
