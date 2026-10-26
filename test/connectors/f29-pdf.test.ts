import { describe, expect, it } from 'vitest';
import { codigosDesdeLineas, extraerCodigosF29, lineasDeItems, type TokenPdf } from '../../src/connectors/sii/f29-pdf.js';
import { F29_COMPACTO_SINTETICO, F29_COMPACTO_SINTETICO_CODIGOS, F29_SINTETICO, PAGINA_F29_COMPACTO, pdfSintetico } from '../helpers/pdf.js';

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

describe('lector del PDF compacto del F29 con el formato real', () => {
  /** Cabecera de la tabla de dos columnas del PDF compacto, con sus posiciones reales. */
  const CABECERA_TABLA = [
    { str: 'Código', x: 34.1, y: 614.7 },
    { str: 'Glosa', x: 144.7, y: 614.7 },
    { str: 'Valor', x: 277.9, y: 614.7 },
    { str: 'Código', x: 334.1, y: 614.7 },
    { str: 'Glosa', x: 444.6, y: 614.7 },
    { str: 'Valor', x: 577.8, y: 614.7 },
  ];

  it('quita los ceros a la izquierda de los códigos al compararlos y en la salida', () => {
    expect(codigosDesdeLineas([[t('077'), t('REMANENTE'), t('250.000'), t('048'), t('RET.'), t('4.000')]])).toEqual({ '77': 250_000, '48': 4_000 });
  });

  it('marca como inicio de celda un código de 1 a 4 dígitos seguido de su glosa, esté o no en el catálogo', () => {
    const [linea] = lineasDeItems([
      { str: '511', x: 38.6, y: 600 },
      { str: 'CRÉD. IVA POR DCTOS. ELECTRÓNICOS', x: 59.2, y: 600 },
      { str: '400.000', x: 300.9, y: 600 },
      { str: '562', x: 338.6, y: 600 },
      { str: 'MONTO SIN DER. A CRED. FISCAL', x: 359.1, y: 600 },
      { str: '1.250.000', x: 595.8, y: 600 },
    ]);
    expect(linea!.filter((token) => token.inicioCelda).map((token) => token.s)).toEqual(['511', '562']);
    expect(codigosDesdeLineas([linea!])).toEqual({ '511': 400_000 });
  });

  it('no marca inicios de celda en el pie (glosa-código-monto), aunque tras el monto venga una unidad', () => {
    const lineas = lineasDeItems([
      { str: 'TOTAL A PAGAR DENTRO DEL PLAZO LEGAL', x: 29.5, y: 400 },
      { str: '91', x: 299.3, y: 400 },
      { str: '22.750', x: 421.4, y: 400 },
      { str: '+', x: 455.2, y: 400 },
      { str: 'Más IPC', x: 29.5, y: 380 },
      { str: '92', x: 299.3, y: 380 },
      { str: '+', x: 455.2, y: 380 },
      { str: 'Más Interes y Multas', x: 29.5, y: 360 },
      { str: '93', x: 299.3, y: 360 },
      { str: '100', x: 421.4, y: 360 },
      { str: 'CLP', x: 455.2, y: 360 },
    ]);
    expect(lineas.flat().filter((token) => token.inicioCelda)).toEqual([]);
    expect(codigosDesdeLineas(lineas)).toEqual({ '91': 22_750, '93': 100 });
  });

  it('un inicio de celda es límite aunque lo preceda una fecha y nunca se toma como valor', () => {
    expect(codigosDesdeLineas(lineasDeItems([
      { str: '9906', x: 36.9, y: 600 },
      { str: 'FECHA DE PRESENTACIÓN DE DECL. ANTERIOR', x: 59.2, y: 600 },
      { str: '15/01/2027', x: 292.6, y: 600 },
      { str: '595', x: 338.6, y: 600 },
      { str: 'SUB TOTAL IMP. DETERMINADO ANVERSO', x: 359.1, y: 600 },
      { str: '22.750', x: 604.1, y: 600 },
      { str: '931', x: 35.8, y: 580 },
      { str: 'Monto Interés', x: 71.0, y: 580 },
      { str: '932', x: 132.8, y: 580 },
      { str: 'Monto Multa', x: 169.8, y: 580 },
      { str: '60', x: 231.5, y: 580 },
      { str: 'Condonación', x: 265.7, y: 580 },
      { str: '922', x: 338.6, y: 580 },
      { str: 'Número Resolución', x: 390.8, y: 580 },
      { str: '915', x: 485.6, y: 580 },
      { str: 'Fecha Condonación', x: 537.3, y: 580 },
    ]))).toEqual({ '595': 22_750 });
  });

  it.each([
    {
      caso: '151 … Art. | 50 | Ley 54',
      fila: [
        { str: '151', x: 38.6, y: 600 },
        { str: 'Retencion Art.', x: 59.2, y: 600 },
        { str: '50', x: 100.0, y: 600 },
        { str: 'Ley 54', x: 108.0, y: 600 },
        { str: '10.000', x: 304.2, y: 600 },
      ],
      inicios: ['151'],
      esperado: { '151': 10_000 },
    },
    {
      caso: '048 … ART. | 74 | N 1 LIR',
      fila: [
        { str: '048', x: 38.6, y: 600 },
        { str: 'RET. IMP. ÚNICO TRAB. ART.', x: 59.2, y: 600 },
        { str: '74', x: 140.0, y: 600 },
        { str: 'N 1 LIR', x: 148.0, y: 600 },
        { str: '4.000', x: 307.6, y: 600 },
        { str: '504', x: 338.6, y: 600 },
        { str: 'REMANENTE CRÉDITO MES ANTERIOR', x: 359.1, y: 600 },
        { str: '150.000', x: 600.7, y: 600 },
      ],
      inicios: ['048', '504'],
      esperado: { '48': 4_000, '504': 150_000 },
    },
  ])('un número suelto de una glosa partida ($caso) no inicia celda ni es valor', ({ fila, inicios, esperado }) => {
    const lineas = lineasDeItems([...CABECERA_TABLA, ...fila]);
    expect(lineas.flat().filter((token) => token.inicioCelda).map((token) => token.s)).toEqual(inicios);
    expect(codigosDesdeLineas(lineas)).toEqual(esperado);
  });

  it.each([
    ['0.3', 0.3],
    ['0.25', 0.25],
    ['1.5', 1.5],
    ['0,125', 0.125],
    ['1.234', 1_234],
    ['21.133', 21_133],
    ['1.250.000', 1_250_000],
  ])('lee %s como %s', (texto, valor) => {
    expect(codigosDesdeLineas([[t('115'), t('TASA'), t(texto)]])).toEqual({ '115': valor });
  });

  it('una tasa con punto decimal cierra su celda antes del código siguiente', () => {
    const textos = ['115', 'TASA', 'PPM', '1ra.', 'CATEGORÍA', '0.5', '537', 'TOTAL', 'CRÉDITOS', '550.000'];
    expect(codigosDesdeLineas([textos.map((s) => t(s))])).toEqual({ '115': 0.5, '537': 550_000 });
  });

  it('lee un PDF con el formato real: cada código con el valor de su celda y nada de las líneas sin valores', async () => {
    expect(await extraerCodigosF29(await pdfSintetico(F29_COMPACTO_SINTETICO, PAGINA_F29_COMPACTO))).toEqual(F29_COMPACTO_SINTETICO_CODIGOS);
  });
});
