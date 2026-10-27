import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERSION_LECTOR_F29 } from '../../src/connectors/sii/f29-pdf.js';
import { cargarConfig } from '../../src/main/config.js';
import { crearContenedor } from '../../src/main/contenedor.js';
import * as sqlite from '../../src/store/sqlite/db.js';
import { readFileSync as leerFixture } from 'node:fs';
import { sincronizarCuenta } from '../../src/app/cuenta.js';
import { sincronizarRenta } from '../../src/app/renta.js';
import { sincronizar } from '../../src/app/sincronizar.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { codigoDe } from '../helpers/errores.js';
import { perfilEmpresa } from '../helpers/fabricas.js';
import { crearFetchFalso, HTML, JSON_CT, sinEsperas } from '../helpers/http-falso.js';
import { SecretosEnMemoria } from '../helpers/secretos.js';
import { PAGINA_STUB, paginaDatosCntr, RUTA_MI_SII } from '../helpers/sii-login.js';

describe('configuración y contenedor', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'impuestocl-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('cargarConfig usa IMPUESTOCL_HOME y valores numéricos seguros', () => {
    const c = cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_TOLERANCIA: '100', IMPUESTOCL_INTERVALO_MS: 'abc' });
    expect(c.home).toBe(home);
    expect(c.rutaDb).toBe(join(home, 'impuestocl.db'));
    expect(c.dirSesiones).toBe(join(home, 'sesiones'));
    expect(c.toleranciaPesos).toBe(100);
    expect(c.intervaloMinMs).toBe(1000);
  });

  it.each(['0', '1'])('cargarConfig exige al menos 1000 ms si IMPUESTOCL_INTERVALO_MS es %s', (intervalo) => {
    const c = cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_INTERVALO_MS: intervalo });
    expect(c.intervaloMinMs).toBeGreaterThanOrEqual(1000);
  });

  it('cargarConfig conserva intervalos mayores a 1000 ms', () => {
    const c = cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_INTERVALO_MS: '2500' });
    expect(c.intervaloMinMs).toBe(2500);
  });

  it('cargarConfig usa 60 s de plazo HTTP por defecto y respeta IMPUESTOCL_PLAZO_HTTP_MS', () => {
    expect(cargarConfig({ IMPUESTOCL_HOME: home }).plazoHttpMs).toBe(60_000);
    expect(cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_PLAZO_HTTP_MS: '90000' }).plazoHttpMs).toBe(90_000);
    expect(cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_PLAZO_HTTP_MS: 'abc' }).plazoHttpMs).toBe(60_000);
  });

  it('cargarConfig acota el plazo HTTP a lo que admite un temporizador (2^31-1 ms)', () => {
    expect(cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_PLAZO_HTTP_MS: '99999999999999' }).plazoHttpMs).toBe(2_147_483_647);
  });

  it.each(['0', '500', '9999'])('cargarConfig exige al menos 10000 ms de plazo HTTP si IMPUESTOCL_PLAZO_HTTP_MS es %s', (plazo) => {
    expect(cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_PLAZO_HTTP_MS: plazo }).plazoHttpMs).toBe(10_000);
  });

  it('cargarConfig usa 10 minutos para el login con navegador y respeta IMPUESTOCL_PLAZO_NAVEGADOR_MS (mínimo 1 minuto)', () => {
    expect(cargarConfig({ IMPUESTOCL_HOME: home }).plazoNavegadorMs).toBe(600_000);
    expect(cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_PLAZO_NAVEGADOR_MS: '120000' }).plazoNavegadorMs).toBe(120_000);
    expect(cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_PLAZO_NAVEGADOR_MS: '5' }).plazoNavegadorMs).toBe(60_000);
  });

  it('cargarConfig acota el plazo del login con navegador a 30 minutos', () => {
    expect(cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_PLAZO_NAVEGADOR_MS: '99999999999' }).plazoNavegadorMs).toBe(1_800_000);
  });

  it('crearContenedor conecta el login con navegador con el plazo configurado y no devuelve cookies', async () => {
    const config = cargarConfig({ IMPUESTOCL_HOME: home, IMPUESTOCL_PLAZO_NAVEGADOR_MS: '90000' });
    const { fetchFalso } = crearFetchFalso({ [RUTA_MI_SII]: { headers: HTML, body: paginaDatosCntr('22222222', '2', 'EMPRESA DEMO SPA') } });
    const capturas: unknown[] = [];
    const c = crearContenedor({
      config,
      secretos: new SecretosEnMemoria(),
      opcionesHttp: { fetch: fetchFalso, temporizador: sinEsperas },
      capturarNavegador: async (o) => {
        capturas.push(o);
        return [{ nombre: 'TOKEN', valor: 'tok-secreto', dominio: '.sii.cl', ruta: '/', expira: null, httpOnly: true, seguro: true }];
      },
    });
    try {
      const identidad = await c.sesiones.loginNavegador();
      expect(capturas).toEqual([{ plazoMs: 90_000 }]);
      expect(identidad.rut).toBe('22222222-2');
      expect(JSON.stringify(identidad)).not.toContain('tok-secreto');
      expect(c.sesiones.estado('22222222-2')).toMatchObject({ tieneSesion: true, origen: 'navegador' });
    } finally {
      c.cerrar();
    }
  });

  describe('acceso de un contribuyente con la sesión de otra identidad', () => {
    const EMPRESA = '22222222-2';
    const PERSONA = '33333333-3';
    const RUTA_RESUMEN = 'POST https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getResumen';
    const SIN_MOVIMIENTO = leerFixture(join(import.meta.dirname, '..', 'fixtures', 'sii', 'rcv-resumen-sin-movimiento.json'), 'utf8');
    const cookies = (token: string) => [{ nombre: 'TOKEN', valor: token, dominio: '.sii.cl', ruta: '/', expira: null, httpOnly: true, seguro: true }];

    function preparar() {
      const { fetchFalso, llamadas } = crearFetchFalso({
        [RUTA_MI_SII]: (l) => {
          const cookie = l.headers['Cookie'] ?? '';
          if (cookie.includes('tok-persona')) return { headers: HTML, body: paginaDatosCntr('33333333', '3', null) };
          if (cookie.includes('tok-empresa')) return { headers: HTML, body: paginaDatosCntr('22222222', '2', 'EMPRESA DEMO SPA') };
          return { headers: HTML, body: PAGINA_STUB };
        },
        [RUTA_RESUMEN]: { headers: JSON_CT, body: SIN_MOVIMIENTO },
      });
      const capturas: string[] = [];
      const secretos = new SecretosEnMemoria();
      const c = crearContenedor({
        config: cargarConfig({ IMPUESTOCL_HOME: home }),
        secretos,
        opcionesHttp: { fetch: fetchFalso, temporizador: sinEsperas },
        capturarNavegador: async () => cookies(capturas.shift() ?? 'tok-persona'),
      });
      c.deps.store.guardarContribuyente({ ...perfilEmpresa(), accedeCon: PERSONA });
      return { c, llamadas, capturas, secretos };
    }

    it('sin sesión propia, el RCV se lee con la sesión de quien accede (rutEmisor = la empresa) y queda marcado como no confirmado', async () => {
      const { c, llamadas } = preparar();
      try {
        await c.sesiones.loginNavegador(PERSONA);
        const persistidos = vi.spyOn(c.sesiones, 'persistir');
        const sii = await c.deps.abrirSii(EMPRESA, () => {});
        expect(sii.aviso).toBe(`lectura por representación sin confirmar en vivo (sesión de ${PERSONA})`);
        await sii.rcvResumen(EMPRESA, parsePeriodo('2026-09'), 'COMPRA', 'REGISTRO');
        const consulta = llamadas.find((l) => l.url.endsWith('/getResumen'))!;
        expect(consulta.headers['Cookie']).toContain('TOKEN=tok-persona');
        expect(JSON.parse(consulta.body!).data).toMatchObject({ rutEmisor: '22222222', dvEmisor: '2' });

        const antes = llamadas.length;
        expect(await codigoDe(sii.f29Declaraciones(EMPRESA, parsePeriodo('2026-09')))).toBe('SIN_PERMISO');
        expect(await codigoDe(sii.perfilTributario(EMPRESA))).toBe('SIN_PERMISO');
        expect(llamadas.length).toBe(antes);

        c.deps.alTerminarSync?.(EMPRESA);
        expect(persistidos).toHaveBeenCalledWith(PERSONA);
      } finally {
        c.cerrar();
      }
    });

    it('abrir el lector no consulta al SII ni al llavero: la sesión de quien accede se abre recién con el RCV', async () => {
      const { c, llamadas, secretos } = preparar();
      try {
        secretos.mapa.set(PERSONA, 'clave-ficticia');
        const obtener = vi.spyOn(secretos, 'obtener');
        const sii = await c.deps.abrirSii(EMPRESA, () => {});
        expect(llamadas).toHaveLength(0);
        expect(obtener).not.toHaveBeenCalled();
        expect(await codigoDe(sii.f22Declaraciones(EMPRESA, 2026))).toBe('SIN_PERMISO');
        expect(await codigoDe(sii.perfilTributario(EMPRESA))).toBe('SIN_PERMISO');
        expect(llamadas).toHaveLength(0);
        expect(obtener).not.toHaveBeenCalled();
      } finally {
        c.cerrar();
      }
    });

    it('sin sesión de quien accede, renta y perfil dan SIN_PERMISO sin red ni llavero, y el RCV pide entrar con esa identidad', async () => {
      const { c, llamadas, secretos } = preparar();
      try {
        const obtener = vi.spyOn(secretos, 'obtener');
        const renta = await sincronizarRenta(c.deps, EMPRESA, '2026');
        expect(renta.anios[0]!.errores.map((e) => e.codigo)).toEqual(['SIN_PERMISO']);
        const cuenta = await sincronizarCuenta(c.deps, EMPRESA);
        expect(cuenta.errores.map((e) => e.codigo)).toContain('SIN_PERMISO');
        expect(llamadas).toHaveLength(0);
        expect(obtener).not.toHaveBeenCalled();

        const rcv = await sincronizar(c.deps, EMPRESA, parsePeriodo('2026-09'), parsePeriodo('2026-09'), ['rcv']);
        expect(rcv.abortado?.codigo).toBe('SESION_REQUERIDA');
        // Sin consulta del RCV no hay aviso de representación.
        expect(rcv.periodos[0]!.avisos).toEqual([]);
      } finally {
        c.cerrar();
      }
    });

    it('con sesión propia del contribuyente se usa esa, sin aviso ni restricciones', async () => {
      const { c, capturas } = preparar();
      try {
        capturas.push('tok-persona', 'tok-empresa');
        await c.sesiones.loginNavegador(PERSONA);
        await c.sesiones.loginNavegador(EMPRESA);
        const sii = await c.deps.abrirSii(EMPRESA, () => {});
        expect(sii.aviso).toBeUndefined();
      } finally {
        c.cerrar();
      }
    });
  });

  it('crearContenedor arma la base, las sesiones y el diagnóstico sin tocar la red', () => {
    const c = crearContenedor({ config: cargarConfig({ IMPUESTOCL_HOME: home }), secretos: new SecretosEnMemoria() });
    try {
      expect(existsSync(join(home, 'impuestocl.db'))).toBe(true);
      expect(c.deps.store.contribuyentes()).toEqual([]);
      expect(c.sesiones.estado('22222222-2')).toEqual({ tieneSesion: false, guardadaEn: null, bloqueado: false });
      expect(c.deps.lectorPdfF29.version).toBe(VERSION_LECTOR_F29);
      c.deps.diagnostico?.('prueba.json', '{"ok":true}');
      expect(readFileSync(join(home, 'diagnostico', 'prueba.json'), 'utf8')).toBe('{"ok":true}');
    } finally {
      c.cerrar();
    }
  });

  it('crearContenedor conecta las consultas libres a la base local', async () => {
    const c = crearContenedor({ config: cargarConfig({ IMPUESTOCL_HOME: home }), secretos: new SecretosEnMemoria() });
    try {
      const limites = { filas: 200, caracteres: 40_000, caracteresCelda: 1_000, milisegundos: 15_000 };
      const vacia = await c.deps.consultaLibre.consultar('SELECT COUNT(*) AS n FROM contribuyente', { limites, tiposNegativos: [60, 61, 112] });
      expect(vacia).toEqual({ columnas: ['n'], filas: [[0]], truncado: false });

      c.deps.store.guardarContribuyente({ rut: '22222222-2', alias: 'Demo', tipo: 'empresa', representa: [], razonSocial: null });
      const con = await c.deps.consultaLibre.consultar('SELECT rut FROM contribuyente', { limites, tiposNegativos: [60, 61, 112] });
      expect(con.filas).toEqual([['22222222-2']]);
    } finally {
      c.cerrar();
    }
  });

  it('crearContenedor cierra la base y conserva el error si no puede crear el directorio de sesiones', () => {
    const config = cargarConfig({ IMPUESTOCL_HOME: home });
    writeFileSync(config.dirSesiones, 'archivo que impide crear el directorio');
    const db = sqlite.abrirDb(config.rutaDb);
    const abrirDb = vi.spyOn(sqlite, 'abrirDb').mockReturnValue(db);
    try {
      expect(() => crearContenedor({ config, secretos: new SecretosEnMemoria() })).toThrowError(
        expect.objectContaining({ code: 'EEXIST', path: config.dirSesiones }),
      );
      expect(db.open).toBe(false);
    } finally {
      abrirDb.mockRestore();
      if (db.open) db.close();
    }
  });
});
