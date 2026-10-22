import { describe, expect, it } from 'vitest';
import { codigosDesdeLineas, extraerCodigosF29, lineasDeItems, type TokenPdf } from '../../src/connectors/sii/f29-pdf.js';
import { F29_SINTETICO, pdfSintetico } from '../helpers/pdf.js';

const t = (s: string, x = 0): TokenPdf => ({ s, x });

describe('lector del PDF compacto del F29', () => {
  it('agrupa items por línea (tolerando décimas en y) y separa tokens por espacios', () => {
    const lineas = lineasDeItems([
      { str: '538', x: 50, y: 700 },
      { str: 'TOTAL DÉBITOS', x: 90, y: 700.5 },
      { str: '1.234.567', x: 400, y: 699.8 },
      { str: '537', x: 50, y: 680 },
      { str: '  ', x: 60, y: 680 },
    ]);
    expect(lineas.map((l) => l.map((x) => x.s))).toEqual([['538', 'TOTAL', 'DÉBITOS', '1.234.567'], ['537']]);
  });

  it('empareja cada código con el último monto antes del siguiente código', () => {
    const lineas = [
      [t('538'), t('TOTAL'), t('DÉBITOS'), t('1.234.567'), t('537'), t('234.567')],
      [t('151'), t('Ret.'), t('Art.'), t('74'), t('Ley'), t('18.211'), t('10.000')],
      [t('Folio'), t('123456789')],
      [t('115'), t('Tasa'), t('0,125')],
    ];
    expect(codigosDesdeLineas(lineas)).toEqual({ '538': 1_234_567, '537': 234_567, '151': 10_000, '115': 0.125 });
  });

  it('conserva la primera aparición de cada código', () => {
    expect(codigosDesdeLineas([[t('538'), t('100')], [t('538'), t('999')]])).toEqual({ '538': 100 });
  });

  it('distingue montos que también son códigos en varias columnas', () => {
    expect(codigosDesdeLineas([
      [t('538', 50), t('Débitos', 90), t('100', 300), t('537', 350), t('Créditos', 390), t('50', 540)],
      [t('100', 50), t('Otro', 90), t('49', 300)],
      [t('538', 50), t('Débitos', 90), t('999', 300)],
    ])).toEqual({ '538': 100, '537': 50, '100': 49 });
  });

  it('lee pares numéricos sin glosa y respeta los códigos configurados', () => {
    expect(codigosDesdeLineas([[t('538'), t('100'), t('537'), t('50')]])).toEqual({ '538': 100, '537': 50 });
    expect(codigosDesdeLineas([[t('2'), t('3'), t('4'), t('0')]], new Set(['2', '4']))).toEqual({ '2': 3, '4': 0 });
  });

  it('no interpreta como códigos los números de una glosa', () => {
    const lineas = lineasDeItems([
      { str: '151', x: 50, y: 700 },
      { str: 'Retención Art. 50 Ley 54', x: 90, y: 700 },
      { str: '10.000', x: 300, y: 700 },
      { str: '537', x: 350, y: 700 },
      { str: 'Créditos', x: 390, y: 700 },
      { str: '100', x: 540, y: 700 },
    ]);
    expect(codigosDesdeLineas(lineas)).toEqual({ '151': 10_000, '537': 100 });
  });

  const glosaFragmentada = [
    { str: '151', x: 50, y: 700 },
    { str: 'Retencion Art. 50 Ley', x: 90, y: 700 },
    { str: '54', x: 185, y: 700 },
    { str: '10.000', x: 300, y: 700 },
    { str: '537', x: 350, y: 700 },
    { str: 'Creditos', x: 390, y: 700 },
    { str: '100', x: 540, y: 700 },
  ];

  it('mantiene el numeral de una glosa fragmentada dentro de su celda', () => {
    expect(codigosDesdeLineas(lineasDeItems(glosaFragmentada))).toEqual({ '151': 10_000, '537': 100 });
  });

  it('no extrae como código el numeral de una glosa fragmentada en PDF', async () => {
    const pdf = await pdfSintetico(glosaFragmentada.map(({ str, x, y }) => ({ t: str, x, y })));
    expect(await extraerCodigosF29(pdf)).toEqual({ '151': 10_000, '537': 100 });
  });

  it.each(['100', '49', '538'])('reserva el monto %s tras una glosa numérica antes de la segunda columna', (monto) => {
    const textos = ['151', 'Retención', 'Art.', '74', 'Ley', '18.211', monto, '537', 'Créditos', '50'];
    expect(codigosDesdeLineas([textos.map((s) => t(s))])).toEqual({ '151': Number(monto), '537': 50 });
    expect(codigosDesdeLineas(lineasDeItems([
      { str: '151', x: 50, y: 700 },
      { str: 'Retención Art. 74 Ley 18.211', x: 90, y: 700 },
      { str: monto, x: 300, y: 700 },
      { str: '537', x: 350, y: 700 },
      { str: 'Créditos', x: 390, y: 700 },
      { str: '50', x: 540, y: 700 },
    ]))).toEqual({ '151': Number(monto), '537': 50 });
  });

  it('conserva la primera aparición también en una misma línea', () => {
    expect(codigosDesdeLineas([[t('538'), t('100'), t('538'), t('999')]])).toEqual({ '538': 100 });
  });

  const casosCodigoTrasGlosa = [
    { glosa: 'TOTAL A PAGAR DENTRO DEL PLAZO LEGAL', monto: '12.345', valor: 12_345, escala: 1, desplazamiento: 0 },
    { glosa: 'Retención Art. 50 Ley 54', monto: '100', valor: 100, escala: 0.9, desplazamiento: 70 },
  ];

  it.each(casosCodigoTrasGlosa)('lee código después de una glosa en un ítem separado: $monto', ({ glosa, monto, valor, escala, desplazamiento }) => {
    const items = [
      { str: glosa, x: 29.48, y: 100 },
      { str: '91', x: 299.26, y: 100 },
      { str: monto, x: 425.81, y: 100 },
      { str: 'CLP', x: 455.19, y: 100 },
    ].map((item) => ({ ...item, x: item.x * escala + desplazamiento }));
    expect(codigosDesdeLineas(lineasDeItems(items))).toEqual({ '91': valor });
  });

  it.each(casosCodigoTrasGlosa)('extrae código después de una glosa en PDF: $monto', async ({ glosa, monto, valor, escala, desplazamiento }) => {
    const textos = [
      { t: glosa, x: 29.48, y: 100 },
      { t: '91', x: 299.26, y: 100 },
      { t: monto, x: 425.81, y: 100 },
      { t: 'CLP', x: 455.19, y: 100 },
    ].map((texto) => ({ ...texto, x: texto.x * escala + desplazamiento }));
    expect(await extraerCodigosF29(await pdfSintetico(textos))).toEqual({ '91': valor });
  });

  it.each([true, false])('extrae un monto conocido después de una glosa numérica en PDF (segunda glosa: %s)', async (conGlosa) => {
    const textos = [
      { x: 50, y: 700, t: '151' },
      { x: 90, y: 700, t: 'Retención Art. 74 Ley 18.211' },
      { x: 300, y: 700, t: '100' },
      { x: 350, y: 700, t: '537' },
      { x: 540, y: 700, t: '50' },
    ];
    if (conGlosa) textos.push({ x: 390, y: 700, t: 'Créditos' });
    expect(await extraerCodigosF29(await pdfSintetico(textos))).toEqual({ '151': 100, '537': 50 });
  });

  it('extrae montos coincidentes con códigos de un PDF con varias columnas', async () => {
    const pdf = await pdfSintetico([
      { x: 50, y: 700, t: '538' },
      { x: 90, y: 700, t: 'TOTAL DÉBITOS' },
      { x: 300, y: 700, t: '100' },
      { x: 350, y: 700, t: '537' },
      { x: 390, y: 700, t: 'TOTAL CRÉDITOS' },
      { x: 540, y: 700, t: '50' },
      { x: 50, y: 680, t: '538' },
      { x: 90, y: 680, t: 'Repetido' },
      { x: 300, y: 680, t: '999' },
    ]);
    expect(await extraerCodigosF29(pdf)).toEqual({ '538': 100, '537': 50 });
  });

  it('extrae los códigos de un PDF', async () => {
    const pdf = await pdfSintetico(F29_SINTETICO);
    expect(await extraerCodigosF29(pdf)).toEqual({ '538': 1_234_567, '537': 234_567, '504': 10_000, '151': 10_000, '91': 1_000_000, '115': 0.125 });
  });
});
