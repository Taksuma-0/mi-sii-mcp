import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { leerLineaStdin } from '../../src/interfaces/cli/clave.js';
import { crearPrograma, type ContenedorCli, type IoCli, type SesionesCli } from '../../src/interfaces/cli/programa.js';
import { declaracion, fila, perfilEmpresa, resumen, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { depsDePrueba } from '../helpers/deps.js';
import { sembrarMes } from '../helpers/sembrar.js';

function entorno(o: { claveStdin?: string } = {}) {
  const p = depsDePrueba();
  const salidaTexto: string[] = [];
  const errores: string[] = [];
  const logins: { rut: string; clave: string; guardar: boolean }[] = [];
  const contadores = { cerrado: 0, mcp: 0 };
  const sesiones: SesionesCli = {
    loginInteractivo: async (rut, clave, guardar) => {
      logins.push({ rut, clave, guardar });
      return { identidad: { rut: RUT_EMPRESA, nombre: 'EMPRESA DEMO SPA', razonSocial: 'EMPRESA DEMO SPA', tipo: 'empresa' }, claveGuardada: guardar };
    },
    logout: async () => {},
    estado: () => ({ tieneSesion: false, guardadaEn: null, bloqueado: false }),
  };
  const contenedor: ContenedorCli = {
    deps: p.deps,
    sesiones,
    config: { home: '/tmp/impuestocl', rutaDb: '/tmp/impuestocl/impuestocl.db' },
    cerrar: () => {
      contadores.cerrado++;
    },
  };
  const io: IoCli = {
    escribir: (t) => void salidaTexto.push(t),
    error: (t) => void errores.push(t),
    pedirClave: async () => 'desde-prompt',
    leerStdin: async () => o.claveStdin ?? '',
  };
  const correr = async (...args: string[]): Promise<number> => {
    const { programa, salida } = crearPrograma(io, () => contenedor, () => {
      contadores.mcp++;
    });
    await programa.parseAsync(['node', 'impuestocl', ...args]);
    return salida.codigo;
  };
  return { ...p, correr, salidaTexto, errores, logins, contadores };
}

describe('CLI', () => {
  it('agrega y lista perfiles', async () => {
    const e = entorno();
    expect(await e.correr('perfil', 'agregar', '22.222.222-2', '--alias', 'Pyme', '--tipo', 'empresa')).toBe(0);
    await e.correr('perfil', 'listar', '--json');
    expect(JSON.parse(e.salidaTexto.at(-1)!)).toMatchObject([{ rut: RUT_EMPRESA, alias: 'Pyme', tipo: 'empresa' }]);
  });

  it('iva --json imprime el resumen del mes', async () => {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa());
    sembrarMes(e.store, '2026-09', {
      resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000, 2)] })],
      declaraciones: [declaracion()],
      valores: [valores({ '538': 190_000, '537': 0 })],
    });
    expect(await e.correr('iva', RUT_EMPRESA, '2026-09', '--json')).toBe(0);
    expect(JSON.parse(e.salidaTexto.at(-1)!)).toMatchObject({ periodo: '2026-09', ventas: { debito: 190_000 } });
  });

  it('un error tipado se muestra con código y acción, y sale con 1', async () => {
    const e = entorno();
    expect(await e.correr('iva', RUT_EMPRESA, '2026-09')).toBe(1);
    expect(e.errores[0]).toContain('Error [PERFIL_NO_EXISTE]');
    expect(e.errores[0]).toContain('→ Agrega el perfil');
  });

  it('login --clave-stdin usa la clave leída y registra la identidad', async () => {
    const e = entorno({ claveStdin: 'secreta' });
    await e.correr('login', '22222222-2', '--clave-stdin', '--guardar-clave');
    expect(e.logins).toEqual([{ rut: '22222222-2', clave: 'secreta', guardar: true }]);
    expect(e.store.contribuyente(RUT_EMPRESA)?.alias).toBe('EMPRESA DEMO SPA');
    expect(e.salidaTexto.at(-1)).toContain('Clave guardada en el llavero');
  });

  it('sync sale con 1 si alguna superficie falló', async () => {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa());
    e.sii.fallas.set('f29|2026-09', new ErrorImpuestocl('PORTAL_CAMBIO', 'cambió'));
    expect(await e.correr('sync', RUT_EMPRESA, '--desde', '2026-09')).toBe(1);
    expect(e.salidaTexto.at(-1)).toContain('f29 PORTAL_CAMBIO');
  });

  it('cierra el contenedor después de cada comando, salvo mcp', async () => {
    const e = entorno();
    await e.correr('perfil', 'listar');
    expect(e.contadores.cerrado).toBe(1);
    await e.correr('mcp');
    expect(e.contadores).toEqual({ cerrado: 1, mcp: 1 });
  });

  it('--version informa la versión', async () => {
    const e = entorno();
    await expect(e.correr('--version')).rejects.toMatchObject({ exitCode: 0 });
    expect(e.salidaTexto.join('\n')).toContain('0.1.0');
  });
});

describe('leerLineaStdin', () => {
  it('lee solo la primera línea', async () => {
    expect(await leerLineaStdin(Readable.from(['secreta\r\nresto']))).toBe('secreta');
  });
});
