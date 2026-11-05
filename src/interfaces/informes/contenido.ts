import type { ResumenIva } from '../../app/consultas.js';
import type { ResumenRenta } from '../../app/renta.js';
import type { FilaCartera } from '../../app/vigilancia.js';
import { formatearClp } from '../../domain/formato.js';
import type { Plazo, RcvResumenFila } from '../../domain/tipos.js';
import { columnasCartera, conclusionCartera, conclusionIva, conclusionPlazos, conclusionRenta, contarPlazos, cuandoVence, DIAS_PLAZO_CERCANO, fecha, iconoCuenta, iconoPlazo, monto, plural, textoSaldo } from '../formato.js';
import { estado } from '../presentacion.js';
import { barras, type PuntoSerie } from './graficos.js';
import type { ContenidoInforme, EstadoTarjeta, GraficoInforme, TablaInforme } from './plantilla.js';

/**
 * Lo que muestra cada informe, armado solo con lo guardado. Las conclusiones y los íconos son los mismos del chat
 * (formato.ts), para que el informe y la respuesta digan lo mismo.
 */

/** Un gráfico de barras solo con dos valores o más: una sola barra no compara nada. */
function grafico(titulo: string, puntos: readonly PuntoSerie[], formato: (n: number) => string = formatearClp): GraficoInforme[] {
  return puntos.length >= 2 ? [{ titulo, svg: barras(puntos, { formato }) }] : [];
}

const tablaRcv = (titulo: string, filas: readonly RcvResumenFila[]): TablaInforme[] =>
  filas.length === 0
    ? []
    : [
        {
          titulo,
          encabezados: ['Tipo de documento', 'Cantidad', 'Exento', 'Neto', 'IVA', 'Total'],
          filas: filas.map((f) => [f.descripcion ?? `Tipo ${f.tipoDoc}`, String(f.cantidad), formatearClp(f.exento), formatearClp(f.neto), formatearClp(f.iva), formatearClp(f.total)]),
        },
      ];

export function informeIva(r: ResumenIva, generado: string): ContenidoInforme {
  const c = r.comparaciones;
  const criticos = r.hallazgos.filter((h) => h.severidad === 'critico').length;
  const advertencias = r.hallazgos.filter((h) => h.severidad === 'advertencia').length;
  const estadoF29: EstadoTarjeta | undefined = r.f29 ? 'ok' : r.disponibilidad.f29 ? 'advertencia' : undefined;
  const puntos = (
    [
      ['Débito según RCV', c.debitoRcv],
      ['Débito según F29', c.debitoF29],
      ['Crédito según RCV', c.creditoRcv],
      ['Crédito según F29', c.creditoF29],
    ] as const
  ).flatMap(([etiqueta, valor]) => (valor === null ? [] : [{ etiqueta, valor }]));
  return {
    titulo: `IVA ${r.periodo}`,
    subtitulo: `RUT ${r.rut} · datos del RCV al ${fecha(r.frescura.rcv)} y del F29 al ${fecha(r.frescura.f29)}`,
    generado,
    conclusion: conclusionIva(r),
    tarjetas: [
      { etiqueta: 'Débito (ventas RCV)', valor: monto(c.debitoRcv) },
      { etiqueta: 'Crédito (compras RCV)', valor: monto(c.creditoRcv) },
      { etiqueta: 'F29', valor: r.f29 ? `Folio ${r.f29.folio}` : r.disponibilidad.f29 ? 'No presentado' : 'Sin sincronizar', ...(estadoF29 ? { estado: estadoF29 } : {}) },
      ...(r.f29 ? [{ etiqueta: 'Total a pagar del F29', valor: monto(r.f29.totalAPagar) }] : [{ etiqueta: 'Vence con pago', valor: r.venceF29 }]),
      { etiqueta: 'Hallazgos', valor: String(r.hallazgos.length), estado: criticos > 0 ? 'critico' : advertencias > 0 ? 'advertencia' : 'ok' },
    ],
    graficos: grafico('Débito y crédito del mes: RCV frente a F29', puntos),
    tablas: [
      { titulo: 'RCV y F29', encabezados: ['Concepto', 'RCV', 'F29'], filas: [['Débito', monto(c.debitoRcv), monto(c.debitoF29)], ['Crédito', monto(c.creditoRcv), monto(c.creditoF29)]] },
      ...tablaRcv('Ventas por tipo de documento', r.ventas.porTipo),
      ...tablaRcv('Compras por tipo de documento', r.compras.porTipo),
    ],
    avisos: [...r.hallazgos.map((h) => `${estado(h.severidad)} ${h.regla} — ${h.titulo}. ${h.detalle}`)],
  };
}

/** Resultado de la declaración (código 305 del F22): positivo a pagar, negativo a devolver. */
const resultado305 = (a: ResumenRenta['anios'][number]): number | null => a.codigosClave.find((c) => c.codigo === '305')?.valor ?? null;

export function informeRenta(r: ResumenRenta, generado: string): ContenidoInforme {
  const conResultado = r.anios.flatMap((a) => {
    const valor = resultado305(a);
    return valor === null ? [] : [{ etiqueta: `AT${a.anioTributario}`, valor }];
  });
  const observaciones = r.anios.flatMap((a) => a.observaciones.map((o) => `${estado('advertencia')} AT${a.anioTributario} · observación ${o.codigo}: ${o.descripcion ?? 'sin descripción'}`));
  const ultimo = r.anios.find((a) => a.folio !== null);
  const ultimoResultado = ultimo ? resultado305(ultimo) : null;
  return {
    titulo: 'Renta (F22)',
    subtitulo: `RUT ${r.rut} · ${plural(r.anios.length, 'año tributario guardado', 'años tributarios guardados')}`,
    generado,
    conclusion: conclusionRenta(r),
    tarjetas: [
      { etiqueta: 'Años guardados', valor: String(r.anios.length) },
      ...(ultimo ? [{ etiqueta: `Folio vigente AT${ultimo.anioTributario}`, valor: String(ultimo.folio) }] : []),
      ...(ultimo && ultimoResultado !== null ? [{ etiqueta: `Resultado AT${ultimo.anioTributario}`, valor: textoSaldo(ultimoResultado) }] : []),
      { etiqueta: 'Observaciones del SII', valor: String(observaciones.length), estado: observaciones.length > 0 ? 'advertencia' : 'ok' },
    ],
    // Del año más antiguo al más nuevo, como se lee una serie en el tiempo.
    graficos: grafico('Resultado del F22 por año (sobre cero a pagar, bajo cero a devolver)', [...conResultado].reverse(), textoSaldo),
    tablas: [
      {
        titulo: 'Años tributarios',
        encabezados: ['Año', 'Folio', 'Ingreso', 'Resultado (305)', 'Impuesto pagado', 'Devuelto', 'Observaciones'],
        filas: r.anios.map((a) => {
          const valor = resultado305(a);
          return [
            `AT${a.anioTributario}`,
            a.folio === null ? 'sin folio vigente' : String(a.folio),
            a.fechaIngreso ?? '—',
            valor === null ? '—' : textoSaldo(valor),
            a.impuestoPagado === null ? '—' : formatearClp(a.impuestoPagado),
            a.remanenteDevuelto === null ? '—' : formatearClp(a.remanenteDevuelto),
            String(a.observaciones.length),
          ];
        }),
      },
    ],
    avisos: observaciones,
  };
}

export function informeCartera(filas: readonly FilaCartera[], generado: string): ContenidoInforme {
  const iconos = filas.map(iconoCuenta);
  const criticas = iconos.filter((i) => i === estado('critico')).length;
  const atencion = iconos.filter((i) => i !== estado('ok')).length;
  const vencidos = filas.reduce((s, f) => s + f.f29Vencidos, 0);
  const porConfirmar = filas.reduce((s, f) => s + f.f29PorConfirmar, 0);
  const hallazgos = filas.reduce((s, f) => s + f.hallazgosCriticos, 0);
  const sinSesion = filas.filter((f) => f.sesion === 'sin_sesion').length;
  const columnas = columnasCartera(filas);
  return {
    titulo: 'Cartera',
    subtitulo: plural(filas.length, 'cuenta', 'cuentas'),
    generado,
    conclusion: conclusionCartera(filas),
    tarjetas: [
      { etiqueta: 'Cuentas', valor: String(filas.length) },
      { etiqueta: 'Necesitan atención', valor: String(atencion), estado: criticas > 0 ? 'critico' : atencion > 0 ? 'advertencia' : 'ok' },
      { etiqueta: 'F29 vencidos', valor: String(vencidos), estado: vencidos > 0 ? 'critico' : 'ok' },
      ...(porConfirmar > 0 ? [{ etiqueta: 'F29 por confirmar', valor: String(porConfirmar), estado: 'advertencia' as const }] : []),
      { etiqueta: 'Hallazgos críticos', valor: String(hallazgos), estado: hallazgos > 0 ? 'critico' : 'ok' },
      { etiqueta: 'Sin sesión', valor: String(sinSesion), estado: sinSesion > 0 ? 'advertencia' : 'ok' },
    ],
    graficos: grafico(
      'F29 vencidos por cuenta',
      filas.filter((f) => f.f29Vencidos > 0).map((f) => ({ etiqueta: f.alias, valor: f.f29Vencidos })),
      (n) => plural(n, 'F29', 'F29'),
    ),
    tablas: filas.length > 0 ? [{ titulo: 'Cuentas', encabezados: columnas.encabezados, filas: columnas.filas }] : [],
    avisos: [],
  };
}

export function informeVencimientos(plazos: readonly Plazo[], generado: string): ContenidoInforme {
  const { vencido: vencidos, por_confirmar: porConfirmar, cercano: cercanos, despues } = contarPlazos(plazos);
  return {
    titulo: 'Vencimientos',
    subtitulo: plural(plazos.length, 'plazo', 'plazos'),
    generado,
    conclusion: conclusionPlazos(plazos),
    tarjetas: [
      { etiqueta: 'Vencidos', valor: String(vencidos), estado: vencidos > 0 ? 'critico' : 'ok' },
      ...(porConfirmar > 0 ? [{ etiqueta: 'Por confirmar', valor: String(porConfirmar), estado: 'advertencia' as const }] : []),
      { etiqueta: `En ${DIAS_PLAZO_CERCANO} días o menos`, valor: String(cercanos), estado: cercanos > 0 ? 'advertencia' : 'ok' },
      { etiqueta: 'Más adelante', valor: String(despues) },
    ],
    graficos: [],
    tablas:
      plazos.length > 0
        ? [{ titulo: 'Plazos', encabezados: ['Estado', 'Vence', 'Cuándo', 'Qué', 'RUT'], filas: plazos.map((p) => [iconoPlazo(p), p.vence, cuandoVence(p), p.descripcion, p.rut]) }]
        : [],
    avisos: [],
  };
}
