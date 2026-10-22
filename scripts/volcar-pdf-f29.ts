// Muestra cómo lee impuestocl un PDF compacto real del F29, para calibrar el lector.
// Uso: npx tsx scripts/volcar-pdf-f29.ts .spike/<rut>/f29-AAAA-MM-compacto.pdf
import { readFileSync } from 'node:fs';
import { extractTextItems } from 'unpdf';
import { codigosDesdeLineas, lineasDeItems } from '../src/connectors/sii/f29-pdf.js';

const ruta = process.argv[2];
if (!ruta) {
  console.error('Uso: npx tsx scripts/volcar-pdf-f29.ts <archivo.pdf>');
  process.exit(1);
}
const { items } = await extractTextItems(new Uint8Array(readFileSync(ruta)));
items.forEach((pagina, i) => {
  console.log(`--- página ${i + 1}`);
  const lineas = lineasDeItems(pagina);
  for (const linea of lineas) console.log(linea.map((t) => t.s).join(' | '));
  console.log('códigos:', codigosDesdeLineas(lineas));
});
