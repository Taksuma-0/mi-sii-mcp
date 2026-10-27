import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { leerLineaStdin, pedirClaveOculta } from '../../src/interfaces/cli/clave.js';
import { crearPrograma, type ContenedorCli, type IoCli, type SesionesCli } from '../../src/interfaces/cli/programa.js';
import { declaracion, documento, fila, perfilEmpresa, resumen, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { depsDePrueba } from '../helpers/deps.js';
import { sembrarMes } from '../helpers/sembrar.js';

function entorno(o: { claveStdin?: string; fallaAlAbrir?: Error } = {}) {
  const p = depsDePrueba({ fallaAlAbrir: o.fallaAlAbrir });
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
    expect(e.errores[0]).toContain('Reintentar: no (');
  });

  it('un error del SII que conviene reintentar más tarde lo indica', async () => {
    const e = entorno({ fallaAlAbrir: new ErrorImpuestocl('SII_NO_DISPONIBLE', 'El SII no responde.') });
    e.store.guardarContribuyente(perfilEmpresa());
    expect(await e.correr('sync', RUT_EMPRESA, '--desde', '2026-09')).toBe(1);
    expect(e.errores[0]).toContain('Error [SII_NO_DISPONIBLE]');
    expect(e.errores[0]).toContain('Reintentar: más tarde');
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

  it('sync --solo rcv no afirma que un F29 guardado no se presentó', async () => {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa());
    sembrarMes(e.store, '2026-09', { declaraciones: [declaracion()] });
    expect(await e.correr('sync', RUT_EMPRESA, '--desde', '2026-09', '--solo', 'rcv')).toBe(0);
    expect(e.salidaTexto.at(-1)).not.toContain('F29');
    expect(e.salidaTexto.at(-1)).not.toContain('sin presentar');
  });

  it('sync --solo f29 no habla de documentos RCV', async () => {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa());
    e.sii.declaraciones.set('2026-09', [declaracion()]);
    e.sii.valores.set('2026-09|555001', valores({ '538': 190_000, '537': 0 }));
    expect(await e.correr('sync', RUT_EMPRESA, '--desde', '2026-09', '--solo', 'f29')).toBe(0);
    expect(e.salidaTexto.at(-1)).toContain('2026-09: F29 folio 555001');
    expect(e.salidaTexto.at(-1)).not.toContain('documentos RCV');
  });

  it.each(['abc', 'Infinity', '-Infinity'].flatMap((valor) => [
    { opcion: '--pagina', valor, args: ['documentos', RUT_EMPRESA, '2026-09', '--pagina', valor, '--json'] },
    { opcion: '--dias', valor, args: ['plazos', RUT_EMPRESA, '--dias', valor, '--json'] },
  ]))('rechaza $opcion $valor antes de consultar', async ({ args }) => {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa());
    sembrarMes(e.store, '2026-09', { documentos: [documento()] });
    await expect(e.correr(...args)).rejects.toMatchObject({ code: 'commander.invalidArgument', exitCode: 1 });
    expect(e.salidaTexto).toEqual([]);
    expect(e.errores.join('\n')).toContain('número finito');
    expect(e.contadores.cerrado).toBe(0);
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
  it('conserva UTF-8 cuando una letra llega en buffers separados', async () => {
    const bytes = Buffer.from('claveña\n');

    expect(await leerLineaStdin(Readable.from([bytes.subarray(0, 6), bytes.subarray(6)]))).toBe('claveña');
  });

  it('conserva caracteres de varios bytes aunque llegue un byte por trozo', async () => {
    const trozos = Array.from(Buffer.from('ficticiañ€🔒\nresto'), (byte) => Buffer.from([byte]));

    expect(await leerLineaStdin(Readable.from(trozos))).toBe('ficticiañ€🔒');
  });

  it('combina strings y buffers con UTF-8 y CRLF partidos', async () => {
    const trozos = ['clave', Buffer.from([0xc3]), Buffer.alloc(0), '', Buffer.from([0xb1]), 'a\r', Buffer.from('\nresto')];

    expect(await leerLineaStdin(Readable.from(trozos))).toBe('claveña');
  });

  it('conserva strings ya decodificados aunque separen un par sustituto', async () => {
    expect(await leerLineaStdin(Readable.from(['ficticia\ud83d', '\udd12\n']))).toBe('ficticia🔒');
  });

  it.each([['', ''], ['ficticiaña', 'ficticiaña'], ['ficticia\r', 'ficticia\r']])(
    'conserva la entrada %j al terminar sin salto de línea', async (entrada, esperada) => {
      expect(await leerLineaStdin(Readable.from([Buffer.from(entrada)]))).toBe(esperada);
    },
  );

  it('deja de consumir la entrada al completar la primera línea', async () => {
    async function* entrada() {
      yield Buffer.from('ficticia\nsegunda');
      throw new Error('No debe leer otra línea.');
    }

    expect(await leerLineaStdin(entrada())).toBe('ficticia');
  });

  it('lee solo la primera línea', async () => {
    expect(await leerLineaStdin(Readable.from(['secreta\r\nresto']))).toBe('secreta');
  });
});

function terminalSimulada() {
  class Entrada extends PassThrough {
    isTTY = true;
    isRaw = false;
    setRawMode(modo: boolean): this {
      this.isRaw = modo;
      return this;
    }
  }
  const entrada = new Entrada();
  const salida = new PassThrough();
  let texto = '';
  salida.on('data', (trozo: Buffer) => { texto += trozo.toString(); });
  return {
    entrada,
    texto: () => texto,
    pedir: () => pedirClaveOculta('Clave: ', entrada as unknown as NodeJS.ReadStream, salida as unknown as NodeJS.WriteStream),
  };
}

describe('pedirClaveOculta', () => {
  it.each([
    ['completas', ['\u001b[D', '\u001b[3~', '\u001bOP']],
    ['partidas', ['\u001b', '[', 'D', '\u001b[', '3', '~', '\u001bO', 'P']],
  ])('ignora teclas especiales %s sin incorporarlas a la clave', async (_nombre, trozos) => {
    const t = terminalSimulada();
    const clave = t.pedir();
    for (const trozo of ['ficticia', ...trozos, '\r']) t.entrada.emit('data', trozo);
    await expect(clave).resolves.toBe('ficticia');
    expect(t.texto()).toBe('Clave: ********\n');
  });

  it.each(['éxito', 'cancelación', 'end', 'close', 'error'])('restaura la terminal y retira listeners tras %s', async (evento) => {
    const t = terminalSimulada();
    const fallo = new Error('Entrada interrumpida.');
    const clave = t.pedir();
    const resultado = clave.then((valor) => ({ valor, error: undefined }), (error: unknown) => ({ valor: undefined, error }));
    t.entrada.emit('data', 'ficticia');
    let escapado: unknown;
    try {
      if (evento === 'éxito') t.entrada.emit('data', '\r');
      else if (evento === 'cancelación') t.entrada.emit('data', '\u0003');
      else t.entrada.emit(evento, fallo);
    } catch (e) {
      escapado = e;
    }
    expect(escapado).toBeUndefined();
    const fin = await Promise.race([resultado, new Promise<null>((resolve) => setImmediate(() => resolve(null)))]);
    expect(fin).not.toBeNull();
    if (evento === 'éxito') expect(fin?.valor).toBe('ficticia');
    else if (evento === 'error') expect(fin?.error).toBe(fallo);
    else expect(fin?.error).toBeInstanceOf(Error);
    expect(t.entrada.isRaw).toBe(false);
    expect(t.entrada.isPaused()).toBe(true);
    for (const nombre of ['data', 'end', 'close', 'error']) expect(t.entrada.listenerCount(nombre)).toBe(0);
    expect(t.texto()).toBe('Clave: ********\n');
  });

  it('conserva el modo raw si ya estaba activo', async () => {
    const t = terminalSimulada();
    t.entrada.isRaw = true;
    const clave = t.pedir();
    t.entrada.emit('data', 'ficticia\r');
    await expect(clave).resolves.toBe('ficticia');
    expect(t.entrada.isRaw).toBe(true);
  });
});
