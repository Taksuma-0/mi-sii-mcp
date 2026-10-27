import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';
import { esquemaDatos } from '../../src/app/consulta-libre.js';
import type { DepsApp } from '../../src/app/deps.js';
import { ErrorImpuestocl, type CodigoError } from '../../src/domain/errores.js';
import { crearServidorMcp, HERRAMIENTAS, INSTRUCCIONES_MCP, type OpcionesMcp } from '../../src/interfaces/mcp/servidor.js';
import { declaracion, fila, perfilEmpresa, resumen, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { depsDePrueba } from '../helpers/deps.js';
import { sembrarMes, T_SEMBRADO } from '../helpers/sembrar.js';

async function conectar(deps: DepsApp, opciones?: OpcionesMcp) {
  const servidor = crearServidorMcp(deps, '0.1.0-test', opciones);
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await servidor.connect(ladoServidor);
  const cliente = new Client({ name: 'prueba', version: '1.0.0' });
  await cliente.connect(ladoCliente);
  return cliente;
}

const textoDe = (r: unknown): string => (r as { content: { type: string; text: string }[] }).content[0]?.text ?? '';
const esError = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;

describe('servidor MCP', () => {
  it('expone exactamente las 10 herramientas, ninguna pide una clave y las consultas son de solo lectura', async () => {
    const cliente = await conectar(depsDePrueba().deps);
    const { tools } = await cliente.listTools();
    expect(tools).toHaveLength(10);
    expect(tools.map((t) => t.name).sort()).toEqual([...HERRAMIENTAS].sort());
    expect(JSON.stringify(tools.map((t) => t.inputSchema)).toLowerCase()).not.toMatch(/clave|password|contrase/);
    expect(tools.find((t) => t.name === 'iva_resumen')?.annotations?.readOnlyHint).toBe(true);
    for (const nombre of ['consulta_sql', 'datos_esquema']) {
      expect(tools.find((t) => t.name === nombre)?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    }
    const panorama = tools.find((t) => t.name === 'sii_panorama');
    expect(panorama?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(panorama?.inputSchema).toMatchObject({ properties: { rut: expect.any(Object) }, required: ['rut'] });
    expect(Object.keys(panorama?.inputSchema.properties ?? {})).toEqual(['rut']);
    expect(panorama?.description).toMatch(/no requiere.*período/i);
    expect(panorama?.description).toMatch(/no descarga/i);
    expect(panorama?.description).toMatch(/almacenad[oa]s? local/i);
    expect(tools.find((t) => t.name === 'sincronizar')?.annotations?.readOnlyHint).toBe(false);
    await cliente.close();
  });

  it('sii_panorama responde sin elegir un período con cobertura breve y JSON del panorama local', async () => {
    const { deps, store, sii } = depsDePrueba({ fallaAlAbrir: new Error('No debe abrir el SII') });
    store.guardarContribuyente(perfilEmpresa());
    sembrarMes(store, '2026-09', { resumenes: [resumen()] });
    sembrarMes(store, '2000-01');
    const cliente = await conectar(deps);

    const r = await cliente.callTool({ name: 'sii_panorama', arguments: { rut: '22.222.222-2' } });

    expect(esError(r)).toBe(false);
    const texto = textoDe(r);
    expect(texto.split('\n\n')[0]).toBe('Panorama local: 2 meses. Fuentes: RCV (compras y ventas) y F29. Cobertura: ventas 2/2, compras 2/2 y F29 2/2 meses consultados.');
    const datos = JSON.parse(texto.slice(texto.indexOf('\n\n') + 2));
    expect(datos.perfil).toEqual(perfilEmpresa());
    expect(datos.periodos.map((p: { periodo: string }) => p.periodo)).toEqual(['2000-01', '2026-09']);
    expect(datos.totales.ventas).toEqual({ monto: 1_190_000, mesesConDatos: 2, mesesSinDatos: 0 });
    expect(sii.llamadas).toEqual([]);
    await cliente.close();
  });

  it('sii_panorama cuenta la cobertura consultada de cada fuente aunque no haya importes', async () => {
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sembrarMes(store, '2026-08', { sinF29: true });
    const id = store.iniciarSincronizacion(RUT_EMPRESA, 'rcv.VENTA', '2026-09', T_SEMBRADO);
    store.reemplazarRcv(id, RUT_EMPRESA, '2026-09', 'VENTA', [], [], T_SEMBRADO);
    store.terminarSincronizacion(id, T_SEMBRADO, 'ok');
    const cliente = await conectar(deps);

    const r = await cliente.callTool({ name: 'sii_panorama', arguments: { rut: RUT_EMPRESA } });

    expect(textoDe(r).split('\n\n')[0]).toBe('Panorama local: 2 meses. Fuentes: RCV (compras y ventas) y F29. Cobertura: ventas 2/2, compras 1/2 y F29 0/2 meses consultados.');
    await cliente.close();
  });

  it('sii_panorama muestra cobertura 0/0 cuando no hay meses almacenados', async () => {
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    const cliente = await conectar(deps);

    const r = await cliente.callTool({ name: 'sii_panorama', arguments: { rut: RUT_EMPRESA } });

    expect(textoDe(r).split('\n\n')[0]).toBe('Panorama local: 0 meses. Fuentes: RCV (compras y ventas) y F29. Cobertura: ventas 0/0, compras 0/0 y F29 0/0 meses consultados.');
    await cliente.close();
  });

  it('sii_panorama devuelve el error de dominio cuando el perfil no existe', async () => {
    const cliente = await conectar(depsDePrueba().deps);
    const r = await cliente.callTool({ name: 'sii_panorama', arguments: { rut: RUT_EMPRESA } });
    expect(esError(r)).toBe(true);
    expect(textoDe(r)).toContain('PERFIL_NO_EXISTE');
    await cliente.close();
  });

  it('iva_resumen responde con el texto del resumen y los datos', async () => {
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sembrarMes(store, '2026-09', { resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000, 2)] })], declaraciones: [declaracion()], valores: [valores({ '538': 190_000, '537': 0 })] });
    const cliente = await conectar(deps);
    const r = await cliente.callTool({ name: 'iva_resumen', arguments: { rut: '22.222.222-2', periodo: '2026-09' } });
    expect(esError(r)).toBe(false);
    expect(textoDe(r)).toContain('IVA 2026-09 — 22222222-2');
    expect(textoDe(r)).toContain('"debitoRcv": 190000');
    await cliente.close();
  });

  it('un error de dominio vuelve como resultado de error de la herramienta', async () => {
    const cliente = await conectar(depsDePrueba().deps);
    const r = await cliente.callTool({ name: 'iva_resumen', arguments: { rut: RUT_EMPRESA, periodo: '2026-09' } });
    expect(esError(r)).toBe(true);
    expect(textoDe(r)).toContain('PERFIL_NO_EXISTE');
    await cliente.close();
  });

  it('valida el formato del período', async () => {
    const cliente = await conectar(depsDePrueba().deps);
    const r = await cliente.callTool({ name: 'iva_resumen', arguments: { rut: RUT_EMPRESA, periodo: '2026-9' } });
    expect(esError(r)).toBe(true);
    await cliente.close();
  });

  it('sincronizar usa el lector del SII y resume lo traído', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sii.declaraciones.set('2026-09', []);
    const cliente = await conectar(deps);
    const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: RUT_EMPRESA, desde: '2026-09' } });
    expect(textoDe(r)).toContain('Sincronización 22222222-2');
    expect(sii.llamadas).toContain('f29|2026-09');
    await cliente.close();
  });

  describe('reintento', () => {
    it('un error de la herramienta que conviene reintentar más tarde lo dice', async () => {
      const { deps, store } = depsDePrueba({ fallaAlAbrir: new ErrorImpuestocl('SII_NO_DISPONIBLE', 'El SII no responde.') });
      store.guardarContribuyente(perfilEmpresa());
      const cliente = await conectar(deps);
      const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: RUT_EMPRESA, desde: '2026-09' } });
      expect(esError(r)).toBe(true);
      expect(textoDe(r)).toContain('Reintentar: más tarde');
      await cliente.close();
    });

    it('un error que pide corregir algo dice que no se reintente igual', async () => {
      const cliente = await conectar(depsDePrueba().deps);
      const r = await cliente.callTool({ name: 'iva_resumen', arguments: { rut: RUT_EMPRESA, periodo: '2026-09' } });
      expect(textoDe(r)).toMatch(/Reintentar: no \(/);
      await cliente.close();
    });

    it('un error de consulta interrumpida se reintenta ahora mismo', async () => {
      const { deps, store } = depsDePrueba({ fallaAlAbrir: new ErrorImpuestocl('CONSULTA_INTERRUMPIDA', 'Tardó demasiado.') });
      store.guardarContribuyente(perfilEmpresa());
      const cliente = await conectar(deps);
      const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: RUT_EMPRESA, desde: '2026-09' } });
      expect(textoDe(r)).toContain('Reintentar: ahora mismo');
      await cliente.close();
    });

    it('sincronizar lista los meses con errores reintentables más tarde', async () => {
      const { deps, store, sii } = depsDePrueba();
      store.guardarContribuyente(perfilEmpresa());
      sii.fallas.set('f29|2026-10', new ErrorImpuestocl('SII_NO_DISPONIBLE', 'No responde.'));
      sii.fallas.set('f29|2026-09', new ErrorImpuestocl('PORTAL_CAMBIO', 'Cambió.'));
      const cliente = await conectar(deps);
      const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: RUT_EMPRESA, desde: '2026-09', hasta: '2026-10', superficies: ['f29'] } });
      const texto = textoDe(r);
      expect(texto).toContain('Reintentables más tarde: 2026-10 (f29 SII_NO_DISPONIBLE)');
      expect(texto).not.toContain('2026-09 (f29');
      await cliente.close();
    });

    it.each(['SII_EN_ESPERA', 'SII_SESIONES_MAXIMAS'] as const)('sincronizar detenida por %s dice que se reintente más tarde', async (codigo) => {
      const { deps, store } = depsDePrueba({ fallaAlAbrir: new ErrorImpuestocl(codigo, 'Hay que esperar.') });
      store.guardarContribuyente(perfilEmpresa());
      const cliente = await conectar(deps);
      const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: RUT_EMPRESA, desde: '2026-09' } });
      const texto = textoDe(r);
      expect(texto).toContain(`Sincronización detenida: [${codigo}]`);
      expect(texto).toContain('Reintentar: más tarde');
      await cliente.close();
    });

    it('sincronizar detenida por una clave rechazada no sugiere reintentar', async () => {
      const { deps, store } = depsDePrueba({ fallaAlAbrir: new ErrorImpuestocl('CLAVE_RECHAZADA', 'Clave mala.') });
      store.guardarContribuyente(perfilEmpresa());
      const cliente = await conectar(deps);
      const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: RUT_EMPRESA, desde: '2026-09' } });
      expect(textoDe(r)).not.toContain('Reintentar');
      await cliente.close();
    });

    it('sincronizar sin errores reintentables no agrega la línea', async () => {
      const { deps, store, sii } = depsDePrueba();
      store.guardarContribuyente(perfilEmpresa());
      sii.declaraciones.set('2026-09', []);
      const cliente = await conectar(deps);
      const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: RUT_EMPRESA, desde: '2026-09' } });
      expect(textoDe(r)).not.toContain('Reintentables');
      await cliente.close();
    });
  });

  it('sincronizar se detiene entre meses cuando el cliente cancela y conserva lo traído', async () => {
    const { deps, store, sii, persistidos } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sii.declaraciones.set('2026-09', [declaracion()]);
    sii.valores.set('2026-09|555001', valores({ '538': 190_000 }));
    const cancelar = new AbortController();
    sii.alLlamar = async (llamada) => {
      if (llamada !== 'f29valores|2026-09|555001') return;
      cancelar.abort();
      // Deja que la cancelación (notifications/cancelled) llegue al servidor antes de responder.
      await new Promise((r) => setTimeout(r, 0));
    };
    const cliente = await conectar(deps);

    const llamada = cliente.callTool({ name: 'sincronizar', arguments: { rut: RUT_EMPRESA, desde: '2026-09', hasta: '2026-12' } }, { signal: cancelar.signal });

    await expect(llamada).rejects.toThrow();
    await vi.waitFor(() => expect(persistidos).toEqual([RUT_EMPRESA]));
    expect(sii.llamadas.filter((l) => !l.includes('2026-09'))).toEqual([]);
    expect(store.valoresF29(RUT_EMPRESA, '2026-09', 555_001)?.valores['538']).toBe(190_000);
    await cliente.close();
  });

  it('entrega instrucciones de servidor breves con el flujo de uso y la cobertura', async () => {
    const cliente = await conectar(depsDePrueba().deps);
    const instrucciones = cliente.getInstructions() ?? '';
    expect(instrucciones).toBe(INSTRUCCIONES_MCP);
    expect(instrucciones.length).toBeGreaterThan(0);
    expect(instrucciones.length).toBeLessThanOrEqual(1_500);
    for (const clave of ['perfiles_listar', 'sii_panorama', 'sincronizar', '12 meses', 'iva_resumen', 'iva_hallazgos', 'f29_historial', 'plazos_proximos', 'datos_esquema', 'consulta_sql', 'SESION_REQUERIDA', 'Abrir impuestocl.cmd', 'RCV', 'F29']) {
      expect(instrucciones).toContain(clave);
    }
    expect(instrucciones).toMatch(/nunca pidas la clave/i);
    expect(instrucciones).toMatch(/no es asesoría tributaria/i);
    await cliente.close();
  });

  describe('consulta_sql', () => {
    it('responde un texto breve y el JSON compacto { columnas, filas, truncado }', async () => {
      const { deps, store } = depsDePrueba();
      store.guardarContribuyente(perfilEmpresa());
      sembrarMes(store, '2026-09', { resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 100_000, 19_000), fila(61, 10_000, 1_900), fila(39, 5_000, 950)] })] });
      const cliente = await conectar(deps);

      const r = await cliente.callTool({ name: 'consulta_sql', arguments: { sql: 'SELECT tipo_doc, signo FROM rcv_resumen ORDER BY tipo_doc' } });

      expect(esError(r)).toBe(false);
      const texto = textoDe(r);
      expect(texto.split('\n\n')[0]).toBe('3 filas');
      const json = texto.slice(texto.indexOf('\n\n') + 2);
      expect(json).not.toContain('\n');
      expect(JSON.parse(json)).toEqual({ columnas: ['tipo_doc', 'signo'], filas: [[33, 1], [39, 1], [61, -1]], truncado: false });
      await cliente.close();
    });

    it('dice «1 fila» en singular', async () => {
      const cliente = await conectar(depsDePrueba().deps);
      const r = await cliente.callTool({ name: 'consulta_sql', arguments: { sql: 'SELECT 1 AS n' } });
      expect(textoDe(r).split('\n\n')[0]).toBe('1 fila');
      await cliente.close();
    });

    it('avisa cuando recorta el resultado', async () => {
      const cliente = await conectar(depsDePrueba().deps);
      const sql = 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 250) SELECT i FROM n';

      const r = await cliente.callTool({ name: 'consulta_sql', arguments: { sql } });

      expect(esError(r)).toBe(false);
      const texto = textoDe(r);
      expect(texto.split('\n\n')[0]).toMatch(/recortado.*primeras 200 filas.*LIMIT/i);
      const datos = JSON.parse(texto.slice(texto.indexOf('\n\n') + 2));
      expect(datos.truncado).toBe(true);
      expect(datos.filas).toHaveLength(200);
      await cliente.close();
    });

    it('devuelve un error accionable cuando la sentencia no es una consulta de lectura', async () => {
      const { deps, store } = depsDePrueba();
      store.guardarContribuyente(perfilEmpresa());
      const cliente = await conectar(deps);

      const r = await cliente.callTool({ name: 'consulta_sql', arguments: { sql: 'DELETE FROM contribuyente' } });

      expect(esError(r)).toBe(true);
      expect(textoDe(r)).toContain('CONSULTA_RECHAZADA');
      expect(textoDe(r)).toContain('datos_esquema');
      expect(store.contribuyente(RUT_EMPRESA)).not.toBeNull();
      await cliente.close();
    });

    it('describe los límites de la respuesta y pide leer antes datos_esquema', async () => {
      const cliente = await conectar(depsDePrueba().deps);
      const { tools } = await cliente.listTools();
      const descripcion = tools.find((t) => t.name === 'consulta_sql')?.description ?? '';
      expect(descripcion).toContain('datos_esquema');
      expect(descripcion).toContain('200 filas');
      expect(descripcion).toMatch(/solo lectura/i);
      await cliente.close();
    });
  });

  describe('datos_esquema', () => {
    it('lista las 8 tablas con sus columnas y las reglas de interpretación', async () => {
      const cliente = await conectar(depsDePrueba().deps);

      const r = await cliente.callTool({ name: 'datos_esquema', arguments: {} });

      expect(esError(r)).toBe(false);
      const texto = textoDe(r);
      const datos = JSON.parse(texto.slice(texto.indexOf('\n\n') + 2));
      expect(datos.tablas.map((t: { nombre: string }) => t.nombre)).toEqual(['contribuyente', 'rcv_resumen', 'rcv_documento', 'f29_declaracion', 'f29_valor', 'f29_lectura', 'hallazgo', 'sincronizacion']);
      expect(datos).toEqual(JSON.parse(JSON.stringify(esquemaDatos())));
      expect(texto.split('\n\n')[0]).toContain('8 tablas');
      await cliente.close();
    });

    it('solo menciona herramientas que existen', () => {
      const esquema = esquemaDatos();
      // Palabras en snake_case que el texto usa y que no son herramientas: tablas, columnas y valores de columnas.
      const propios = new Set(['en_curso', ...esquema.tablas.flatMap((t) => [t.nombre, ...t.columnas.map((c) => c.nombre)])]);
      const textos = [...esquema.tablas.flatMap((t) => [t.descripcion, ...t.columnas.map((c) => c.significado)]), ...esquema.reglas];
      const mencionadas = new Set(textos.flatMap((t) => t.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []).filter((nombre) => !propios.has(nombre)));

      expect(mencionadas).toContain('iva_resumen');
      expect(mencionadas).toContain('iva_hallazgos');
      for (const nombre of mencionadas) {
        expect(HERRAMIENTAS, `«${nombre}» aparece en datos_esquema y no es una herramienta ni una tabla o columna`).toContain(nombre);
      }
    });
  });

  describe('comando de login', () => {
    const LOGIN = { comandoLogin: (rut: string) => `LOGIN ${rut}` };

    it.each<CodigoError>(['SESION_REQUERIDA', 'CLAVE_RECHAZADA', 'RUT_BLOQUEADO_LOCAL'])('sincronizar detenida por %s muestra el comando de login real', async (codigo) => {
      const { deps, store } = depsDePrueba({ fallaAlAbrir: new ErrorImpuestocl(codigo, 'Falla de sesión simulada.') });
      store.guardarContribuyente(perfilEmpresa());
      const cliente = await conectar(deps, LOGIN);

      const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: '22.222.222-2', desde: '2026-09' } });

      const texto = textoDe(r);
      expect(texto).toContain(`[${codigo}]`);
      expect(texto).toContain('LOGIN 22222222-2');
      expect(texto).toContain('Abrir impuestocl.cmd');
      expect(texto).toMatch(/nunca pidas la clave en el chat/i);
      expect(texto).not.toContain('impuestocl login');
      await cliente.close();
    });

    it('sin opciones usa impuestocl login con --guardar-clave', async () => {
      const { deps, store } = depsDePrueba({ fallaAlAbrir: new ErrorImpuestocl('SESION_REQUERIDA', 'Sin sesión.') });
      store.guardarContribuyente(perfilEmpresa());
      const cliente = await conectar(deps);

      const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: RUT_EMPRESA, desde: '2026-09' } });

      expect(textoDe(r)).toContain('`impuestocl login 22222222-2 --guardar-clave`');
      await cliente.close();
    });

    it('perfiles_listar sin perfiles guía al login y no cita comandos que no están en el PATH', async () => {
      const cliente = await conectar(depsDePrueba().deps, LOGIN);

      const r = await cliente.callTool({ name: 'perfiles_listar', arguments: {} });

      expect(esError(r)).toBe(false);
      const texto = textoDe(r);
      expect(texto).toContain('LOGIN <rut>');
      expect(texto).toContain('Abrir impuestocl.cmd');
      expect(texto).toMatch(/nunca pidas la clave en el chat/i);
      expect(texto).not.toContain('impuestocl perfil');
      await cliente.close();
    });

    it.each(['sii_panorama', 'iva_resumen', 'sincronizar'])('%s con un RUT sin perfil guía al login con ese RUT', async (herramienta) => {
      const cliente = await conectar(depsDePrueba().deps, LOGIN);

      const r = await cliente.callTool({ name: herramienta, arguments: { rut: '22.222.222-2', periodo: '2026-09', desde: '2026-09' } });

      expect(esError(r)).toBe(true);
      const texto = textoDe(r);
      expect(texto).toContain('[PERFIL_NO_EXISTE]');
      expect(texto).toContain('LOGIN 22222222-2');
      expect(texto).toMatch(/crea su perfil/);
      expect(texto).toMatch(/nunca pidas la clave en el chat/i);
      expect(texto).not.toContain('impuestocl perfil');
      expect(texto).not.toContain('Acción sugerida');
      await cliente.close();
    });

    it('sincronizar con un SIN_PERMISO lanzado al abrir el SII muestra la guía de login', async () => {
      const { deps, store } = depsDePrueba({ fallaAlAbrir: new ErrorImpuestocl('SIN_PERMISO', 'Sin acceso a ese RUT.') });
      store.guardarContribuyente(perfilEmpresa());
      const cliente = await conectar(deps, LOGIN);

      const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: '22.222.222-2', desde: '2026-09' } });

      expect(esError(r)).toBe(true);
      const texto = textoDe(r);
      expect(texto).toContain('[SIN_PERMISO]');
      expect(texto).toContain('LOGIN 22222222-2');
      expect(texto).toMatch(/clave de ese contribuyente/);
      expect(texto).not.toContain('Acción sugerida');
      await cliente.close();
    });

    it('sincronizar con SIN_PERMISO en un período (error no fatal) agrega la guía de login una sola vez', async () => {
      const { deps, store, sii } = depsDePrueba();
      store.guardarContribuyente(perfilEmpresa());
      sii.fallas.set('f29|2026-09', new ErrorImpuestocl('SIN_PERMISO', 'F29: no está autorizado.'));
      sii.fallas.set('f29|2026-10', new ErrorImpuestocl('SIN_PERMISO', 'F29: no está autorizado.'));
      const cliente = await conectar(deps, LOGIN);

      const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: '22.222.222-2', desde: '2026-09', hasta: '2026-10' } });

      const texto = textoDe(r);
      expect(texto).toContain('f29 SIN_PERMISO');
      expect(texto.split('LOGIN 22222222-2')).toHaveLength(2);
      expect(texto).toMatch(/clave de ese contribuyente/);
      expect(texto).not.toContain('impuestocl login');
      await cliente.close();
    });

    it('una sincronización sin problemas de sesión no agrega el comando', async () => {
      const { deps, store, sii } = depsDePrueba();
      store.guardarContribuyente(perfilEmpresa());
      sii.declaraciones.set('2026-09', []);
      const cliente = await conectar(deps, LOGIN);

      const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: RUT_EMPRESA, desde: '2026-09' } });

      expect(textoDe(r)).not.toContain('LOGIN');
      await cliente.close();
    });

    it('la descripción de sincronizar recomienda tramos de 12 meses y el máximo de 120', async () => {
      const cliente = await conectar(depsDePrueba().deps);
      const { tools } = await cliente.listTools();
      const descripcion = tools.find((t) => t.name === 'sincronizar')?.description ?? '';
      expect(descripcion).toMatch(/120 meses/);
      expect(descripcion).toMatch(/tramos de 12 meses/);
      expect(descripcion).toContain('Abrir impuestocl.cmd');
      expect(descripcion).not.toContain('impuestocl login');
      await cliente.close();
    });
  });
});
