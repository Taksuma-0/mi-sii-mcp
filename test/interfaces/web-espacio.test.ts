import { afterEach, describe, expect, it, vi } from 'vitest';
import * as syncApp from '../../src/app/sincronizar.js';
import { crearEspacioLocal } from '../../src/interfaces/web/espacio.js';
import { errorPublico, SecretosNulos, type FabricaContenedorWeb } from '../../src/interfaces/web/verificar.js';
import { ErrorMiSiiMcp, type CodigoError } from '../../src/domain/errores.js';
import { resumenIva } from '../../src/app/consultas.js';
import type { SecretStore } from '../../src/ports/index.js';
import { depsDePrueba } from '../helpers/deps.js';
import { documento, fila, perfilEmpresa, resumen } from '../helpers/fabricas.js';
import { sembrarMes } from '../helpers/sembrar.js';

class SecretosEnMemoria implements SecretStore {
  readonly claves = new Map<string, string>();
  async obtener(rut: string): Promise<string | null> { return this.claves.get(rut) ?? null; }
  async guardar(rut: string, clave: string): Promise<void> { this.claves.set(rut, clave); }
  async borrar(rut: string): Promise<void> { this.claves.delete(rut); }
}

const entrada = { rut: '22.222.222-2', clave: ' ficticia con espacios ' };
const rango = { desde: '2026-08', hasta: '2026-09' };
const cierres: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const cerrar of cierres.splice(0)) cerrar(); });

function entorno() {
  const p = depsDePrueba();
  cierres.push(() => p.db.close());
  const cerrar = vi.fn();
  const loginInteractivo = vi.fn(async (rut: string, _clave: string, _guardar: boolean) => ({
    identidad: { rut, nombre: 'Empresa de prueba', razonSocial: 'EMPRESA DEMO SPA', tipo: 'empresa' as const }, claveGuardada: false,
  }));
  const loginNavegador = vi.fn(async (_rut?: string) => ({ rut: '22222222-2', nombre: 'Empresa de prueba', razonSocial: 'EMPRESA DEMO SPA', tipo: 'empresa' as const }));
  const fabrica: FabricaContenedorWeb = vi.fn(() => ({ deps: p.deps, sesiones: { loginInteractivo, loginNavegador }, cerrar }));
  // Nunca el Credential Manager real.
  const llavero = new SecretosEnMemoria();
  return { ...p, fabrica, cerrar, loginInteractivo, loginNavegador, llavero, espacio: crearEspacioLocal(fabrica, llavero) };
}

describe('cartolas desde la página', () => {
  it('importa la cartola subida a la cuenta del contexto y devuelve el resumen en texto', async () => {
    const e = entorno();
    const { contexto } = await e.espacio.conectar(entrada);
    const csv = ['Fecha;Descripción;Cargos;Abonos;Saldo', '02/10/2026;TRANSFERENCIA;;1.000;11.000', '03/10/2026;PAGO;500;;10.500'].join('\n');

    const r = await e.espacio.importarCartola(contexto, { nombre: 'octubre.csv', contenido: Buffer.from(csv).toString('base64'), cuenta: 'corriente' });

    expect(r.importacion).toMatchObject({ rut: '22222222-2', cuenta: 'corriente', archivo: 'octubre.csv', nuevos: 2, saldoCuadra: true });
    expect(r.texto).toContain('Cartola octubre.csv en la cuenta corriente');
    expect(e.store.movimientosBanco('22222222-2')).toHaveLength(2);
  });

  it('rechaza una cartola sin contexto o de más de 5 MB', async () => {
    const e = entorno();
    await expect(e.espacio.importarCartola('sin-contexto', { nombre: 'a.csv', contenido: 'YQ==' })).rejects.toMatchObject({ codigo: 'SESION_REQUERIDA' });
    const { contexto } = await e.espacio.conectar(entrada);
    const grande = Buffer.alloc(5 * 1024 * 1024 + 1, 'a').toString('base64');
    await expect(e.espacio.importarCartola(contexto, { nombre: 'a.csv', contenido: grande })).rejects.toMatchObject({ codigo: 'ARCHIVO_INVALIDO' });
  });
});

describe('espacio local por contexto', () => {
  it('explica períodos inválidos sin excluir enero de 2000 del espacio', () => {
    expect(errorPublico(new ErrorMiSiiMcp('PERIODO_INVALIDO', '')).mensaje).not.toContain('posterior a enero de 2000');
  });
  it.each<CodigoError>(['SII_LIMITE', 'SII_SESIONES_MAXIMAS', 'RESPUESTA_VACIA', 'DATOS_INCOMPLETOS', 'LECTURA_INCOHERENTE', 'RESPALDO_FALLIDO'])('%s tiene un mensaje público propio sin texto del SII', (codigo) => {
    const r = errorPublico(new ErrorMiSiiMcp(codigo, 'Texto interno del SII que no debe salir.'));
    expect(r.codigo).toBe(codigo);
    expect(r.mensaje.length).toBeGreaterThan(20);
    expect(r.mensaje).not.toContain('Texto interno');
  });
  it('conecta una vez sin sincronizar ni conciliar y conserva el perfil local', async () => {
    const e = entorno();
    expect(e.fabrica).not.toHaveBeenCalled();
    e.store.guardarContribuyente(perfilEmpresa({ alias: 'Alias propio', tipo: 'persona', representa: ['11111111-1'] }));
    sembrarMes(e.store, '2026-09', { resumenes: [resumen()] });
    const conciliar = vi.spyOn(e.store, 'reemplazarHallazgos');
    const r = await e.espacio.conectar(entrada);
    expect(e.loginInteractivo).toHaveBeenCalledExactlyOnceWith('22222222-2', entrada.clave, false);
    expect(e.fabrica).toHaveBeenCalledWith({ secretos: expect.any(SecretosNulos) });
    expect(r.contexto).toMatch(/^[a-f0-9]{64}$/);
    expect(r.panorama.perfil).toMatchObject({ rut: '22222222-2', alias: 'Alias propio', tipo: 'persona', representa: ['11111111-1'] });
    expect(r.panorama.periodos).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain(entrada.clave);
    expect(e.sii.llamadas).toEqual([]);
    expect(conciliar).not.toHaveBeenCalled();
    expect(e.cerrar).toHaveBeenCalledOnce();
    expect(await e.espacio.panorama(r.contexto)).toEqual(r.panorama);
    expect(e.fabrica).toHaveBeenCalledTimes(2);
    expect(e.cerrar).toHaveBeenCalledTimes(2);
    expect(e.loginInteractivo).toHaveBeenCalledOnce();
  });

  it('con recordar entra con el llavero del sistema y pide guardar la clave', async () => {
    const e = await entorno();
    e.loginInteractivo.mockResolvedValueOnce({ identidad: { rut: '22222222-2', nombre: 'Empresa de prueba', razonSocial: 'EMPRESA DEMO SPA', tipo: 'empresa' }, claveGuardada: true });
    const r = await e.espacio.conectar({ ...entrada, recordar: true });
    expect(e.loginInteractivo).toHaveBeenCalledExactlyOnceWith('22222222-2', entrada.clave, true);
    expect(e.fabrica).toHaveBeenCalledExactlyOnceWith({ secretos: e.llavero });
    expect(r.recordada).toBe(true);
    expect(JSON.stringify(r)).not.toContain(entrada.clave);
  });

  it('sin recordar no toca el llavero e informa que la clave no quedó guardada', async () => {
    const e = entorno();
    const r = await e.espacio.conectar({ ...entrada, recordar: false });
    expect(e.loginInteractivo).toHaveBeenCalledExactlyOnceWith('22222222-2', entrada.clave, false);
    expect(e.fabrica).toHaveBeenCalledWith({ secretos: expect.any(SecretosNulos) });
    expect(r.recordada).toBe(false);
  });

  it('lista las cuentas locales con su sesión, sin cookies ni claves', async () => {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa({ alias: 'Alias propio' }));
    e.store.guardarContribuyente(perfilEmpresa({ rut: '11111111-1', alias: 'Persona', razonSocial: null, tipo: 'persona' }));
    await e.llavero.guardar('22222222-2', 'clave ficticia');
    const cuentas = await e.espacio.cuentas();
    expect(cuentas).toHaveLength(2);
    const empresa = cuentas.find(c => c.rut === '22222222-2');
    expect(empresa).toMatchObject({ conectada: expect.any(Boolean), bloqueada: false, renuevaSola: true });
    expect(cuentas.find(c => c.rut === '11111111-1')).toMatchObject({ nombre: 'Persona', renuevaSola: false });
    expect(JSON.stringify(cuentas)).not.toContain('clave ficticia');
    expect(e.sii.llamadas).toEqual([]);
  });

  it('conecta con el navegador: registra la identidad y abre su espacio sin pedir clave', async () => {
    const e = entorno();
    const r = await e.espacio.conectarNavegador({});
    expect(e.loginNavegador).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(e.loginInteractivo).not.toHaveBeenCalled();
    expect(e.fabrica).toHaveBeenCalledWith({ secretos: expect.any(SecretosNulos) });
    expect(r.contexto).toMatch(/^[a-f0-9]{64}$/);
    expect(r.panorama.perfil).toMatchObject({ rut: '22222222-2', razonSocial: 'EMPRESA DEMO SPA' });
    expect(e.store.contribuyente('22222222-2')).not.toBeNull();
    expect(e.cerrar).toHaveBeenCalledOnce();
    expect(await e.espacio.panorama(r.contexto)).toEqual(r.panorama);
  });

  it('conecta con el navegador esperando el RUT indicado, validado antes de abrir nada', async () => {
    const e = entorno();
    await e.espacio.conectarNavegador({ rut: '22.222.222-2' });
    expect(e.loginNavegador).toHaveBeenCalledExactlyOnceWith('22222222-2');
    await expect(e.espacio.conectarNavegador({ rut: 'invalido' })).rejects.toMatchObject({ codigo: 'RUT_INVALIDO' });
    expect(e.fabrica).toHaveBeenCalledOnce();
  });

  it.each([{ ...entrada, rut: 'invalido' }, { ...entrada, clave: '' }])('valida acceso antes del contenedor: %j', async (valor) => {
    const e = entorno();
    await expect(e.espacio.conectar(valor)).rejects.toThrow();
    expect(e.fabrica).not.toHaveBeenCalled();
  });

  it('cierra el contenedor tras fallar login o lectura sin entregar un contexto', async () => {
    const e = entorno();
    e.loginInteractivo.mockRejectedValueOnce(new ErrorMiSiiMcp('CLAVE_RECHAZADA', entrada.clave));
    await expect(e.espacio.conectar(entrada)).rejects.toMatchObject({ codigo: 'CLAVE_RECHAZADA' });
    expect(e.store.contribuyentes()).toEqual([]);
    expect(e.cerrar).toHaveBeenCalledOnce();
    const { contexto } = await e.espacio.conectar(entrada);
    vi.spyOn(e.store, 'periodosConDatos').mockImplementation(() => { throw new Error('falla local ficticia'); });
    await expect(e.espacio.panorama(contexto)).rejects.toThrow('falla local ficticia');
    await expect(e.espacio.conectar(entrada)).rejects.toThrow('falla local ficticia');
    expect(e.cerrar).toHaveBeenCalledTimes(4);
  });

  it('aísla RUT y contextos entre pestañas e instancias e invalida sólo uno', async () => {
    const e = entorno();
    const a = await e.espacio.conectar(entrada);
    const b = await e.espacio.conectar({ rut: '11111111-1', clave: 'ficticia' });
    expect(a.contexto).not.toBe(b.contexto);
    expect((await e.espacio.panorama(a.contexto)).perfil.rut).toBe('22222222-2');
    expect((await e.espacio.panorama(b.contexto)).perfil.rut).toBe('11111111-1');
    const otra = crearEspacioLocal(e.fabrica);
    const llamadas = vi.mocked(e.fabrica).mock.calls.length;
    await expect(otra.panorama(a.contexto)).rejects.toMatchObject({ codigo: 'SESION_REQUERIDA' });
    await e.espacio.desconectar(a.contexto);
    await expect(e.espacio.panorama(a.contexto)).rejects.toMatchObject({ codigo: 'SESION_REQUERIDA' });
    expect(e.fabrica).toHaveBeenCalledTimes(llamadas);
    expect((await e.espacio.panorama(b.contexto)).perfil.rut).toBe('11111111-1');
    expect(e.store.contribuyentes()).toHaveLength(2);
    expect(e.sii.llamadas).toEqual([]);
  });

  it('rechaza contexto desconocido en cada operación antes de crear recursos', async () => {
    const e = entorno();
    for (const operacion of [
      () => e.espacio.panorama(''), () => e.espacio.sincronizar('ajeno', rango),
      () => e.espacio.analizar('ajeno', rango), () => e.espacio.documentos('ajeno', { periodo: '2026-09' }),
      () => e.espacio.desconectar('ajeno'),
    ]) await expect(operacion()).rejects.toMatchObject({ codigo: 'SESION_REQUERIDA' });
    expect(e.fabrica).not.toHaveBeenCalled();
  });

  it.each([
    { desde: '2026-99', hasta: '2026-09' }, { desde: '2026-09', hasta: '2026-08' },
    { desde: '2000-01', hasta: '2010-01' },
  ])('valida rango de sincronización y análisis antes de fabricar: %j', async (valor) => {
    const e = entorno(); const { contexto } = await e.espacio.conectar(entrada);
    await expect(e.espacio.sincronizar(contexto, valor)).rejects.toMatchObject({ codigo: 'PERIODO_INVALIDO' });
    await expect(e.espacio.analizar(contexto, valor)).rejects.toMatchObject({ codigo: 'PERIODO_INVALIDO' });
    expect(e.fabrica).toHaveBeenCalledOnce();
  });

  it.each([[], ['otra'], ['rcv', 'f29', 'rcv'], null, 'rcv', {}, Array(1)].map(superficies => ({ superficies })))('rechaza fuentes inválidas antes de fabricar: %j', async ({ superficies }) => {
    const e = entorno(); const { contexto } = await e.espacio.conectar(entrada);
    await expect(e.espacio.sincronizar(contexto, { ...rango, superficies: superficies as ('rcv' | 'f29')[] })).rejects.toThrow();
    expect(e.fabrica).toHaveBeenCalledOnce();
  });

  it('sincroniza varios meses y ambas fuentes por defecto sin otro login', async () => {
    const e = entorno(); const { contexto } = await e.espacio.conectar(entrada);
    const r = await e.espacio.sincronizar(contexto, rango);
    expect(r.estado).toBe('completo');
    expect(e.sii.llamadas).toContain('f29|2026-08');
    expect(e.sii.llamadas).toContain('f29|2026-09');
    expect(e.sii.llamadas).toContain('resumen|2026-09|COMPRA|REGISTRO');
    expect(r.panorama.periodos.map(p => p.ventas)).toEqual([0, 0]);
    expect(r.panorama.periodos.map(p => p.disponibilidad)).toEqual(Array(2).fill({ ventasRcv: true, comprasRcv: true, f29: true, propuestaF29: false, bheRecibidas: false }));
    expect(e.loginInteractivo).toHaveBeenCalledOnce();
    expect(e.cerrar).toHaveBeenCalledTimes(2);
  });

  it('respeta fuentes elegidas y distingue desconocidos de cero conocido', async () => {
    const e = entorno(); const { contexto } = await e.espacio.conectar(entrada);
    const r = await e.espacio.sincronizar(contexto, { ...rango, superficies: ['f29'] });
    expect(e.sii.llamadas).toEqual(['f29|2026-08', 'f29|2026-09']);
    expect(r.panorama.periodos[0]).toMatchObject({ ventas: null, compras: null, disponibilidad: { ventasRcv: false, comprasRcv: false, f29: true, propuestaF29: false, bheRecibidas: false } });
  });

  it.each(['SII_NO_DISPONIBLE', 'SESION_REQUERIDA'] as const)('devuelve parcial y sanea %s sin reautenticar', async (codigo) => {
    const e = entorno(); const { contexto } = await e.espacio.conectar(entrada);
    e.sii.fallas.set('resumen|2026-08|VENTA|REGISTRO', new ErrorMiSiiMcp(codigo, entrada.clave));
    const r = await e.espacio.sincronizar(contexto, rango);
    expect(r.estado).toBe('parcial');
    expect(r.sincronizacion).toContain(codigo);
    expect(JSON.stringify(r)).not.toContain(entrada.clave);
    expect(e.loginInteractivo).toHaveBeenCalledOnce();
    expect(e.cerrar).toHaveBeenCalledTimes(2);
  });

  it('considera avisos como parcial y cierra también tras un error inesperado', async () => {
    const e = entorno(); const { contexto } = await e.espacio.conectar(entrada);
    e.sii.resumenes.set('2026-08|COMPRA|REGISTRO', [fila(33, 100, 19, 2)]);
    expect((await e.espacio.sincronizar(contexto, rango)).estado).toBe('parcial');
    e.sii.fallas.set('f29|2026-08', new Error('falla ficticia'));
    await expect(e.espacio.sincronizar(contexto, rango)).rejects.toThrow('falla ficticia');
    expect(e.cerrar).toHaveBeenCalledTimes(3);
  });

  it('analiza cada mes con el motor existente sólo cuando se pide', async () => {
    const e = entorno(); const { contexto } = await e.espacio.conectar(entrada);
    sembrarMes(e.store, '2026-09', { resumenes: [resumen()] });
    const esperado = ['2026-08', '2026-09'].map(p => resumenIva(e.deps, '22222222-2', p));
    expect(await e.espacio.analizar(contexto, rango)).toEqual(esperado);
    expect(e.sii.llamadas).toEqual([]);
    expect(e.loginInteractivo).toHaveBeenCalledOnce();
    expect(e.cerrar).toHaveBeenCalledTimes(2);
    expect(await e.espacio.analizar(contexto, { desde: '2000-01', hasta: '2000-01' })).toHaveLength(1);
  });

  it('analiza diciembre de 2100 con vencimiento en 2101, sin red y cierra el contenedor', async () => {
    const e = entorno(); const { contexto } = await e.espacio.conectar(entrada);
    const filas = await e.espacio.analizar(contexto, { desde: '2100-12', hasta: '2100-12' });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ rut: '22222222-2', periodo: '2100-12', venceF29: '2101-01-20' });
    expect(e.sii.llamadas).toEqual([]);
    expect(e.loginInteractivo).toHaveBeenCalledOnce();
    expect(e.cerrar).toHaveBeenCalledTimes(2);
  });

  it('pagina documentos de 50 en 50 con filtros locales y RUT del contexto', async () => {
    const e = entorno(); const { contexto } = await e.espacio.conectar(entrada);
    sembrarMes(e.store, '2026-09', { documentos: [
      ...Array.from({ length: 55 }, (_, i) => documento({ folio: i + 1 })),
      documento({ folio: 90, lado: 'VENTA' }), documento({ folio: 91, estado: 'PENDIENTE' }),
    ] });
    const r = await e.espacio.documentos(contexto, { periodo: '2026-09', lado: 'COMPRA', estado: 'REGISTRO', pagina: 2 });
    expect(r).toMatchObject({ total: 55, pagina: 2, tamano: 50 });
    expect(r.documentos).toHaveLength(5);
    expect(r.documentos.every(d => d.rut === '22222222-2' && d.lado === 'COMPRA' && d.estado === 'REGISTRO')).toBe(true);
    expect((await e.espacio.documentos(contexto, { periodo: '2026-09' })).documentos).toHaveLength(50);
    expect(e.sii.llamadas).toEqual([]);
  });

  it.each([
    { periodo: 'incorrecto' }, { periodo: '2026-09', lado: 'OTRO' }, { periodo: '2026-09', estado: 'OTRO' },
    ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(pagina => ({ periodo: '2026-09', pagina })),
  ])('valida documentos antes del contenedor: %j', async (valor) => {
    const e = entorno(); const { contexto } = await e.espacio.conectar(entrada);
    await expect(e.espacio.documentos(contexto, valor as Parameters<typeof e.espacio.documentos>[1])).rejects.toThrow();
    expect(e.fabrica).toHaveBeenCalledOnce();
  });
});

describe('fuentes pedidas por el espacio', () => {
  it('pide solo rcv y f29, por defecto y por elección', async () => {
    const e = entorno(); const { contexto } = await e.espacio.conectar(entrada);
    const espia = vi.spyOn(syncApp, 'sincronizar');
    await e.espacio.sincronizar(contexto, rango);
    await e.espacio.sincronizar(contexto, { ...rango, superficies: ['f29'] });
    expect(espia.mock.calls.map((c) => c[4])).toEqual([['rcv', 'f29'], ['f29']]);
  });
});
