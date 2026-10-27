import { Command, InvalidArgumentError, Option } from 'commander';
import { documentos, f29Historial, hallazgos, plazos, resumenIva } from '../../app/consultas.js';
import type { DepsApp } from '../../app/deps.js';
import { agregarPerfil, listarPerfiles, registrarIdentidad } from '../../app/perfiles.js';
import { sincronizar, type Superficie } from '../../app/sincronizar.js';
import { esErrorImpuestocl } from '../../domain/errores.js';
import { parsePeriodo } from '../../domain/periodo.js';
import { parseRut } from '../../domain/rut.js';
import type { EstadoRcv, Lado, Severidad, TipoContribuyente } from '../../domain/tipos.js';
import { VERSION } from '../../main/version.js';
import type { EstadoSesion, ResultadoLogin } from '../../ports/index.js';
import { lineaReintento, textoDocumentos, textoHallazgos, textoHistorialF29, textoPerfiles, textoPlazos, textoResumenIva, textoSync } from '../formato.js';

export interface IoCli {
  escribir(texto: string): void;
  error(texto: string): void;
  pedirClave(pregunta: string): Promise<string>;
  leerStdin(): Promise<string>;
}

export interface SesionesCli {
  loginInteractivo(rut: string, clave: string, guardarClave: boolean): Promise<ResultadoLogin>;
  logout(rut: string, olvidarClave: boolean): Promise<void>;
  estado(rut: string): EstadoSesion;
}

export interface ContenedorCli {
  readonly deps: DepsApp;
  readonly sesiones: SesionesCli;
  readonly config: { readonly home: string; readonly rutaDb: string };
  cerrar(): void;
}

function numeroFinito(valor: string): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) throw new InvalidArgumentError('Debe ser un número finito.');
  return numero;
}

export function crearPrograma(
  io: IoCli,
  obtener: () => ContenedorCli,
  iniciarMcp: (c: ContenedorCli) => void | Promise<void>,
): { programa: Command; salida: { codigo: number } } {
  const salida = { codigo: 0 };
  const programa = new Command('impuestocl')
    .description('IVA mensual conciliado con datos del SII. Herramienta no oficial; no es asesoría tributaria.')
    .version(VERSION)
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.escribir(s.trimEnd()), writeErr: (s) => io.error(s.trimEnd()) });

  const ejecutar =
    <A extends unknown[]>(accion: (c: ContenedorCli, ...args: A) => void | Promise<void>) =>
    async (...args: A): Promise<void> => {
      const c = obtener();
      try {
        await accion(c, ...args);
      } catch (e) {
        if (!esErrorImpuestocl(e)) throw e;
        io.error(`Error [${e.codigo}]: ${e.message}\n→ ${e.accion}\n${lineaReintento(e.codigo)}`);
        salida.codigo = 1;
      } finally {
        c.cerrar();
      }
    };
  const mostrar = (json: boolean | undefined, datos: unknown, texto: string): void => io.escribir(json ? JSON.stringify(datos, null, 2) : texto);

  const perfil = programa.command('perfil').description('Administra los contribuyentes (persona natural y empresa)');
  perfil
    .command('agregar')
    .argument('<rut>')
    .requiredOption('--alias <alias>', 'nombre corto para reconocerlo')
    .addOption(new Option('--tipo <tipo>', 'persona o empresa').choices(['persona', 'empresa']).makeOptionMandatory())
    .option('--representa <ruts...>', 'RUT de las empresas que representa')
    .action(
      ejecutar((c, rut: string, o: { alias: string; tipo: TipoContribuyente; representa?: string[] }) => {
        const p = agregarPerfil(c.deps, { rut, alias: o.alias, tipo: o.tipo, representa: o.representa ?? [] });
        io.escribir(`Perfil guardado: ${p.rut} ${p.alias} (${p.tipo}).`);
      }),
    );
  perfil
    .command('listar')
    .option('--json', 'salida en JSON')
    .action(
      ejecutar((c, o: { json?: boolean }) => {
        const ps = listarPerfiles(c.deps);
        mostrar(o.json, ps, textoPerfiles(ps));
      }),
    );

  programa
    .command('login')
    .description('Inicia sesión en el SII con la clave tributaria (se pide oculta; un solo intento)')
    .argument('<rut>')
    .option('--guardar-clave', 'guarda la clave en el llavero del sistema para renovar la sesión sola')
    .option('--clave-stdin', 'lee la clave desde la entrada estándar')
    .action(
      ejecutar(async (c, rut: string, o: { guardarClave?: boolean; claveStdin?: boolean }) => {
        const canonico = parseRut(rut).canonico;
        const clave = o.claveStdin ? await io.leerStdin() : await io.pedirClave(`Clave tributaria de ${canonico}: `);
        const r = await c.sesiones.loginInteractivo(canonico, clave, Boolean(o.guardarClave));
        registrarIdentidad(c.deps, r.identidad);
        const nota = o.guardarClave
          ? r.claveGuardada
            ? ' Clave guardada en el llavero del sistema.'
            : ' No se pudo guardar la clave en el llavero; tendrás que ingresarla cuando expire la sesión.'
          : '';
        io.escribir(`Sesión iniciada: ${r.identidad.nombre} (${r.identidad.rut}, ${r.identidad.tipo}).${nota}`);
      }),
    );

  programa
    .command('logout')
    .argument('<rut>')
    .option('--olvidar-clave', 'borra también la clave del llavero')
    .action(
      ejecutar(async (c, rut: string, o: { olvidarClave?: boolean }) => {
        await c.sesiones.logout(rut, Boolean(o.olvidarClave));
        io.escribir(`Sesión cerrada para ${parseRut(rut).canonico}.`);
      }),
    );

  programa
    .command('sync')
    .description('Trae RCV y F29 del SII a la base local')
    .argument('<rut>')
    .requiredOption('--desde <AAAA-MM>', 'primer mes')
    .option('--hasta <AAAA-MM>', 'último mes (por defecto, el mismo de --desde)')
    .addOption(new Option('--solo <superficie>', 'rcv o f29').choices(['rcv', 'f29']))
    .action(
      ejecutar(async (c, rut: string, o: { desde: string; hasta?: string; solo?: Superficie }) => {
        const r = await sincronizar(c.deps, rut, parsePeriodo(o.desde), parsePeriodo(o.hasta ?? o.desde), o.solo ? [o.solo] : ['rcv', 'f29']);
        io.escribir(textoSync(r));
        if (r.abortado || r.periodos.some((p) => p.errores.length > 0)) salida.codigo = 1;
      }),
    );

  programa
    .command('iva')
    .description('Resumen de IVA conciliado de un mes (lee la base local)')
    .argument('<rut>')
    .argument('<periodo>', 'AAAA-MM')
    .option('--json', 'salida en JSON')
    .action(
      ejecutar((c, rut: string, periodo: string, o: { json?: boolean }) => {
        const r = resumenIva(c.deps, rut, periodo);
        mostrar(o.json, r, textoResumenIva(r));
      }),
    );

  programa
    .command('hallazgos')
    .argument('<rut>')
    .option('--desde <AAAA-MM>')
    .option('--hasta <AAAA-MM>')
    .addOption(new Option('--severidad <severidad>').choices(['info', 'advertencia', 'critico']))
    .option('--json', 'salida en JSON')
    .action(
      ejecutar((c, rut: string, o: { desde?: string; hasta?: string; severidad?: Severidad; json?: boolean }) => {
        const hs = hallazgos(c.deps, rut, { desde: o.desde, hasta: o.hasta, severidad: o.severidad });
        mostrar(o.json, hs, textoHallazgos(hs));
      }),
    );

  programa
    .command('plazos')
    .argument('<rut>')
    .option('--dias <n>', 'horizonte en días', numeroFinito, 30)
    .option('--json', 'salida en JSON')
    .action(
      ejecutar((c, rut: string, o: { dias: number; json?: boolean }) => {
        const ps = plazos(c.deps, rut, o.dias);
        mostrar(o.json, ps, textoPlazos(ps));
      }),
    );

  programa
    .command('historial')
    .description('Historial del F29 por mes')
    .argument('<rut>')
    .requiredOption('--desde <AAAA-MM>')
    .requiredOption('--hasta <AAAA-MM>')
    .option('--json', 'salida en JSON')
    .action(
      ejecutar((c, rut: string, o: { desde: string; hasta: string; json?: boolean }) => {
        const h = f29Historial(c.deps, rut, o.desde, o.hasta);
        mostrar(o.json, h, textoHistorialF29(h));
      }),
    );

  programa
    .command('documentos')
    .argument('<rut>')
    .argument('<periodo>', 'AAAA-MM')
    .addOption(new Option('--lado <lado>').choices(['COMPRA', 'VENTA']))
    .addOption(new Option('--estado <estado>').choices(['REGISTRO', 'PENDIENTE', 'NO_INCLUIR', 'RECLAMADO']))
    .option('--pagina <n>', 'página', numeroFinito, 1)
    .option('--json', 'salida en JSON')
    .action(
      ejecutar((c, rut: string, periodo: string, o: { lado?: Lado; estado?: EstadoRcv; pagina: number; json?: boolean }) => {
        const p = documentos(c.deps, rut, periodo, { lado: o.lado, estado: o.estado }, o.pagina);
        mostrar(o.json, p, textoDocumentos(p));
      }),
    );

  programa
    .command('mcp')
    .description('Inicia el servidor MCP por stdio (para Claude Desktop, Claude Code y otros agentes)')
    .action(async () => {
      await iniciarMcp(obtener());
    });

  programa
    .command('diagnostico')
    .option('--json', 'salida en JSON')
    .action(
      ejecutar((c, o: { json?: boolean }) => {
        const datos = { version: VERSION, home: c.config.home, baseDeDatos: c.config.rutaDb, perfiles: listarPerfiles(c.deps) };
        mostrar(o.json, datos, [`impuestocl ${VERSION}`, `Datos: ${c.config.home}`, `Base: ${c.config.rutaDb}`, textoPerfiles(datos.perfiles)].join('\n'));
      }),
    );

  return { programa, salida };
}
