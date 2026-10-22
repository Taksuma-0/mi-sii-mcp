import { PDFDocument, StandardFonts } from 'pdf-lib';

export interface TextoPdf {
  readonly x: number;
  readonly y: number;
  readonly t: string;
}

export async function pdfSintetico(textos: readonly TextoPdf[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  for (const { x, y, t } of textos) pagina.drawText(t, { x, y, size: 9, font: fuente });
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
