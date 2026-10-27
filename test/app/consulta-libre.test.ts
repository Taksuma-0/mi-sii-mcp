import { describe, expect, it, vi } from 'vitest';
import { esquemaDatos, consultaSql, LIMITES_CONSULTA, MAX_CARACTERES_SQL } from '../../src/app/consulta-libre.js';
import type { DepsApp } from '../../src/app/deps.js';
import { SOLO_RESUMEN_VENTA } from '../../src/app/sincronizar.js';
import { declaracionVigente } from '../../src/domain/f29.js';
import { NOMBRES_TIPO_DOCUMENTO } from '../../src/domain/formato.js';
import type { ConsultaLibre, ResultadoConsulta } from '../../src/ports/index.js';
import { CODIGO_F29, CODIGOS_CREDITO_FUERA_RCV, LINEAS_DE_TOTALES, TIPOS_DOC_NEGATIVOS } from '../../src/reconciliation/mapeo-f29.js';
import { depsDePrueba } from '../helpers/deps.js';
import { codigoDe } from '../helpers/errores.js';
import { declaracion, documento, fila, perfilEmpresa, resumen, RUT_EMPRESA } from '../helpers/fabricas.js';
import { sembrarMes } from '../helpers/sembrar.js';

const VACIO: ResultadoConsulta = { columnas: ['n'], filas: [[1]], truncado: false };

function conEspia() {
  const consultar = vi.fn<ConsultaLibre['consultar']>(async () => VACIO);
  const base = depsDePrueba();
  const deps: DepsApp = { ...base.deps, consultaLibre: { consultar } };
  return { deps, consultar };
}

describe('consultaSql', () => {
  it('rechaza SQL vacío o de más de 20 000 caracteres sin consultar', async () => {
    const { deps, consultar } = conEspia();

    expect(MAX_CARACTERES_SQL).toBe(20_000);
    for (const sql of ['', '   ', '\n\t ', 'x'.repeat(20_001)]) {
      expect(await codigoDe(consultaSql(deps, sql))).toBe('CONSULTA_RECHAZADA');
    }
    expect(consultar).not.toHaveBeenCalled();

    await consultaSql(deps, 'x'.repeat(20_000));
    expect(consultar).toHaveBeenCalledTimes(1);
  });

  it('entrega LIMITES_CONSULTA y TIPOS_DOC_NEGATIVOS al puerto', async () => {
    const { deps, consultar } = conEspia();

    expect(LIMITES_CONSULTA).toEqual({ filas: 200, caracteres: 40_000, caracteresCelda: 1_000, milisegundos: 15_000 });
    expect(await consultaSql(deps, 'SELECT 1')).toBe(VACIO);
    expect(consultar).toHaveBeenLastCalledWith('SELECT 1', { limites: LIMITES_CONSULTA, tiposNegativos: TIPOS_DOC_NEGATIVOS });

    const corto = { ...LIMITES_CONSULTA, milisegundos: 50 };
    await consultaSql(deps, 'SELECT 2', corto);
    expect(consultar).toHaveBeenLastCalledWith('SELECT 2', { limites: corto, tiposNegativos: TIPOS_DOC_NEGATIVOS });
  });

  it('consulta la copia de la base conectada en las dependencias de prueba', async () => {
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sembrarMes(store, '2026-09', {
      resumenes: [resumen({ filas: [fila(33, 100_000, 19_000), fila(61, 10_000, 1_900)] })],
      documentos: [documento({ lado: 'VENTA', tipoDoc: 61, folio: 7 })],
    });

    const r = await consultaSql(deps, 'SELECT tipo_doc, signo FROM rcv_resumen ORDER BY tipo_doc');

    expect(r).toEqual({ columnas: ['tipo_doc', 'signo'], filas: [[33, 1], [61, -1]], truncado: false });
  });
});

describe('esquemaDatos', () => {
  it('el esquema documenta exactamente las tablas y columnas de la copia', async () => {
    const { deps } = depsDePrueba();

    const copia = await consultaSql(
      deps,
      "SELECT m.name, p.name FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' ORDER BY 1, 2",
    );
    const documentado = esquemaDatos()
      .tablas.flatMap((t) => t.columnas.map((c) => [t.nombre, c.nombre]))
      .sort((a, b) => (a[0]! + '.' + a[1]!).localeCompare(b[0]! + '.' + b[1]!));
    const real = copia.filas.map((f) => [f[0], f[1]]).sort((a, b) => (a[0] + '.' + a[1]).localeCompare(b[0] + '.' + b[1]));

    expect(documentado).toEqual(real);
    expect(documentado.length).toBeGreaterThan(50);
  });

  it('explica f29_lectura: coherente sin prometer 538/537 presentes, y que f29.valores no se repite si ya hay lectura coherente', () => {
    const columna = (tabla: string, nombre: string) => esquemaDatos().tablas.find((t) => t.nombre === tabla)?.columnas.find((c) => c.nombre === nombre)?.significado ?? '';
    expect(columna('f29_lectura', 'coherente')).not.toMatch(/legibles/);
    expect(columna('f29_lectura', 'coherente')).toMatch(/ausente.*0/);
    expect(columna('sincronizacion', 'superficie')).toMatch(/f29\.valores.*f29_lectura/);
  });

  it('documenta la propuesta del SII: tablas, superficie y que trae crédito, remanente y retención pero no débito ni total a pagar', () => {
    const { tablas, reglas } = esquemaDatos();
    expect(tablas.map((t) => t.nombre)).toEqual(expect.arrayContaining(['f29_propuesta', 'f29_propuesta_valor']));
    const columna = (tabla: string, nombre: string) => tablas.find((t) => t.nombre === tabla)?.columnas.find((c) => c.nombre === nombre)?.significado ?? '';
    expect(columna('f29_propuesta_valor', 'lista')).toMatch(/propuesto.*administrativo/);
    expect(columna('sincronizacion', 'superficie')).toContain('f29.propuesta');
    const regla = reglas.find((r) => r.includes('f29_propuesta'));
    expect(regla).toBeDefined();
    expect(regla).toMatch(/crédito.*remanente.*retención/);
    expect(regla).toMatch(/no trae débito ni total a pagar/);
  });

  it('documenta las boletas de honorarios recibidas: tabla, superficie, anuladas y el cruce de la retención con el 151', () => {
    const { tablas, reglas } = esquemaDatos();
    expect(tablas.map((t) => t.nombre)).toContain('bhe_recibida');
    const columna = (tabla: string, nombre: string) => tablas.find((t) => t.nombre === tabla)?.columnas.find((c) => c.nombre === nombre)?.significado ?? '';
    expect(columna('bhe_recibida', 'anulada')).toMatch(/1.*anulada/);
    expect(columna('sincronizacion', 'superficie')).toContain('bhe.recibidas');
    const regla = reglas.find((r) => r.includes('bhe_recibida'));
    expect(regla).toBeDefined();
    expect(regla).toContain('anulada = 0');
    expect(regla).toContain(`'${CODIGO_F29.RETENCION_HONORARIOS}'`);
    expect(regla).toContain('RET-01');
  });

  it('documenta la cuenta del SII: perfil tributario, atributos sin datos personales y empresas autorizadas', () => {
    const { tablas, reglas } = esquemaDatos();
    expect(tablas.map((t) => t.nombre)).toEqual(expect.arrayContaining(['contribuyente_tributario', 'sii_empresa_autorizada']));
    const columna = (tabla: string, nombre: string) => tablas.find((t) => t.nombre === tabla)?.columnas.find((c) => c.nombre === nombre)?.significado ?? '';
    expect(columna('contribuyente_tributario', 'autorizado_dia20')).toMatch(/NULL.*desconoc/);
    expect(columna('contribuyente_tributario', 'atributos_json')).toMatch(/EMTP.*SGMI.*14TT.*FPYM/);
    expect(columna('contribuyente_tributario', 'atributos_json')).toMatch(/NOTI|correo/);
    expect(columna('sii_empresa_autorizada', 'fecha_desautorizacion')).toMatch(/NULL.*activa/);
    expect(columna('sincronizacion', 'superficie')).toContain('cuenta.perfil');
    expect(columna('sincronizacion', 'superficie')).toContain('cuenta.empresas');
    expect(columna('sincronizacion', 'periodo')).toMatch(/vac/);
    const regla = reglas.find((r) => r.includes('contribuyente_tributario'));
    expect(regla).toBeDefined();
    expect(regla).toContain('perfil_sincronizar');
    expect(regla).toMatch(/día 20/);
  });

  it('documenta la renta F22: tablas por año tributario, AT = año comercial + 1 y códigos con su glosa', () => {
    const { tablas, reglas } = esquemaDatos();
    expect(tablas.map((t) => t.nombre)).toEqual(expect.arrayContaining(['f22_declaracion', 'f22_valor', 'f22_observacion', 'f22_evento']));
    const columna = (tabla: string, nombre: string) => tablas.find((t) => t.nombre === tabla)?.columnas.find((c) => c.nombre === nombre)?.significado ?? '';
    expect(columna('f22_declaracion', 'anio_tributario')).toMatch(/año comercial \+ 1/);
    expect(columna('f22_declaracion', 'vigente')).toMatch(/NULL/);
    expect(columna('f22_valor', 'valor')).toMatch(/NULL/);
    expect(columna('f22_valor', 'glosa')).toMatch(/glosa/i);
    expect(columna('sincronizacion', 'superficie')).toContain('f22.folio');
    expect(columna('sincronizacion', 'periodo')).toContain('AT');
    const regla = reglas.find((r) => r.includes('f22_declaracion'));
    expect(regla).toBeDefined();
    expect(regla).toContain('renta_sincronizar');
    expect(regla).toMatch(/año comercial \+ 1/);
    expect(regla).toMatch(/glosa/);
    expect(regla).toMatch(/nombres|domicilio|banco/);
  });

  it('describe cada tabla y cada columna con tipo y significado', () => {
    for (const tabla of esquemaDatos().tablas) {
      expect(tabla.descripcion.length, tabla.nombre).toBeGreaterThan(10);
      for (const c of tabla.columnas) {
        expect(['INTEGER', 'TEXT', 'REAL'], `${tabla.nombre}.${c.nombre}`).toContain(c.tipo);
        expect(c.significado.length, `${tabla.nombre}.${c.nombre}`).toBeGreaterThan(3);
      }
    }
  });

  it('las reglas citan constantes del código', () => {
    const texto = esquemaDatos().reglas.join('\n');

    for (const codigo of Object.values(CODIGO_F29)) expect(texto).toContain(`'${codigo}'`);
    expect(texto).toContain([...SOLO_RESUMEN_VENTA].join(', '));
    expect(texto).toContain(TIPOS_DOC_NEGATIVOS.join(', '));
    for (const [tipo, nombre] of Object.entries(NOMBRES_TIPO_DOCUMENTO)) expect(texto).toContain(`${tipo} ${nombre}`);
    for (const palabra of ['signo', 'REGISTRO', 'PENDIENTE', 'NO_INCLUIR', 'RECLAMADO', 'COMPRA', 'VENTA', 'AAAA-MM', 'sincronizacion']) {
      expect(texto).toContain(palabra);
    }
    expect(texto).toMatch(/Cobertura: solo el RCV.*F29/);
    expect(texto).toContain(`'${CODIGO_F29.TOTAL_CREDITOS}' menos ${CODIGOS_CREDITO_FUERA_RCV.map((c) => `'${c}'`).join(' y ')}`);
    // Igual que las reglas de IVA: en un F29 con valores leídos, el PDF compacto omite las líneas en cero y se guarda
    // cada línea con valor de la tabla; un total que falta junto a sus líneas es una lectura fallida.
    expect(texto).toMatch(/F29.*código ausente vale 0/);
    expect(texto).toContain('impuestocl guarda cada línea con valor de la tabla del formulario');
    const citar = (codigos: readonly string[]): string => codigos.map((c) => `'${c}'`).join(' + ');
    for (const [total, { suman, restan }] of Object.entries(LINEAS_DE_TOTALES)) {
      expect(texto).toContain(`'${total}' ausente vale 0 solo si ${citar(restan)} ≥ ${citar(suman)}`);
    }
    expect(texto).toContain("y no viene '511'");
    // Las fechas con hora no calzan con un BETWEEN de días: la regla debe enseñar a recortar.
    expect(texto).toContain('substr(');
    expect(texto).toMatch(/\bhora\b/);
  });

  it('las fechas con hora se filtran por día con substr, no con una comparación directa', async () => {
    const texto = esquemaDatos().reglas.join('\n');
    expect(texto).toContain("substr(fecha_recepcion, 1, 10) BETWEEN '2026-09-01' AND '2026-09-30'");

    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sembrarMes(store, '2026-09', {
      documentos: [
        documento({ folio: 1, fechaRecepcion: '2026-09-15 09:00:00' }),
        documento({ folio: 2, fechaRecepcion: '2026-09-30 10:00:00' }),
      ],
    });

    const directa = await consultaSql(deps, "SELECT folio FROM rcv_documento WHERE fecha_recepcion BETWEEN '2026-09-01' AND '2026-09-30' ORDER BY folio");
    const recortada = await consultaSql(deps, "SELECT folio FROM rcv_documento WHERE substr(fecha_recepcion, 1, 10) BETWEEN '2026-09-01' AND '2026-09-30' ORDER BY folio");
    const conDate = await consultaSql(deps, "SELECT folio FROM rcv_documento WHERE date(fecha_recepcion) BETWEEN '2026-09-01' AND '2026-09-30' ORDER BY folio");

    expect(directa.filas).toEqual([[1]]);
    expect(recortada.filas).toEqual([[1], [2]]);
    expect(conDate.filas).toEqual([[1], [2]]);
  });

  it('explica la declaración vigente del F29 con la misma regla que declaracionVigente', async () => {
    const texto = esquemaDatos().reglas.join('\n');
    expect(texto).toMatch(/folio > 0/);
    expect(texto).toMatch(/vigente/i);
    expect(texto).toMatch(/fecha_presentacion/);
    expect(texto).toMatch(/estado_id/);

    // La consulta de ejemplo de las reglas debe elegir lo mismo que declaracionVigente en los casos límite.
    const ejemplo = /`(SELECT[^`]*f29_declaracion[^`]*)`/.exec(texto)?.[1];
    expect(ejemplo).toBeDefined();
    const casos = {
      '2026-01': [declaracion({ periodo: '2026-01', folio: 10, estado: 'Vigente', fechaPresentacion: '2026-02-10' }), declaracion({ periodo: '2026-01', folio: 11, estado: 'Reemplazada', fechaPresentacion: '2026-02-20' })],
      '2026-02': [declaracion({ periodo: '2026-02', folio: 20, estado: 'Reemplazada', fechaPresentacion: '2026-03-10' }), declaracion({ periodo: '2026-02', folio: 21, estado: 'Rectificada', fechaPresentacion: '2026-03-15' })],
      '2026-03': [declaracion({ periodo: '2026-03', folio: 30, estado: 'Vigente', fechaPresentacion: '2026-04-10' }), declaracion({ periodo: '2026-03', folio: 31, estado: 'Vigente', fechaPresentacion: '2026-04-10' })],
      '2026-04': [declaracion({ periodo: '2026-04', folio: 0, estado: 'Guardada', fechaPresentacion: '2026-05-30' }), declaracion({ periodo: '2026-04', folio: 40, estado: 'Presentada', fechaPresentacion: null })],
      '2026-05': [declaracion({ periodo: '2026-05', folio: 0, estado: 'Vigente', fechaPresentacion: '2026-06-01' })],
      '2026-06': [declaracion({ periodo: '2026-06', folio: 50, estado: 'VIGENTE', fechaPresentacion: null }), declaracion({ periodo: '2026-06', folio: 51, estado: 'Presentada', fechaPresentacion: '2026-07-10' })],
      '2026-07': [declaracion({ periodo: '2026-07', folio: 60, estadoId: 1, estado: 'Presentada', fechaPresentacion: '2026-08-05' }), declaracion({ periodo: '2026-07', folio: 61, estadoId: 70, estado: 'Vigente', fechaPresentacion: '2026-08-12' })],
      '2026-08': [declaracion({ periodo: '2026-08', folio: 70, estadoId: 1, estado: 'Presentada', fechaPresentacion: '2026-09-05' }), declaracion({ periodo: '2026-08', folio: 71, estadoId: 10, estado: 'Vigente', fechaPresentacion: '2026-09-12' })],
      '2026-09': [declaracion({ periodo: '2026-09', folio: 80, estadoId: null, estado: 'Presentada', fechaPresentacion: '2026-10-05' }), declaracion({ periodo: '2026-09', folio: 81, estadoId: null, estado: 'Rechazada por pago inconcluso', fechaPresentacion: '2026-10-12' })],
    };
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    for (const [periodo, declaraciones] of Object.entries(casos)) sembrarMes(store, periodo, { declaraciones });

    for (const [periodo, declaraciones] of Object.entries(casos)) {
      const sql = ejemplo!.replaceAll('<RUT>', RUT_EMPRESA).replaceAll('<AAAA-MM>', periodo);
      const r = await consultaSql(deps, sql);
      const esperado = declaracionVigente(declaraciones)?.folio;
      expect(r.filas.map((f) => f[r.columnas.indexOf('folio')]), periodo).toEqual(esperado === undefined ? [] : [esperado]);
    }
  });
});
