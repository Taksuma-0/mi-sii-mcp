import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorMiSiiMcp } from '../../src/domain/errores.js';
import * as syncApp from '../../src/app/sincronizar.js';
import { errorPublico, verificar, SecretosNulos, type FabricaContenedorWeb } from '../../src/interfaces/web/verificar.js';
import { depsDePrueba } from '../helpers/deps.js';
import { declaracion, fila, perfilEmpresa, valores } from '../helpers/fabricas.js';

const entrada = { rut: '22.222.222-2', clave: ' ficticia con espacios ', mes: '2026-09' };
const cerrarDbs: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const cerrar of cerrarDbs.splice(0)) cerrar(); });

function entorno(fallaLogin?: Error) {
  const p = depsDePrueba();
  cerrarDbs.push(() => p.db.close());
  const cerrar = vi.fn();
  const loginInteractivo = vi.fn(async (rut: string, _clave: string, _guardar: boolean) => {
    if (fallaLogin) throw fallaLogin;
    return { identidad: { rut, nombre: 'EMPRESA DEMO', razonSocial: 'EMPRESA DEMO SPA', tipo: 'empresa' as const }, claveGuardada: false };
  });
  const fabrica: FabricaContenedorWeb = vi.fn(() => ({ deps: p.deps, sesiones: { loginInteractivo, loginNavegador: vi.fn() }, cerrar }));
  return { ...p, fabrica, cerrar, loginInteractivo };
}

describe('verificación local', () => {
  it('considera parcial un resultado con avisos aunque no traiga errores ni aborto', async () => {
    const e = entorno();
    vi.spyOn(syncApp, 'sincronizar').mockResolvedValue({
      rut: '22222222-2', abortado: null, superficies: ['rcv', 'f29'],
      periodos: [{ periodo: '2026-09', errores: [], avisos: ['RCV COMPRA REGISTRO tipo 33: el detalle trajo 0 de 2 documentos.'], documentos: 0, f29Folio: null }],
    });
    expect((await verificar(entrada, e.fabrica)).estado).toBe('parcial');
  });
  it('marca parcial cuando un detalle trae cero de dos documentos', async () => {
    const e = entorno();
    e.sii.resumenes.set('2026-09|COMPRA|REGISTRO', [fila(33, 200_000, 38_000, 2)]);
    const r = await verificar(entrada, e.fabrica);
    expect(r.estado).toBe('parcial');
    expect(r.sincronizacion).toContain('el detalle trajo 0 de 2 documentos');
    expect(e.cerrar).toHaveBeenCalledOnce();
  });
  it.each([
    { ...entrada, rut: 'invalido' },
    { ...entrada, mes: '2026-99' },
    { ...entrada, mes: '2000-01' },
    { ...entrada, clave: '' },
  ])('valida antes de crear contenedor: %j', async (valor) => {
    const e = entorno();
    await expect(verificar(valor, e.fabrica)).rejects.toThrow();
    expect(e.fabrica).not.toHaveBeenCalled();
    expect(e.loginInteractivo).not.toHaveBeenCalled();
  });

  it('usa un login explícito sin guardar clave y consulta ambos meses con el core', async () => {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa({ alias: 'Alias propio', representa: ['11111111-1'] }));
    e.sii.resumenes.set('2026-09|VENTA|REGISTRO', [fila(39, 100_000, 19_000)]);
    e.sii.declaraciones.set('2026-09', [declaracion()]);
    e.sii.valores.set('2026-09|555001', valores({ '538': 19_000, '537': 0, '89': 19_000 }));
    const r = await verificar(entrada, e.fabrica);
    expect(e.loginInteractivo).toHaveBeenCalledExactlyOnceWith('22222222-2', entrada.clave, false);
    expect(e.fabrica).toHaveBeenCalledWith({ secretos: expect.any(SecretosNulos) });
    expect(e.sii.llamadas).toContain('f29|2026-08');
    expect(e.sii.llamadas).toContain('f29|2026-09');
    expect(e.store.contribuyente('22222222-2')).toMatchObject({ alias: 'Alias propio', representa: ['11111111-1'], razonSocial: 'EMPRESA DEMO SPA' });
    expect(r).toMatchObject({ estado: 'completo', codigosF29: { '538': 19_000, '537': 0, '89': 19_000 } });
    expect(r.resumen).toContain('$19.000');
    expect(r.sincronizacion).toContain('2026-08');
    expect(r.plazos).toBeTypeOf('string');
    expect(JSON.stringify(r)).not.toContain(entrada.clave);
    expect(r).not.toHaveProperty('clave');
    expect(e.cerrar).toHaveBeenCalledOnce();
  });

  it('cierra tras fallo de login sin sincronizar ni registrar identidad', async () => {
    const e = entorno(new ErrorMiSiiMcp('CLAVE_RECHAZADA', 'error ficticio'));
    await expect(verificar(entrada, e.fabrica)).rejects.toMatchObject({ codigo: 'CLAVE_RECHAZADA' });
    expect(e.loginInteractivo).toHaveBeenCalledOnce();
    expect(e.sii.llamadas).toEqual([]);
    expect(e.store.contribuyentes()).toEqual([]);
    expect(e.cerrar).toHaveBeenCalledOnce();
  });

  it.each(['SII_NO_DISPONIBLE', 'SESION_REQUERIDA'] as const)('marca parcial ante %s sin reflejar mensajes crudos', async (codigo) => {
    const e = entorno();
    e.sii.fallas.set('resumen|2026-08|VENTA|REGISTRO', new ErrorMiSiiMcp(codigo, entrada.clave));
    const r = await verificar(entrada, e.fabrica);
    expect(r.estado).toBe('parcial');
    expect(JSON.stringify(r)).not.toContain(entrada.clave);
    expect(e.cerrar).toHaveBeenCalledOnce();
  });

  it('cierra también si una consulta arroja un fallo inesperado', async () => {
    const e = entorno();
    e.sii.fallas.set('f29|2026-08', new Error('fallo ficticio'));
    await expect(verificar(entrada, e.fabrica)).rejects.toThrow('fallo ficticio');
    expect(e.cerrar).toHaveBeenCalledOnce();
  });

  it('el almacén nulo nunca recupera claves', async () => {
    const secretos = new SecretosNulos();
    await secretos.guardar('22222222-2', 'ficticia');
    expect(await secretos.obtener('22222222-2')).toBeNull();
    await secretos.borrar('22222222-2');
    expect(await secretos.obtener('22222222-2')).toBeNull();
  });
});

describe('fuentes pedidas por la web', () => {
  it('verificar pide solo rcv y f29', async () => {
    const e = entorno();
    const espia = vi.spyOn(syncApp, 'sincronizar');
    await verificar(entrada, e.fabrica);
    expect(espia).toHaveBeenCalledOnce();
    expect(espia.mock.calls[0]![4]).toEqual(['rcv', 'f29']);
  });
});

describe('mensaje público de RESPUESTA_VACIA', () => {
  it('no supone que antes hubiera datos', () => {
    expect(errorPublico(new ErrorMiSiiMcp('RESPUESTA_VACIA', 'detalle interno'))).toEqual({
      codigo: 'RESPUESTA_VACIA',
      mensaje: 'El SII respondió sin datos; si había datos anteriores, se conservan. Puedes volver a intentarlo más tarde.',
    });
  });
});
