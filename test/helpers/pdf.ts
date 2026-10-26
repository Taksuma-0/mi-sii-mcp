import { PDFDocument, StandardFonts } from 'pdf-lib';

export interface TextoPdf {
  readonly x: number;
  readonly y: number;
  readonly t: string;
  /** Tamaño de letra; 9 si se omite. */
  readonly tamano?: number;
}

export async function pdfSintetico(textos: readonly TextoPdf[], tamanoPagina: readonly [ancho: number, alto: number] = [612, 792]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([...tamanoPagina]);
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  for (const { x, y, t, tamano } of textos) pagina.drawText(t, { x, y, size: tamano ?? 9, font: fuente });
  return doc.save();
}

/** Imita un F29 compacto: código, glosa y valor por línea, a veces en dos columnas. */
export const F29_SINTETICO: readonly TextoPdf[] = [
  { x: 50, y: 760, t: 'FORMULARIO 29' },
  { x: 300, y: 760, t: 'Folio 123456789' },
  { x: 50, y: 700, t: '538' },
  { x: 90, y: 700, t: 'TOTAL DÉBITOS' },
  { x: 300, y: 700, t: '1.234.567' },
  { x: 50, y: 680, t: '537' },
  { x: 90, y: 680, t: 'TOTAL CRÉDITOS' },
  { x: 300, y: 680, t: '234.567' },
  { x: 350, y: 680, t: '504' },
  { x: 390, y: 680, t: 'Remanente mes anterior' },
  { x: 540, y: 680, t: '10.000' },
  { x: 50, y: 660, t: '151' },
  { x: 90, y: 660, t: 'Retención Art. 74 N°3 Ley 18.211' },
  { x: 300, y: 660, t: '10.000' },
  { x: 50, y: 640, t: '91' },
  { x: 90, y: 640, t: 'TOTAL A PAGAR' },
  { x: 300, y: 640, t: '1.000.000' },
  { x: 50, y: 620, t: '115' },
  { x: 90, y: 620, t: 'Tasa PPM' },
  { x: 300, y: 620, t: '0,125' },
];

/** Página del F29 compacto real: su columna derecha termina más allá de los 612 puntos de una carta. */
export const PAGINA_F29_COMPACTO = [652, 842] as const;

/** El F29 compacto real usa Helvetica de 6 puntos: con letra mayor, los textos se tocan y el lector de PDF los une. */
const TAMANO_F29 = 6;

const linea = (y: number, textos: readonly (readonly [x: number, t: string])[]): TextoPdf[] => textos.map(([x, t]) => ({ x, y, t, tamano: TAMANO_F29 }));

/** En Helvetica de 6 puntos los dígitos miden 3,336 y los separadores (`.`, `/`, `-`) la mitad. */
const anchoValor = (t: string): number => [...t].reduce((ancho, c) => ancho + (/\d/.test(c) ? 3.336 : 1.668), 0);

type CeldaF29 = readonly [codigo: string, glosa: string, valor?: string];

/** Posiciones medidas en un F29 compacto real: código y glosa alineados a la izquierda, valor a la derecha. */
const COLUMNAS_F29 = [
  { codigo: 38.6, codigoLargo: 36.9, glosa: 59.2, finValor: 322.6 },
  { codigo: 338.6, codigoLargo: 337.0, glosa: 359.1, finValor: 622.4 },
] as const;

/** Una fila de la tabla de dos columnas: cada celda trae su código, su glosa (un solo texto) y, si tiene, su valor. */
function filaF29(y: number, izquierda: CeldaF29 | null, derecha: CeldaF29 | null = null): TextoPdf[] {
  return [izquierda, derecha].flatMap((celda, i) => {
    if (!celda) return [];
    const columna = COLUMNAS_F29[i]!;
    const [codigo, glosa, valor] = celda;
    return linea(y, [
      [codigo.length === 4 ? columna.codigoLargo : columna.codigo, codigo],
      [columna.glosa, glosa],
      ...(valor === undefined ? [] : [[columna.finValor - anchoValor(valor), valor] as const]),
    ]);
  });
}

/**
 * Replica el PDF compacto real del F29 (posiciones, cabeceras y glosas del formulario) con contribuyente, folio y
 * montos FICTICIOS. Cubre los casos que el lector debe resolver: códigos con ceros a la izquierda (077, 048, 089, 062),
 * códigos fuera del catálogo que inician celda (562, 544, 779, 9906), la tasa con punto decimal (0.5) y las líneas
 * que no deben dar ningún código. Se dibuja en `PAGINA_F29_COMPACTO`; lectura esperada en `F29_COMPACTO_SINTETICO_CODIGOS`.
 */
export const F29_COMPACTO_SINTETICO: readonly TextoPdf[] = [
  ...linea(775.2, [[475.9, 'FOLIO'], [538.7, '[07]'], [566.6, '1234567890']]),
  ...linea(771.8, [[205.6, 'DECLARACIÓN MENSUAL Y PAGO']]),
  ...linea(761.8, [[475.9, 'RUT'], [538.7, '[03]'], [563.3, '22.222.222-2']]),
  ...linea(755.0, [[221.9, 'SIMULTÁNEO DE IMPUESTOS']]),
  ...linea(748.4, [[475.9, 'PERIODO'], [538.7, '[15]'], [588.8, '202609']]),
  ...linea(738.2, [[265.8, 'FORMULARIO 29']]),
  ...linea(696.7, [[39.3, '01'], [75.6, 'Apellido Paterno o Razón Social'], [217.6, '02'], [310.8, 'Apellido Materno'], [455.2, '05'], [532.6, 'Nombres']]),
  ...linea(685.7, [[80.0, 'EMPRESA FICTICIA SPA']]),
  ...linea(674.7, [[39.3, '06'], [123.9, 'Calle'], [215.4, '610'], [326.6, 'Número'], [455.2, '08'], [533.7, 'Comuna']]),
  ...linea(663.6, [[29.5, 'CALLE INVENTADA Nº:123, COMUNA DEMO,'], [509.3, 'COMUNA DEMO']]),
  ...linea(643.0, [[39.3, '09'], [117.4, 'Teléfono'], [217.6, '55'], [307.7, 'Correo Electrónico'], [452.9, '314'], [508.8, 'Rut del Representante']]),
  ...linea(614.7, [[34.1, 'Código'], [144.7, 'Glosa'], [277.9, 'Valor'], [334.1, 'Código'], [444.6, 'Glosa'], [577.8, 'Valor']]),
  ...filaF29(606.1, ['503', 'CANTIDAD FACTURAS EMITIDAS', '5'], ['502', 'DÉBITOS FACTURAS EMITIDAS', '300.000']),
  ...filaF29(597.5, ['511', 'CRÉD. IVA POR DCTOS. ELECTRÓNICOS', '400.000'], ['562', 'MONTO SIN DER. A CRED. FISCAL', '1.250.000']),
  ...filaF29(588.9, ['584', 'CANT.INT.EX.NO GRAV.SIN DER. CRED.FISCAL', '7'], ['538', 'TOTAL DÉBITOS', '300.000']),
  ...filaF29(580.2, ['519', 'CANT. DE DCTOS. FACT. RECIB. DEL GIRO', '9'], ['544', 'RECUP. IMP. ESP. DIESEL (Art. 2)', '0']),
  ...filaF29(571.6, ['077', 'REMANENTE DE CRÉDITO FISC.', '250.000'], ['520', 'CRÉDITO REC. Y REINT./FACT. DEL GIRO', '400.000']),
  ...filaF29(563.0, ['048', 'RET. IMP. ÚNICO TRAB. ART. 74 N 1 LIR', '4.000'], ['504', 'REMANENTE CRÉDITO MES ANTERIOR', '150.000']),
  ...filaF29(554.4, ['151', 'RETENCION TASA LEY 21.133 SOBRE RENTAS', '13.750'], ['089', 'IMP. DETERM. IVA', '0']),
  ...filaF29(545.8, ['563', 'BASE IMPONIBLE', '2.500.000'], ['779', 'Monto de IVA postergado 6 o 12 cuotas', '0']),
  ...filaF29(537.2, ['115', 'TASA PPM 1ra. CATEGORÍA', '0.5'], ['537', 'TOTAL CRÉDITOS', '550.000']),
  ...filaF29(528.5, ['9906', 'FECHA DE PRESENTACIÓN DE DECL. ANTERIOR', '15/01/2027'], ['595', 'SUB TOTAL IMP. DETERMINADO ANVERSO', '30.250']),
  ...filaF29(519.9, null, ['062', 'PPM NETO DETERMINADO', '12.500']),
  ...filaF29(511.3, null, ['547', 'TOTAL DETERMINADO', '30.250']),
  ...linea(486.7, [
    [35.8, '931'], [71.0, 'Monto Interés'], [132.8, '932'], [169.8, 'Monto Multa'], [231.5, '60'], [265.7, 'Condonación'],
    [338.6, '922'], [390.8, 'Número Resolución'], [485.6, '915'], [537.3, 'Fecha Condonación'],
  ]),
  ...linea(478.0, [[70.1, '1.500'], [163.7, '20.000'], [268.2, '50'], [389.8, '100-2020'], [534.4, '31/12/2027']]),
  ...linea(464.7, [[34.1, '9311'], [63.3, 'Monto Interés Base'], [337.0, '9312'], [388.3, 'Monto Interés Spread']]),
  ...linea(456.1, [[75.9, '0'], [400.8, '0']]),
  ...linea(432.9, [[29.5, 'TOTAL A PAGAR DENTRO DEL PLAZO LEGAL'], [299.3, '91'], [421.4, '30.250'], [455.2, '+']]),
  ...linea(421.9, [[29.5, 'Más IPC'], [299.3, '92'], [455.2, '+']]),
  ...linea(410.9, [[29.5, 'Más Interes y Multas'], [299.3, '93'], [455.2, '+']]),
  ...linea(399.9, [[29.5, 'CONDONACIÓN'], [297.0, '795'], [456.2, '-']]),
  ...linea(388.9, [[29.8, 'TOTAL A PAGAR CON RECARGO'], [299.3, '94'], [455.2, '=']]),
  ...linea(325.3, [[52.7, 'Tipo de Declaración'], [176.3, 'Corrige a Folio(s)'], [314.6, 'Banco'], [417.9, 'Medio de Pago'], [522.8, 'Fecha de Presentación']]),
  ...linea(314.3, [[73.0, 'Primitiva'], [437.2, 'PEL'], [543.9, '20/01/2027']]),
  ...linea(202.7, [[281.3, 'Ver Formulario Completo']]),
];

/** Lo que debe leer impuestocl de `F29_COMPACTO_SINTETICO`: solo códigos del catálogo, cada uno con el valor de su celda. */
export const F29_COMPACTO_SINTETICO_CODIGOS: Readonly<Record<string, number>> = {
  '503': 5,
  '502': 300_000,
  '511': 400_000,
  '584': 7,
  '538': 300_000,
  '519': 9,
  '77': 250_000,
  '520': 400_000,
  '48': 4_000,
  '504': 150_000,
  '151': 13_750,
  '89': 0,
  '563': 2_500_000,
  '115': 0.5,
  '537': 550_000,
  '595': 30_250,
  '62': 12_500,
  '547': 30_250,
  '91': 30_250,
};
