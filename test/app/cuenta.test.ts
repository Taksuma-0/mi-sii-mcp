import { describe, expect, it } from 'vitest';
import { cuentaDe, sincronizarCuenta } from '../../src/app/cuenta.js';
import { ErrorMiSiiMcp } from '../../src/domain/errores.js';
import { textoCuenta } from '../../src/interfaces/formato.js';
import { codigoDe } from '../helpers/errores.js';
import { depsDePrueba } from '../helpers/deps.js';
import { empresaAutorizada, perfilEmpresa, perfilTributario, RUT_EMPRESA } from '../helpers/fabricas.js';

function preparar(representa: string[] = []) {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilEmpresa({ representa }));
  p.sii.perfil = perfilTributario();
  p.sii.empresas = [
    empresaAutorizada({ rutEmpresa: RUT_EMPRESA, razonSocial: 'EMPRESA DEMO SPA', privilegios: 'ADMIN' }),
    empresaAutorizada({ rutEmpresa: '33333333-3' }),
    empresaAutorizada({ rutEmpresa: '44444444-4', razonSocial: null, privilegios: null, fechaDesautorizacion: '2025-06-30' }),
  ];
  return p;
}

const bitacora = (db: ReturnType<typeof depsDePrueba>['db']) =>
  db.prepare('SELECT superficie, periodo, estado, error_codigo FROM sincronizacion ORDER BY id').all();

describe('sincronizarCuenta', () => {
  it('guarda el perfil tributario y las empresas autorizadas, cada uno en su registro con período vacío', async () => {
    const { deps, store, sii, db } = preparar();

    const r = await sincronizarCuenta(deps, RUT_EMPRESA);

    expect(sii.llamadas).toEqual(['perfil', 'empresas']);
    expect(r).toEqual({ rut: RUT_EMPRESA, perfil: 'leido', autorizadoDia20: true, empresas: 3, empresasActivas: 2, representa: ['33333333-3'], errores: [], abortado: null });
    expect(store.perfilTributario(RUT_EMPRESA)).toMatchObject({ autorizadoDia20: true, tipoCodigo: '1' });
    expect(store.empresasAutorizadas(RUT_EMPRESA).map((e) => e.rutEmpresa)).toEqual(['22222222-2', '33333333-3', '44444444-4']);
    expect(bitacora(db)).toEqual([
      { superficie: 'cuenta.perfil', periodo: '', estado: 'ok', error_codigo: null },
      { superficie: 'cuenta.empresas', periodo: '', estado: 'ok', error_codigo: null },
    ]);
    expect(store.periodosConDatos(RUT_EMPRESA)).toEqual([]);
  });

  it('actualiza a quién representa con las empresas activas, sin el RUT propio ni las desautorizadas', async () => {
    const { deps, store } = preparar(['55555555-5']);

    await sincronizarCuenta(deps, '22.222.222-2');

    expect(store.contribuyente(RUT_EMPRESA)?.representa).toEqual(['33333333-3']);
  });

  it('una lista vacía de empresas deja representa vacío: el SII es la fuente', async () => {
    const { deps, store, sii } = preparar(['55555555-5']);
    sii.empresas = [];

    const r = await sincronizarCuenta(deps, RUT_EMPRESA);

    expect(r.empresas).toBe(0);
    expect(store.contribuyente(RUT_EMPRESA)?.representa).toEqual([]);
  });

  it('una lista vacía cuando había empresas guardadas se trata como respuesta vacía: se conserva lo guardado', async () => {
    const { deps, store, sii, db } = preparar();
    await sincronizarCuenta(deps, RUT_EMPRESA);
    sii.empresas = [];

    const r = await sincronizarCuenta(deps, RUT_EMPRESA);

    expect(r.empresas).toBeNull();
    expect(r.representa).toEqual(['33333333-3']);
    expect(r.errores).toEqual([expect.objectContaining({ superficie: 'cuenta.empresas', codigo: 'RESPUESTA_VACIA' })]);
    expect(store.empresasAutorizadas(RUT_EMPRESA)).toHaveLength(3);
    expect(store.contribuyente(RUT_EMPRESA)?.representa).toEqual(['33333333-3']);
    expect(bitacora(db).at(-1)).toMatchObject({ superficie: 'cuenta.empresas', estado: 'error', error_codigo: 'RESPUESTA_VACIA' });
  });

  it('si el perfil falla igual lee las empresas, y deja el error en su superficie', async () => {
    const { deps, store, sii, db } = preparar();
    sii.fallas.set('perfil', new ErrorMiSiiMcp('PORTAL_CAMBIO', 'Mi SII cambió.'));

    const r = await sincronizarCuenta(deps, RUT_EMPRESA);

    expect(r.perfil).toBe('sin_leer');
    expect(r.autorizadoDia20).toBeNull();
    expect(r.empresas).toBe(3);
    expect(r.errores).toEqual([{ superficie: 'cuenta.perfil', codigo: 'PORTAL_CAMBIO', mensaje: 'Mi SII cambió.' }]);
    expect(store.perfilTributario(RUT_EMPRESA)).toBeNull();
    expect(store.empresasAutorizadas(RUT_EMPRESA)).toHaveLength(3);
    expect(bitacora(db)).toEqual([
      { superficie: 'cuenta.perfil', periodo: '', estado: 'error', error_codigo: 'PORTAL_CAMBIO' },
      { superficie: 'cuenta.empresas', periodo: '', estado: 'ok', error_codigo: null },
    ]);
  });

  it('si las empresas fallan se conserva lo guardado, incluido a quién representa', async () => {
    const { deps, store, sii } = preparar();
    await sincronizarCuenta(deps, RUT_EMPRESA);
    sii.empresas = [];
    sii.fallas.set('empresas', new ErrorMiSiiMcp('SII_RECHAZO', 'Servicio no disponible.'));

    const r = await sincronizarCuenta(deps, RUT_EMPRESA);

    expect(r.empresas).toBeNull();
    expect(r.representa).toEqual(['33333333-3']);
    expect(r.errores).toEqual([{ superficie: 'cuenta.empresas', codigo: 'SII_RECHAZO', mensaje: 'Servicio no disponible.' }]);
    expect(store.empresasAutorizadas(RUT_EMPRESA)).toHaveLength(3);
    expect(store.contribuyente(RUT_EMPRESA)?.representa).toEqual(['33333333-3']);
  });

  it('una lectura nueva del perfil reemplaza a la anterior', async () => {
    const { deps, store, sii } = preparar();
    await sincronizarCuenta(deps, RUT_EMPRESA);
    sii.perfil = perfilTributario({ autorizadoDia20: false });

    await sincronizarCuenta(deps, RUT_EMPRESA);

    expect(store.perfilTributario(RUT_EMPRESA)?.autorizadoDia20).toBe(false);
  });

  it('sin perfil registrado falla antes de ir al SII', async () => {
    const { deps, sii } = depsDePrueba();
    expect(await codigoDe(sincronizarCuenta(deps, RUT_EMPRESA))).toBe('PERFIL_NO_EXISTE');
    expect(sii.llamadas).toEqual([]);
  });

  it('sin sesión devuelve el error como abortado y no guarda nada', async () => {
    const { deps, store, db } = depsDePrueba({ fallaAlAbrir: new ErrorMiSiiMcp('SESION_REQUERIDA', 'Inicia sesión.') });
    store.guardarContribuyente(perfilEmpresa());

    const r = await sincronizarCuenta(deps, RUT_EMPRESA);

    expect(r.abortado).toEqual({ superficie: 'sesion', codigo: 'SESION_REQUERIDA', mensaje: 'Inicia sesión.' });
    expect(r.perfil).toBe('sin_leer');
    expect(bitacora(db)).toEqual([]);
  });

  it('un error de sesión a mitad de camino detiene la cuenta', async () => {
    const { deps, sii } = preparar();
    sii.fallas.set('perfil', new ErrorMiSiiMcp('SESION_REQUERIDA', 'La sesión expiró.'));

    const r = await sincronizarCuenta(deps, RUT_EMPRESA);

    expect(r.abortado).toMatchObject({ codigo: 'SESION_REQUERIDA' });
    expect(sii.llamadas).toEqual(['perfil']);
  });

  it('cancelada antes de empezar no abre el SII; cancelada a mitad de camino conserva lo escrito', async () => {
    const antes = preparar();
    const control = new AbortController();
    control.abort();
    const r1 = await sincronizarCuenta(antes.deps, RUT_EMPRESA, control.signal);
    expect(r1.abortado).toMatchObject({ codigo: 'CANCELADO' });
    expect(antes.sii.llamadas).toEqual([]);

    const durante = preparar();
    const c2 = new AbortController();
    durante.sii.alLlamar = (llamada) => {
      if (llamada === 'perfil') c2.abort();
    };
    const r2 = await sincronizarCuenta(durante.deps, RUT_EMPRESA, c2.signal);
    expect(r2.abortado).toMatchObject({ codigo: 'CANCELADO' });
    expect(durante.store.perfilTributario(RUT_EMPRESA)).not.toBeNull();
    expect(durante.store.empresasAutorizadas(RUT_EMPRESA)).toEqual([]);
  });

  it('avisa que terminó para persistir las cookies', async () => {
    const { deps, persistidos } = preparar();
    await sincronizarCuenta(deps, RUT_EMPRESA);
    expect(persistidos).toEqual([RUT_EMPRESA]);
  });

  it('la evidencia que llega del conector queda guardada en la sincronización de cada superficie', async () => {
    const { deps, sii, db } = preparar();
    sii.alLlamar = (llamada) => {
      if (llamada === 'empresas') sii.sumidero({ superficie: 'cuenta.empresas', parametros: {}, cuerpo: '{"data":[]}', obtenidoEn: '2026-10-21T12:00:00.000Z' });
    };

    await sincronizarCuenta(deps, RUT_EMPRESA);

    const crudas = db.prepare("SELECT s.superficie AS sincronizacion, r.cuerpo FROM respuesta_cruda r JOIN sincronizacion s ON s.id = r.sincronizacion_id WHERE r.superficie = 'cuenta.empresas' ORDER BY r.id").all();
    expect(crudas).toEqual([{ sincronizacion: 'cuenta.empresas', cuerpo: '{"data":[]}' }]);
  });
});

describe('cuentaDe', () => {
  it('sin lectura de la cuenta devuelve null', () => {
    const { deps } = preparar();
    expect(cuentaDe(deps, RUT_EMPRESA)).toBeNull();
  });

  it('resume día 20, régimen, segmento y empresas activas; los atributos sin valor no inventan uno', async () => {
    const { deps } = preparar();
    await sincronizarCuenta(deps, RUT_EMPRESA);

    const cuenta = cuentaDe(deps, RUT_EMPRESA)!;

    expect(cuenta).toMatchObject({
      autorizadoDia20: true,
      tipo: 'Primera Categoría',
      subtipo: 'Sociedad por acciones',
      segmento: 'Segmento ficticio',
      glosaActividad: 'SERVICIOS DE ASESORIA DE EJEMPLO',
      empresas: [
        { rut: '22222222-2', razonSocial: 'EMPRESA DEMO SPA', privilegios: 'ADMIN', activa: true },
        { rut: '33333333-3', razonSocial: 'OTRA EMPRESA DEMO LTDA', privilegios: 'CONSULTA', activa: true },
        { rut: '44444444-4', razonSocial: null, privilegios: null, activa: false },
      ],
    });
    expect(cuenta.atributos).toEqual([
      { codigo: '14TT', descripcion: 'Régimen Pro Pyme Transparente 14 D N°8', valor: 'S' },
      { codigo: 'NOTI', descripcion: 'Notificación por correo electrónico' },
    ]);
    expect(cuenta.obtenidoEn).toBe('2026-10-21T15:00:00.000Z');
  });

  it('solo cuenta las empresas si no hay perfil (y viceversa)', async () => {
    const { deps, sii } = preparar();
    sii.fallas.set('perfil', new ErrorMiSiiMcp('PORTAL_CAMBIO', 'x'));
    await sincronizarCuenta(deps, RUT_EMPRESA);
    const cuenta = cuentaDe(deps, RUT_EMPRESA)!;
    expect(cuenta.autorizadoDia20).toBeNull();
    expect(cuenta.empresas).toHaveLength(3);
  });
});

describe('textoCuenta', () => {
  it('cuenta lo leído sin datos personales y avisa de los errores', async () => {
    const { deps, sii } = preparar();
    const ok = await sincronizarCuenta(deps, RUT_EMPRESA);
    const texto = textoCuenta(ok);
    expect(texto).toContain('Cuenta 22222222-2');
    expect(texto).toContain('día 20: autorizado');
    expect(texto).toContain('2 empresas activas');
    expect(texto).toContain('1 desautorizada');

    sii.fallas.set('perfil', new ErrorMiSiiMcp('PORTAL_CAMBIO', 'Mi SII cambió.'));
    const mal = await sincronizarCuenta(deps, RUT_EMPRESA);
    expect(textoCuenta(mal)).toContain('perfil tributario sin leer');
    expect(textoCuenta(mal)).toContain('cuenta.perfil PORTAL_CAMBIO');
  });
});
