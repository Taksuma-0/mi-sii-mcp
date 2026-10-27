import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { leerLineaStdin, pedirClaveOculta } from '../../src/interfaces/cli/clave.js';
import { crearPrograma, type ContenedorCli, type IoCli, type SesionesCli } from '../../src/interfaces/cli/programa.js';
import { boleta, declaracion, declaracionF22, detalleF22, documento, empresaAutorizada, fila, perfilEmpresa, perfilTributario, propuesta, resumen, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { depsDePrueba } from '../helpers/deps.js';
import { guardarPdfF29, pdfFalso } from '../helpers/lector-falso.js';
import { sembrarMes, T_SEMBRADO } from '../helpers/sembrar.js';

function entorno(o: { claveStdin?: string; fallaAlAbrir?: Error; falloNavegador?: Error } = {}) {
  const p = depsDePrueba({ fallaAlAbrir: o.fallaAlAbrir });
  const salidaTexto: string[] = [];
  const errores: string[] = [];
  const logins: { rut: string; clave: string; guardar: boolean }[] = [];
  const navegador: (string | undefined)[] = [];
  const contadores = { cerrado: 0, mcp: 0 };
  const sesiones: SesionesCli = {
    loginInteractivo: async (rut, clave, guardar) => {
      logins.push({ rut, clave, guardar });
      return { identidad: { rut: RUT_EMPRESA, nombre: 'EMPRESA DEMO SPA', razonSocial: 'EMPRESA DEMO SPA', tipo: 'empresa' }, claveGuardada: guardar };
    },
    loginNavegador: async (rut) => {
      navegador.push(rut);
      if (o.falloNavegador) throw o.falloNavegador;
      return { rut: '33333333-3', nombre: 'JUANA PÉREZ', razonSocial: null, tipo: 'persona' };
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
  return { ...p, correr, salidaTexto, errores, logins, navegador, contadores };
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

  it('login-navegador abre el navegador, registra la identidad (puede ser una persona) y avisa que no se renueva sola', async () => {
    const e = entorno();
    expect(await e.correr('login-navegador')).toBe(0);
    expect(e.navegador).toEqual([undefined]);
    expect(e.store.contribuyente('33333333-3')).toMatchObject({ tipo: 'persona', alias: 'JUANA PÉREZ' });
    expect(e.salidaTexto.join(' ')).toContain('ClaveÚnica');
    expect(e.salidaTexto.at(-1)).toContain('Sesión iniciada desde el navegador: JUANA PÉREZ (33333333-3, persona)');
    expect(e.salidaTexto.at(-1)).toContain('no se renueva sola');
  });

  it('login-navegador --rut pasa el RUT esperado y un rechazo sale con 1', async () => {
    const e = entorno({ falloNavegador: new ErrorImpuestocl('SIN_PERMISO', 'En el navegador se inició sesión como 33333333-3, no como 22222222-2.') });
    expect(await e.correr('login-navegador', '--rut', '22.222.222-2')).toBe(1);
    expect(e.navegador).toEqual(['22.222.222-2']);
    expect(e.errores[0]).toContain('Error [SIN_PERMISO]');
    expect(e.store.contribuyentes()).toEqual([]);
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

  it('sync --solo acepta varias superficies, incluida la propuesta', async () => {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa());
    e.sii.declaraciones.set('2026-09', [declaracion()]);
    e.sii.valores.set('2026-09|555001', valores({ '538': 190_000, '537': 0 }));
    e.sii.propuestas.set('2026-09', propuesta());
    expect(await e.correr('sync', RUT_EMPRESA, '--desde', '2026-09', '--solo', 'f29', 'propuesta')).toBe(0);
    expect(e.salidaTexto.at(-1)).toContain('2026-09: F29 folio 555001 · propuesta con datos');
    expect(e.salidaTexto.at(-1)).not.toContain('documentos RCV');
    expect(e.store.propuestaF29(RUT_EMPRESA, '2026-09')).toEqual(propuesta());
  });

  it('sync --solo propuesta trae solo la propuesta; sin --solo no la trae', async () => {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa());
    e.sii.propuestas.set('2026-09', propuesta());
    expect(await e.correr('sync', RUT_EMPRESA, '--desde', '2026-09', '--solo', 'propuesta')).toBe(0);
    expect(e.sii.llamadas).toEqual(['propuesta|2026-09']);
    e.sii.llamadas.length = 0;
    expect(await e.correr('sync', RUT_EMPRESA, '--desde', '2026-09')).toBe(0);
    expect(e.sii.llamadas.some((l) => l.startsWith('propuesta'))).toBe(false);
  });

  it('sync --solo bhe trae solo las boletas de honorarios recibidas', async () => {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa());
    e.sii.bhe.set('2026-09', { boletas: [boleta()], totales: { total: 1, bruto: 1_000_000, retencion: 152_500, liquido: 847_500 } });
    expect(await e.correr('sync', RUT_EMPRESA, '--desde', '2026-09', '--solo', 'bhe')).toBe(0);
    expect(e.sii.llamadas).toEqual(['bhe|2026-09']);
    expect(e.salidaTexto.at(-1)).toContain('2026-09: 1 boleta de honorarios');
    expect(e.store.boletasHonorarios(RUT_EMPRESA, '2026-09')).toEqual([boleta()]);
  });

  it('sync --solo con una superficie desconocida se rechaza', async () => {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa());
    await expect(e.correr('sync', RUT_EMPRESA, '--desde', '2026-09', '--solo', 'f22')).rejects.toMatchObject({ code: 'commander.invalidArgument' });
    expect(e.sii.llamadas).toEqual([]);
  });

  it('releer-f29 relee los PDF guardados del rango sin abrir el SII', async () => {
    const e = entorno({ fallaAlAbrir: new Error('No debe abrir el SII') });
    e.store.guardarContribuyente(perfilEmpresa());
    sembrarMes(e.store, '2026-09', { declaraciones: [declaracion()], valores: [valores({ '538': 199_500, '537': 19_000, '89': 180_500 })] });
    sembrarMes(e.store, '2026-08', { declaraciones: [declaracion({ periodo: '2026-08', folio: 444_001 })] });
    guardarPdfF29(e.store, { periodo: '2026-09', folio: 555_001, cuerpo: pdfFalso({ '538': 199_500, '537': 19_000, '89': 180_500, '91': 180_500, '547': 180_500 }), obtenidoEn: T_SEMBRADO });
    guardarPdfF29(e.store, { periodo: '2026-08', folio: 444_001, cuerpo: pdfFalso({}), obtenidoEn: T_SEMBRADO });

    expect(await e.correr('releer-f29', RUT_EMPRESA, '--desde', '2026-09', '--hasta', '2026-09')).toBe(0);
    expect(e.salidaTexto.at(-1)).toContain('2026-09 folio 555001: actualizado (códigos 547, 91)');
    expect(e.salidaTexto.at(-1)).not.toContain('2026-08');
    expect(e.sii.llamadas).toEqual([]);

    expect(await e.correr('releer-f29', RUT_EMPRESA, '--json')).toBe(0);
    const datos = JSON.parse(e.salidaTexto.at(-1)!);
    expect(datos.folios.map((f: { periodo: string; resultado: string }) => `${f.periodo}:${f.resultado}`)).toEqual(['2026-08:ilegible', '2026-09:sin_cambios']);
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

describe('CLI: cuenta del SII', () => {
  function conCuenta() {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa());
    e.sii.perfil = perfilTributario();
    e.sii.empresas = [empresaAutorizada({ rutEmpresa: RUT_EMPRESA }), empresaAutorizada()];
    return e;
  }

  it('perfil sincronizar <rut> trae el perfil tributario y las empresas autorizadas', async () => {
    const e = conCuenta();

    expect(await e.correr('perfil', 'sincronizar', '22.222.222-2')).toBe(0);

    expect(e.sii.llamadas).toEqual(['perfil', 'empresas']);
    expect(e.salidaTexto.at(-1)).toContain('Cuenta 22222222-2');
    expect(e.salidaTexto.at(-1)).toContain('día 20: autorizado');
    expect(e.store.contribuyente(RUT_EMPRESA)?.representa).toEqual(['33333333-3']);
    expect(e.persistidos).toEqual([RUT_EMPRESA]);
  });

  it('--json imprime el resultado y un error de una superficie deja el código de salida en 1', async () => {
    const e = conCuenta();
    e.sii.perfil = null;

    expect(await e.correr('perfil', 'sincronizar', RUT_EMPRESA, '--json')).toBe(1);

    expect(JSON.parse(e.salidaTexto.at(-1)!)).toMatchObject({ rut: RUT_EMPRESA, perfil: 'sin_leer', empresas: 2, errores: [{ superficie: 'cuenta.perfil', codigo: 'PORTAL_CAMBIO' }] });
  });

  it('un RUT sin perfil es un error de dominio con código de salida 1', async () => {
    const e = entorno();
    expect(await e.correr('perfil', 'sincronizar', RUT_EMPRESA)).toBe(1);
    expect(e.errores.at(-1)).toContain('PERFIL_NO_EXISTE');
  });

  it('perfil listar muestra la cuenta leída', async () => {
    const e = conCuenta();
    await e.correr('perfil', 'sincronizar', RUT_EMPRESA);
    await e.correr('perfil', 'listar');
    expect(e.salidaTexto.at(-1)).toContain('día 20: autorizado');
  });
});

describe('CLI: renta F22', () => {
  function conRenta() {
    const e = entorno();
    e.store.guardarContribuyente(perfilEmpresa());
    e.sii.f22.set(2025, [declaracionF22({ anioTributario: 2025, folio: 55 })]);
    e.sii.f22.set(2026, [declaracionF22()]);
    e.sii.f22Detalles.set('2026|123456789', detalleF22());
    e.sii.f22Detalles.set('2025|55', detalleF22());
    return e;
  }

  it('renta sync <rut> --desde AAAA [--hasta AAAA] trae los años y renta ver los muestra', async () => {
    const e = conRenta();

    expect(await e.correr('renta', 'sync', '22.222.222-2', '--desde', '2025', '--hasta', '2026')).toBe(0);

    expect(e.sii.llamadas).toEqual(['f22|2025', 'f22detalle|2025|55', 'f22|2026', 'f22detalle|2026|123456789']);
    expect(e.salidaTexto.at(-1)).toContain('AT2026: 1 declaración · folio vigente 123456789 · detalle leído');
    expect(e.persistidos).toEqual([RUT_EMPRESA]);

    expect(await e.correr('renta', 'ver', RUT_EMPRESA)).toBe(0);
    expect(e.salidaTexto.at(-1)).toContain('2 años tributarios guardados');
    expect(await e.correr('renta', 'ver', RUT_EMPRESA, '--anio', '2025', '--json')).toBe(0);
    expect(JSON.parse(e.salidaTexto.at(-1)!)).toMatchObject({ rut: RUT_EMPRESA, anios: [{ anioTributario: 2025, folio: 55 }] });
  });

  it('un error de un año deja el código de salida en 1; un año inválido es un error de dominio', async () => {
    const e = conRenta();
    e.sii.fallas.set('f22|2026', new ErrorImpuestocl('SII_RECHAZO', 'Servicio no disponible.'));
    expect(await e.correr('renta', 'sync', RUT_EMPRESA, '--desde', '2026', '--json')).toBe(1);
    expect(JSON.parse(e.salidaTexto.at(-1)!)).toMatchObject({ anios: [{ anioTributario: 2026, errores: [{ superficie: 'f22', codigo: 'SII_RECHAZO' }] }] });

    expect(await e.correr('renta', 'sync', RUT_EMPRESA, '--desde', '2026-04')).toBe(1);
    expect(e.errores.at(-1)).toContain('PERIODO_INVALIDO');
  });
});
