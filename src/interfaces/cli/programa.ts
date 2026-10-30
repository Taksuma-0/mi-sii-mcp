import { Command, InvalidArgumentError, Option } from 'commander';
import { documentos, f29Historial, hallazgos, plazos, resumenIva } from '../../app/consultas.js';
import { sincronizarCuenta } from '../../app/cuenta.js';
import type { DepsApp } from '../../app/deps.js';
import { agregarPerfil, listarPerfiles, listarPerfilesConRenovacion, registrarIdentidad } from '../../app/perfiles.js';
import { releerF29 } from '../../app/releer-f29.js';
import { resumenRenta, sincronizarRenta } from '../../app/renta.js';
import { sincronizar, type Superficie } from '../../app/sincronizar.js';
import { vigilar } from '../../app/vigilancia.js';
import { esErrorMiSiiMcp } from '../../domain/errores.js';
import { parsePeriodo } from '../../domain/periodo.js';
import { parseRut } from '../../domain/rut.js';
import type { EstadoRcv, Lado, Severidad, TipoContribuyente } from '../../domain/tipos.js';
import { VERSION } from '../../main/version.js';
import type { EstadoSesion, IdentidadSii, Notificador, ResultadoLogin, TareaProgramada } from '../../ports/index.js';
import { lineaReintento, textoAvisos, textoCuenta, textoDocumentos, textoHallazgos, textoHistorialF29, textoPerfiles, textoPlazos, textoReleerF29, textoRenta, textoResumenIva, textoResumenRenta, textoSync } from '../formato.js';

export interface IoCli {
  escribir(texto: string): void;
  error(texto: string): void;
  pedirClave(pregunta: string): Promise<string>;
  leerStdin(): Promise<string>;
}

export interface SesionesCli {
  loginInteractivo(rut: string, clave: string, guardarClave: boolean): Promise<ResultadoLogin>;
  /** Abre el navegador para que la persona entre (ClaveÚnica o clave) y guarda la sesión; devuelve solo la identidad. */
  loginNavegador(rutEsperado?: string): Promise<IdentidadSii>;
  logout(rut: string, olvidarClave: boolean): Promise<void>;
  estado(rut: string): EstadoSesion;
}

export interface ContenedorCli {
  readonly deps: DepsApp;
  readonly sesiones: SesionesCli;
  /** Notificaciones del sistema para la revisión diaria. */
  readonly notificador: Notificador;
  /** La revisión diaria programada en el sistema. */
  readonly tarea: TareaProgramada;
  readonly config: { readonly home: string; readonly rutaDb: string; readonly plazoNavegadorMs: number };
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
  const programa = new Command('mi-sii-mcp')
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
        if (!esErrorMiSiiMcp(e)) throw e;
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
    .option('--accede-con <rut>', 'RUT de la identidad con cuya sesión se entra al SII (p. ej., quien representa a la empresa)')
    .action(
      ejecutar((c, rut: string, o: { alias: string; tipo: TipoContribuyente; representa?: string[]; accedeCon?: string }) => {
        const p = agregarPerfil(c.deps, { rut, alias: o.alias, tipo: o.tipo, representa: o.representa ?? [], ...(o.accedeCon ? { accedeCon: o.accedeCon } : {}) });
        const acceso = p.accedeCon
          ? ` Sin sesión propia, accede con ${p.accedeCon}: solo el RCV (lectura por representación sin confirmar en vivo); el resto exige la sesión de ${p.rut}.`
          : '';
        io.escribir(`Perfil guardado: ${p.rut} ${p.alias} (${p.tipo}).${acceso}`);
      }),
    );
  perfil
    .command('listar')
    .option('--json', 'salida en JSON')
    .action(
      ejecutar(async (c, o: { json?: boolean }) => {
        const ps = await listarPerfilesConRenovacion(c.deps);
        mostrar(o.json, ps, textoPerfiles(ps));
      }),
    );

  perfil
    .command('sincronizar')
    .description('Trae del SII el perfil tributario (día 20, régimen) y las empresas autorizadas, y actualiza a quién representa el perfil')
    .argument('<rut>')
    .option('--json', 'salida en JSON')
    .action(
      ejecutar(async (c, rut: string, o: { json?: boolean }) => {
        const r = await sincronizarCuenta(c.deps, rut);
        mostrar(o.json, r, textoCuenta(r));
        if (r.abortado || r.errores.length > 0) salida.codigo = 1;
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
    .command('login-navegador')
    .description('Inicia sesión en el SII desde tu navegador (Edge o Chrome), con ClaveÚnica o clave tributaria; mi-sii-mcp no ve la clave')
    .option('--rut <rut>', 'RUT con que esperas entrar; si entras con otro, no se guarda la sesión')
    .action(
      ejecutar(async (c, o: { rut?: string }) => {
        const minutos = Math.round(c.config.plazoNavegadorMs / 60_000);
        io.escribir(
          `Se abrirá una ventana del navegador en la página del SII. Entra ahí con tu ClaveÚnica o tu clave tributaria; mi-sii-mcp no ve ni guarda tu clave. Tienes ${minutos} minutos; la ventana se cierra sola al terminar.`,
        );
        const identidad = await c.sesiones.loginNavegador(o.rut);
        registrarIdentidad(c.deps, identidad);
        io.escribir(
          `Sesión iniciada desde el navegador: ${identidad.nombre} (${identidad.rut}, ${identidad.tipo}). Esta sesión no se renueva sola: cuando venza, vuelve a ejecutar login-navegador.`,
        );
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
    .description('Trae RCV y F29 del SII a la base local (con --solo propuesta, la propuesta de F29; con --solo bhe, las boletas de honorarios recibidas)')
    .argument('<rut>')
    .requiredOption('--desde <AAAA-MM>', 'primer mes')
    .option('--hasta <AAAA-MM>', 'último mes (por defecto, el mismo de --desde)')
    .addOption(new Option('--solo <superficies...>', 'una o varias de: rcv, f29, propuesta, bhe (por defecto rcv y f29)').choices(['rcv', 'f29', 'propuesta', 'bhe']))
    .action(
      ejecutar(async (c, rut: string, o: { desde: string; hasta?: string; solo?: Superficie[] }) => {
        const r = await sincronizar(c.deps, rut, parsePeriodo(o.desde), parsePeriodo(o.hasta ?? o.desde), o.solo ? [...new Set(o.solo)] : ['rcv', 'f29']);
        io.escribir(textoSync(r));
        if (r.abortado || r.periodos.some((p) => p.errores.length > 0)) salida.codigo = 1;
      }),
    );

  const renta = programa.command('renta').description('Renta anual (F22) por año tributario (el año comercial + 1)');

  renta
    .command('sync')
    .description('Trae del SII la renta (F22) de uno o varios años tributarios (máximo 10): declaraciones, detalle del folio vigente y, de una persona, sus boletas de honorarios emitidas del año comercial (informe anual y detalle por boleta), y lo informado por terceros (DJ como la 1879 o la 1887)')
    .argument('<rut>')
    .requiredOption('--desde <AAAA>', 'primer año tributario')
    .option('--hasta <AAAA>', 'último año tributario (por defecto, el mismo de --desde)')
    .option('--json', 'salida en JSON')
    .action(
      ejecutar(async (c, rut: string, o: { desde: string; hasta?: string; json?: boolean }) => {
        const r = await sincronizarRenta(c.deps, rut, o.desde, o.hasta);
        mostrar(o.json, r, textoRenta(r));
        if (r.abortado || r.anios.some((a) => a.errores.length > 0)) salida.codigo = 1;
      }),
    );

  renta
    .command('ver')
    .description('Muestra la renta (F22) guardada (lee la base local)')
    .argument('<rut>')
    .option('--anio <AAAA>', 'solo un año tributario')
    .option('--json', 'salida en JSON')
    .action(
      ejecutar(async (c, rut: string, o: { anio?: string; json?: boolean }) => {
        const r = resumenRenta(c.deps, rut, o.anio);
        mostrar(o.json, r, textoResumenRenta(r));
      }),
    );

  programa
    .command('releer-f29')
    .description('Relee los PDF del F29 ya guardados con el lector actual, sin ir al SII')
    .argument('<rut>')
    .option('--desde <AAAA-MM>', 'primer mes (por defecto, todos los guardados)')
    .option('--hasta <AAAA-MM>', 'último mes')
    .option('--json', 'salida en JSON')
    .action(
      ejecutar(async (c, rut: string, o: { desde?: string; hasta?: string; json?: boolean }) => {
        const r = await releerF29(c.deps, rut, o.desde, o.hasta);
        mostrar(o.json, r, textoReleerF29(r));
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
    .command('vigilar')
    .description('Revisión diaria: trae del SII el mes anterior y el actual de cada cuenta, revisa hallazgos y vencimientos y registra los avisos nuevos (solo lee el SII)')
    .option('--notificar', 'muestra una notificación del sistema con los avisos que aún no se notificaron')
    .action(
      ejecutar(async (c, opciones: { notificar?: boolean }) => {
        const r = await vigilar(c.deps);
        const ok = r.revisadas.filter((x) => x.estado === 'ok').length;
        const sinSesion = r.revisadas.filter((x) => x.estado === 'sin_sesion').length;
        const conError = r.revisadas.length - ok - sinSesion;
        io.escribir(
          [`Revisión de ${r.revisadas.length} ${r.revisadas.length === 1 ? 'cuenta' : 'cuentas'}: ${ok} al día, ${sinSesion} sin sesión, ${conError} con error. Avisos nuevos: ${r.nuevos.length}.`, ...textoAvisos(r.nuevos)].join('\n'),
        );
        if (!opciones.notificar) return;
        const pendientes = c.deps.store.avisos({ sinNotificar: true });
        if (pendientes.length === 0) return;
        const titulos = pendientes.slice(0, 3).map((a) => a.titulo).join(' · ');
        const resto = pendientes.length > 3 ? ` y ${pendientes.length - 3} más` : '';
        const titulo = `mi-sii-mcp: ${pendientes.length} ${pendientes.length === 1 ? 'aviso nuevo' : 'avisos nuevos'}`;
        if (await c.notificador.notificar(titulo, `${titulos}${resto}. Pide «novedades» al asistente o abre «Abrir mi-sii-mcp.cmd».`)) {
          c.deps.store.marcarAvisos(pendientes.map((a) => a.id), 'notificado', c.deps.reloj.ahora().toISOString());
        }
      }),
    );

  const avisos = programa.command('avisos').description('Revisión diaria programada en Windows (Programador de tareas)');
  avisos
    .command('activar')
    .description('Programa la revisión diaria con notificación')
    .option('--hora <HH:MM>', 'hora de la revisión', '09:00')
    .action(
      ejecutar(async (c, opciones: { hora: string }) => {
        await c.tarea.activar(opciones.hora);
        io.escribir(`Revisión diaria activada: cada día a las ${opciones.hora}.`);
      }),
    );
  avisos
    .command('desactivar')
    .description('Quita la revisión diaria')
    .action(
      ejecutar(async (c) => {
        await c.tarea.desactivar();
        io.escribir('Revisión diaria desactivada.');
      }),
    );
  avisos
    .command('estado')
    .description('Dice si la revisión diaria está activa y a qué hora')
    .action(
      ejecutar(async (c) => {
        const e = await c.tarea.estado();
        io.escribir(e.activa ? `Revisión diaria: activa, cada día a las ${e.hora ?? '(hora no leída)'}.` : 'Revisión diaria: desactivada.');
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
        mostrar(o.json, datos, [`mi-sii-mcp ${VERSION}`, `Datos: ${c.config.home}`, `Base: ${c.config.rutaDb}`, textoPerfiles(datos.perfiles)].join('\n'));
      }),
    );

  return { programa, salida };
}
