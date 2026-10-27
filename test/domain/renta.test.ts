import { describe, expect, it } from 'vitest';
import {
  compararConBoletas,
  compararConF22,
  cruzarHonorariosF22,
  cruzarInformanteBoletas,
  cruzarRetencionTerceros,
  diferenciaConAnual,
  f22Vigente,
  hayBoletasEmitidas,
  pagadoresBheEmitidas,
  parseAnioTributario,
  periodoRenta,
  rangoAnios,
  totalesBheEmitidas,
} from '../../src/domain/renta.js';
import type { F22Valor } from '../../src/domain/tipos.js';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { boletaEmitida, declaracionF22, djTercero, informeBheEmitidas, mesBheEmitida } from '../helpers/fabricas.js';

/** Código del ErrorImpuestocl que lanza la función, o una descripción si no lanza así. */
function codigoDe(fn: () => unknown): string {
  try {
    fn();
    return 'sin error';
  } catch (e) {
    return e instanceof ErrorImpuestocl ? e.codigo : `otro error: ${String(e)}`;
  }
}

describe('parseAnioTributario', () => {
  it('lee el año tributario AAAA, con espacios', () => {
    expect(parseAnioTributario('2026')).toBe(2026);
    expect(parseAnioTributario(' 2025 ')).toBe(2025);
  });

  it('rechaza lo que no es un año AAAA con PERIODO_INVALIDO', () => {
    for (const v of ['', '26', '2026-04', 'AT2026', '1999', '2101', 'abcd']) {
      expect(codigoDe(() => parseAnioTributario(v)), v).toBe('PERIODO_INVALIDO');
    }
  });
});

describe('rangoAnios', () => {
  it('entrega los años del rango, ambos incluidos', () => {
    expect(rangoAnios(2023, 2026)).toEqual([2023, 2024, 2025, 2026]);
    expect(rangoAnios(2026, 2026)).toEqual([2026]);
  });

  it('rechaza un inicio posterior al fin y más de 10 años', () => {
    expect(codigoDe(() => rangoAnios(2026, 2025))).toBe('PERIODO_INVALIDO');
    expect(rangoAnios(2017, 2026)).toHaveLength(10);
    expect(codigoDe(() => rangoAnios(2016, 2026))).toBe('PERIODO_INVALIDO');
  });
});

describe('periodoRenta', () => {
  it('es AT<AAAA>: no calza con los meses AAAA-MM', () => {
    expect(periodoRenta(2026)).toBe('AT2026');
  });
});

describe('f22Vigente', () => {
  it('elige la marcada vigente', () => {
    const vigente = declaracionF22({ folio: 200, vigente: true, fechaIngreso: '2026-04-10' });
    expect(f22Vigente([declaracionF22({ folio: 300, vigente: false, fechaIngreso: '2026-04-20' }), vigente])).toBe(vigente);
  });

  it('sin marca, la de ingreso más reciente y luego el folio más alto; nunca una marcada no vigente', () => {
    const a = declaracionF22({ folio: 100, vigente: null, fechaIngreso: '2026-04-10' });
    const b = declaracionF22({ folio: 90, vigente: null, fechaIngreso: '2026-04-20' });
    const c = declaracionF22({ folio: 95, vigente: null, fechaIngreso: '2026-04-20' });
    expect(f22Vigente([a, b, c])).toBe(c);
    expect(f22Vigente([declaracionF22({ vigente: false })])).toBeNull();
    expect(f22Vigente([])).toBeNull();
  });
});

describe('cruzarHonorariosF22', () => {
  const codigos = (c547: number | null | undefined, c492: number | null | undefined): F22Valor[] => [
    ...(c547 === undefined ? [] : [{ codigo: '547', valor: c547, glosa: 'Total ingresos brutos ficticio' }]),
    ...(c492 === undefined ? [] : [{ codigo: '492', valor: c492, glosa: 'Retención de honorarios ficticia' }]),
  ];

  it('cuadra si el F22 reajusta las boletas entre 0 % y 10 %, con el % de reajuste', () => {
    const r = cruzarHonorariosF22({ bruto: 2_000_000, retencion: 290_000 }, codigos(2_012_600, 291_827));
    expect(r.bruto).toEqual({ codigo: '547', boletas: 2_000_000, f22: 2_012_600, estado: 'cuadra', reajustePct: 0.63 });
    expect(r.retencion).toEqual({ codigo: '492', boletas: 290_000, f22: 291_827, estado: 'cuadra', reajustePct: 0.63 });
  });

  it('los bordes 0 % y 10 % cuadran; bajo las boletas o sobre 10 % difiere', () => {
    const estado = (f22: number) => cruzarHonorariosF22({ bruto: 1_000_000, retencion: 0 }, codigos(f22, null)).bruto.estado;
    expect(estado(1_000_000)).toBe('cuadra');
    expect(estado(1_100_000)).toBe('cuadra');
    expect(estado(999_999)).toBe('difiere');
    expect(estado(1_100_001)).toBe('difiere');
    expect(cruzarHonorariosF22({ bruto: 1_000_000, retencion: 0 }, codigos(950_000, null)).bruto.reajustePct).toBe(-5);
  });

  it('con boletas y el código ausente, null o 0 es sin_declarar', () => {
    expect(cruzarHonorariosF22({ bruto: 500_000, retencion: 76_250 }, codigos(undefined, undefined))).toMatchObject({
      bruto: { estado: 'sin_declarar', f22: null, reajustePct: null },
      retencion: { estado: 'sin_declarar', f22: null, reajustePct: null },
    });
    expect(cruzarHonorariosF22({ bruto: 500_000, retencion: 76_250 }, codigos(null, 0))).toMatchObject({ bruto: { estado: 'sin_declarar' }, retencion: { estado: 'sin_declarar', f22: 0 } });
  });

  it('sin boletas: F22 con monto difiere; ambos en 0 o ausentes es sin_datos', () => {
    expect(cruzarHonorariosF22({ bruto: 0, retencion: 0 }, codigos(300_000, undefined))).toMatchObject({ bruto: { estado: 'difiere', reajustePct: null }, retencion: { estado: 'sin_datos' } });
    expect(cruzarHonorariosF22({ bruto: 0, retencion: 0 }, codigos(0, null))).toMatchObject({ bruto: { estado: 'sin_datos' }, retencion: { estado: 'sin_datos' } });
  });
});

describe('totalesBheEmitidas y hayBoletasEmitidas', () => {
  it('suma los 12 meses; un año todo en 0 no tiene boletas, pero una sola anulada sí cuenta', () => {
    const anio = informeBheEmitidas(2025, { 2: { bruto: 100_000, retencionTerceros: 14_500, vigentes: 1 }, 9: { bruto: 50_000, retencionPropia: 7_250, vigentes: 1, anuladas: 2 } });
    expect(totalesBheEmitidas(anio.meses)).toEqual({ vigentes: 2, anuladas: 2, bruto: 150_000, retencionTerceros: 14_500, retencionPropia: 7_250 });
    expect(hayBoletasEmitidas(totalesBheEmitidas(informeBheEmitidas(2025).meses))).toBe(false);
    expect(hayBoletasEmitidas(totalesBheEmitidas(informeBheEmitidas(2025, { 4: { anuladas: 1 } }).meses))).toBe(true);
  });
});

describe('diferenciaConAnual', () => {
  const marzo = mesBheEmitida(3, { bruto: 1_200_000, vigentes: 2, anuladas: 1 });
  const boletas = [boletaEmitida({ folio: 1, bruto: 500_000 }), boletaEmitida({ folio: 2, bruto: 700_000 }), boletaEmitida({ folio: 3, bruto: 200_000, anulada: true })];

  it('null si las cantidades y el bruto de las vigentes calzan con el mes del informe anual', () => {
    expect(diferenciaConAnual('2025-03', marzo, boletas)).toBeNull();
  });

  it('si no calzan, lo dice con ambas cifras', () => {
    expect(diferenciaConAnual('2025-03', marzo, boletas.slice(0, 2))).toBe(
      'Boletas emitidas 2025-03: el detalle trae 2 vigentes, 0 anuladas y bruto $1.200.000; el informe anual dice 2 vigentes, 1 anulada y bruto $1.200.000.',
    );
    expect(diferenciaConAnual('2025-03', marzo, [boletas[0]!, boletas[2]!])).toMatch(/1 vigente, 1 anulada y bruto \$500\.000/);
  });
});

describe('pagadoresBheEmitidas', () => {
  it('suma las vigentes por receptor, de mayor a menor bruto; deja fuera las anuladas y cuenta los demás', () => {
    const boletas = [
      boletaEmitida({ folio: 1, rutReceptor: '33333333-3', nombreReceptor: null, bruto: 300_000, retencionReceptor: 41_250 }),
      boletaEmitida({ folio: 2, rutReceptor: '33333333-3', nombreReceptor: 'Cliente Uno', bruto: 200_000, retencionReceptor: 27_500 }),
      boletaEmitida({ folio: 3, rutReceptor: '44444444-4', nombreReceptor: null, bruto: 600_000, retencionReceptor: 0 }),
      boletaEmitida({ folio: 4, rutReceptor: '55555555-5', nombreReceptor: 'Solo anulada', bruto: 900_000, anulada: true }),
      boletaEmitida({ folio: 5, rutReceptor: '66666666-6', nombreReceptor: 'Cliente Chico', bruto: 10_000, retencionReceptor: 1_375 }),
    ];

    expect(pagadoresBheEmitidas(boletas, 2)).toEqual({
      principales: [
        { rutReceptor: '44444444-4', nombreReceptor: null, boletas: 1, bruto: 600_000, retencion: 0 },
        { rutReceptor: '33333333-3', nombreReceptor: 'Cliente Uno', boletas: 2, bruto: 500_000, retencion: 68_750 },
      ],
      otros: 1,
    });
    expect(pagadoresBheEmitidas(boletas).otros).toBe(0);
    expect(pagadoresBheEmitidas([])).toEqual({ principales: [], otros: 0 });
  });
});

describe('rentas informadas por terceros: cruces', () => {
  const F22 = (valor: number | null) => [{ codigo: '492', valor, glosa: 'Retención ficticia' }];

  it('contra el F22 compara directo (ambos actualizados por IPC): cuadra solo si son iguales', () => {
    expect(compararConF22(175_000, F22(175_000))).toEqual({ otro: 175_000, estado: 'cuadra', diferencia: 0, reajustePct: null });
    expect(compararConF22(175_000, F22(170_000))).toEqual({ otro: 170_000, estado: 'difiere', diferencia: 5_000, reajustePct: null });
    // Sin el 492 en el folio: el F22 no la declara.
    expect(compararConF22(175_000, [])).toEqual({ otro: null, estado: 'difiere', diferencia: 175_000, reajustePct: null });
    expect(compararConF22(0, F22(null))).toMatchObject({ estado: 'cuadra', diferencia: 0 });
  });

  it('contra las boletas (nominales) acepta el reajuste de 0 % a 10 %, como el cruce con el F22', () => {
    expect(compararConBoletas(101_000, 100_000)).toEqual({ otro: 100_000, estado: 'cuadra', diferencia: 1_000, reajustePct: 1 });
    expect(compararConBoletas(110_000, 100_000)).toMatchObject({ estado: 'cuadra' });
    expect(compararConBoletas(110_001, 100_000)).toMatchObject({ estado: 'difiere', diferencia: 10_001 });
    expect(compararConBoletas(99_999, 100_000)).toMatchObject({ estado: 'difiere', diferencia: -1 });
    expect(compararConBoletas(50_000, 0)).toEqual({ otro: 0, estado: 'difiere', diferencia: 50_000, reajustePct: null });
    expect(compararConBoletas(0, 0)).toMatchObject({ estado: 'cuadra' });
  });

  it('suma la retención de la DJ 1879 y la cruza con las boletas emitidas del año y con el 492; null sin filas de la 1879', () => {
    const filas = [djTercero({ retencionHonorarios: 45_000 }), djTercero({ informanteRut: '44444444-4', retencionHonorarios: 130_000 }), djTercero({ dj: 1887, retencionHonorarios: 9 })];
    expect(cruzarRetencionTerceros(filas, 170_000, F22(175_000))).toEqual({
      dj: 1879,
      informada: 175_000,
      boletas: { otro: 170_000, estado: 'cuadra', diferencia: 5_000, reajustePct: 2.94 },
      f22: { otro: 175_000, estado: 'cuadra', diferencia: 0, reajustePct: null },
    });
    expect(cruzarRetencionTerceros(filas, null, null)).toMatchObject({ informada: 175_000, boletas: null, f22: null });
    expect(cruzarRetencionTerceros([djTercero({ dj: 1887 })], 1, F22(1))).toBeNull();
  });

  it('por informante compara meses y retención con las boletas vigentes emitidas a su RUT; null si no hay', () => {
    const boletas = [
      boletaEmitida({ periodo: '2025-07', folio: 1, rutReceptor: '33333333-3', retencionReceptor: 20_000 }),
      boletaEmitida({ periodo: '2025-08', folio: 2, rutReceptor: '33333333-3', retencionReceptor: 24_000 }),
      boletaEmitida({ periodo: '2025-10', folio: 3, rutReceptor: '33333333-3', retencionReceptor: 1, anulada: true }),
      boletaEmitida({ periodo: '2025-11', folio: 4, rutReceptor: '33333333-3', retencionReceptor: 0 }),
      boletaEmitida({ periodo: '2025-07', folio: 5, rutReceptor: '55555555-5', retencionReceptor: 9_999 }),
    ];
    expect(cruzarInformanteBoletas(djTercero({ meses: [7, 8, 9], retencionHonorarios: 45_000 }), boletas)).toEqual({
      boletas: 3,
      mesesBoletas: [7, 8, 11],
      soloDj: [9],
      soloBoletas: [11],
      retencionBoletas: 44_000,
      retencion: { otro: 44_000, estado: 'cuadra', diferencia: 1_000, reajustePct: 2.27 },
    });
    expect(cruzarInformanteBoletas(djTercero({ informanteRut: '44444444-4' }), boletas)).toBeNull();
    const sinRetencion = djTercero({ meses: [7, 8, 11] });
    delete (sinRetencion as { retencionHonorarios?: number }).retencionHonorarios;
    expect(cruzarInformanteBoletas(sinRetencion, boletas)).toMatchObject({ soloDj: [], soloBoletas: [], retencion: null });
  });
});
