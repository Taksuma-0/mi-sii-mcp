import { describe, expect, it } from 'vitest';
import { resumenIva } from '../../src/app/consultas.js';
import type { AnioRenta } from '../../src/app/renta.js';
import type { FilaCartera } from '../../src/app/vigilancia.js';
import { textoCartera, textoPlazos, textoResumenIva, textoResumenRenta } from '../../src/interfaces/formato.js';
import { informeCartera, informeIva, informeRenta, informeVencimientos } from '../../src/interfaces/informes/contenido.js';
import { barras } from '../../src/interfaces/informes/graficos.js';
import { paginaInforme, type ContenidoInforme } from '../../src/interfaces/informes/plantilla.js';
import { declaracion, fila, perfilEmpresa, resumen, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { depsDePrueba } from '../helpers/deps.js';
import { sembrarMes } from '../helpers/sembrar.js';

const GENERADO = '2026-11-02 10:00';
const PELIGROSO = '<script>alert(1)</script> & Cía';
const ESCAPADO = '&lt;script&gt;alert(1)&lt;/script&gt; &amp; Cía';

const contenido = (cambios: Partial<ContenidoInforme> = {}): ContenidoInforme => ({
  titulo: 'IVA 2026-09',
  subtitulo: 'Empresa de prueba (22222222-2)',
  generado: GENERADO,
  tarjetas: [{ etiqueta: 'Débito', valor: '$100.000', estado: 'ok' }],
  graficos: [],
  tablas: [],
  avisos: [],
  ...cambios,
});

const filaCartera = (cambios: Partial<FilaCartera> = {}): FilaCartera => ({
  rut: '22222222-2',
  alias: 'Pyme',
  tipo: 'empresa',
  sesion: 'activa',
  ultimaSincronizacion: '2026-10-30T10:00:00.000Z',
  f29PorVencer: 1,
  f29Vencidos: 0,
  f29PorConfirmar: 0,
  masAntiguoVencido: null,
  hallazgosCriticos: 0,
  proximoPlazo: null,
  avisosSinVer: 0,
  movimientosSinConciliar: null,
  ...cambios,
});

describe('página del informe', () => {
  it('escapa todo texto: una razón social con HTML se ve como texto y no se ejecuta', () => {
    const html = paginaInforme(
      contenido({
        titulo: PELIGROSO,
        subtitulo: PELIGROSO,
        tarjetas: [{ etiqueta: PELIGROSO, valor: PELIGROSO }],
        graficos: [{ titulo: PELIGROSO, svg: barras([{ etiqueta: PELIGROSO, valor: 1 }]) }],
        tablas: [{ titulo: PELIGROSO, encabezados: [PELIGROSO], filas: [[PELIGROSO]] }],
        avisos: [PELIGROSO],
      }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain(ESCAPADO);
    expect(html.split(ESCAPADO).length - 1).toBeGreaterThanOrEqual(8);
  });

  it('no carga nada de fuera: ni fuentes, ni scripts, ni imágenes remotas', () => {
    const html = paginaInforme(contenido({ avisos: ['Fuente: https://www.sii.cl'] }));
    expect(html).not.toMatch(/src="http|href="http|@import|<script/i);
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`);
  });

  it('es un documento completo, listo para imprimir', () => {
    const html = paginaInforme(contenido());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('@media print');
    expect(html).toContain(GENERADO);
  });

  it('abre con la conclusión, antes de las tarjetas', () => {
    const html = paginaInforme(contenido({ conclusion: `⛔ ${PELIGROSO}` }));
    expect(html).toContain(`<p class="conclusion">⛔ ${ESCAPADO}</p>`);
    expect(html.indexOf('class="conclusion"')).toBeLessThan(html.indexOf('class="tarjetas"'));
  });

  it('en las tablas, los montos van a la derecha y las fechas no se parten', () => {
    const html = paginaInforme(contenido({ tablas: [{ titulo: 'T', encabezados: ['Cuenta', 'Monto', 'Datos al'], filas: [['Pyme', '$1.000', '2026-10-30'], ['Otra', '—', '—']] }] }));
    expect(html).toContain('<td>Pyme</td><td class="num">$1.000</td><td class="fecha">2026-10-30</td>');
  });

  it('la tarjeta con estado lleva su ícono y su texto, no solo un color', () => {
    const html = paginaInforme(contenido({ tarjetas: [{ etiqueta: 'F29', valor: 'No presentado', estado: 'critico' }] }));
    expect(html).toMatch(/⛔[^<]*<span[^>]*>Urgente<\/span>/);
  });

  it('una página con una cartera grande pesa menos de 60 KB', () => {
    const filas = Array.from({ length: 40 }, (_, i) => filaCartera({ alias: `Cuenta ${i}`, f29Vencidos: i % 3 }));
    const html = paginaInforme(informeCartera(filas, GENERADO));
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(60_000);
  });
});

describe('gráfico de barras', () => {
  const numeros = (svg: string): number[] => [...svg.matchAll(/(?:height|width|y|x)="(-?[\d.]+)"/g)].map((m) => Number(m[1]));

  it('con un valor 0 o negativo el SVG sigue siendo válido: sin NaN y sin altos negativos', () => {
    const svg = barras([
      { etiqueta: 'A', valor: 0 },
      { etiqueta: 'B', valor: -50_000 },
      { etiqueta: 'C', valor: 100_000 },
    ]);
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect([...svg.matchAll(/height="(-?[\d.]+)"/g)].every((m) => Number(m[1]) >= 0)).toBe(true);
    expect(numeros(svg).every(Number.isFinite)).toBe(true);
  });

  it('con todo en cero no divide por cero', () => {
    expect(barras([{ etiqueta: 'A', valor: 0 }, { etiqueta: 'B', valor: 0 }])).not.toMatch(/NaN|Infinity/);
  });

  it('sin datos no hay gráfico', () => {
    expect(barras([])).toBe('');
  });

  it('cada barra dice su etiqueta y su valor al pasar el mouse, con el formato pedido', () => {
    const svg = barras([{ etiqueta: 'Débito', valor: 100_000 }], { formato: (n) => `$${n}` });
    expect(svg).toContain('<title>Débito: $100000</title>');
  });
});

describe('contenido de cada informe', () => {
  it('informeIva pone el débito y el crédito del mes en tarjetas', () => {
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sembrarMes(store, '2026-09', {
      resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 526_316, 100_000)] }), resumen({ lado: 'COMPRA', filas: [fila(33, 315_789, 60_000)] })],
      declaraciones: [declaracion()],
      valores: [valores({ '538': 100_000, '537': 60_000, '89': 40_000 })],
    });
    const c = informeIva(resumenIva(deps, RUT_EMPRESA, '2026-09'), GENERADO);
    const valoresTarjetas = c.tarjetas.map((t) => t.valor);
    expect(valoresTarjetas).toContain('$100.000');
    expect(valoresTarjetas).toContain('$60.000');
    expect(c.titulo).toBe('IVA 2026-09');
    expect(c.subtitulo).toContain('22222222-2');
    expect(c.generado).toBe(GENERADO);
  });

  it('cada informe dice la misma conclusión que la respuesta del chat', () => {
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sembrarMes(store, '2026-09', { resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000)] })], declaraciones: [] });
    const r = resumenIva(deps, RUT_EMPRESA, '2026-09');
    const plazos = [{ rut: '22222222-2', tipo: 'F29' as const, vence: '2026-10-20', diasRestantes: -1, descripcion: 'F29 vencido', referencia: '2026-09' }];
    const cartera = [filaCartera({ sesion: 'sin_sesion' })];
    const renta = { rut: '11111111-1', anios: [] };
    expect(informeIva(r, GENERADO).conclusion).toBe(textoResumenIva(r).split('\n')[0]);
    expect(informeVencimientos(plazos, GENERADO).conclusion).toBe(textoPlazos(plazos).split('\n')[0]);
    expect(informeCartera(cartera, GENERADO).conclusion).toBe(textoCartera(cartera).split('\n')[0]);
    expect(informeRenta(renta, GENERADO).conclusion).toBe(textoResumenRenta(renta).split('\n')[0]);
  });

  it('informeRenta grafica el resultado de cada año, con la devolución bajo cero', () => {
    const anio = (anioTributario: number, resultado: number): AnioRenta => ({
      anioTributario,
      folio: anioTributario * 10,
      vigente: true,
      declaraciones: 1,
      codigoConclusion: null,
      conclusion: null,
      fechaIngreso: `${anioTributario}-04-15`,
      tipoImpugnado: null,
      impuestoPagado: null,
      montoGiro: null,
      remanenteSolicitado: null,
      remanenteDevuelto: null,
      fechaVencimiento: null,
      codigos: 1,
      codigosClave: [{ codigo: '305', valor: resultado, glosa: 'Resultado' }],
      observaciones: [],
      eventos: [],
      honorariosEmitidos: null,
      terceros: null,
      asistente: null,
      obtenidoEn: '2026-10-21T15:00:00.000Z',
    });
    const c = informeRenta({ rut: '11111111-1', anios: [anio(2026, -145_000), anio(2025, 30_000)] }, GENERADO);
    expect(c.graficos).toHaveLength(1);
    expect(c.graficos[0]!.svg).toContain('AT2026: a devolver $145.000');
    expect(c.tablas[0]!.filas.map((f) => f[0])).toEqual(['AT2026', 'AT2025']);
  });

  it('informeCartera marca con su estado las cuentas que necesitan atención', () => {
    const c = informeCartera([filaCartera(), filaCartera({ rut: '33333333-3', alias: 'Juana', f29Vencidos: 2 })], GENERADO);
    expect(c.tarjetas.find((t) => t.etiqueta === 'Necesitan atención')).toMatchObject({ valor: '1', estado: 'critico' });
    expect(c.tablas[0]!.filas).toHaveLength(2);
  });

  it('informeVencimientos separa los vencidos de los próximos', () => {
    const c = informeVencimientos(
      [
        { rut: '22222222-2', tipo: 'F29', vence: '2026-10-20', diasRestantes: -1, descripcion: 'F29 vencido', referencia: '2026-09' },
        { rut: '22222222-2', tipo: 'F29', vence: '2026-11-20', diasRestantes: 30, descripcion: 'F29 de 2026-10', referencia: '2026-10' },
      ],
      GENERADO,
    );
    expect(c.tarjetas.find((t) => t.etiqueta === 'Vencidos')).toMatchObject({ valor: '1', estado: 'critico' });
    expect(c.tablas[0]!.filas[0]).toEqual(['⛔', '2026-10-20', 'vencido hace 1 día', 'F29 vencido', '22222222-2']);
  });

  it('informeVencimientos muestra aparte, con ⚠️, los F29 sin sincronizar cuyo plazo pasó', () => {
    const c = informeVencimientos(
      [{ rut: '22222222-2', tipo: 'F29', vence: '2026-10-20', diasRestantes: -10, descripcion: 'F29 de 2026-09: sin sincronizar', referencia: '2026-09', porConfirmar: true }],
      GENERADO,
    );
    expect(c.tarjetas.find((t) => t.etiqueta === 'Vencidos')).toMatchObject({ valor: '0', estado: 'ok' });
    expect(c.tarjetas.find((t) => t.etiqueta === 'Por confirmar')).toMatchObject({ valor: '1', estado: 'advertencia' });
    expect(c.tablas[0]!.filas[0]).toEqual(['⚠️', '2026-10-20', 'por confirmar: pasó hace 10 días', 'F29 de 2026-09: sin sincronizar', '22222222-2']);
  });

  it('informeCartera cuenta aparte los F29 por confirmar, como advertencia', () => {
    const c = informeCartera([filaCartera({ f29PorConfirmar: 2 })], GENERADO);
    expect(c.tarjetas.find((t) => t.etiqueta === 'Necesitan atención')).toMatchObject({ valor: '1', estado: 'advertencia' });
    expect(c.tarjetas.find((t) => t.etiqueta === 'F29 por confirmar')).toMatchObject({ valor: '2', estado: 'advertencia' });
    expect(informeCartera([filaCartera()], GENERADO).tarjetas.some((t) => t.etiqueta === 'F29 por confirmar')).toBe(false);
  });
});
