#!/usr/bin/env node
// Imprime los feriados nacionales de un año en el formato de src/calendar/feriados.ts.
// Uso: node scripts/actualizar-feriados.mjs 2028
const anio = process.argv[2];
if (!/^\d{4}$/.test(anio ?? '')) {
  console.error('Uso: node scripts/actualizar-feriados.mjs <AAAA>');
  process.exit(1);
}
const res = await fetch(`https://api.boostr.cl/holidays/${anio}.json`);
const json = await res.json();
const fechas = json.data.map((f) => `'${f.date}'`);
console.log(`  // ${anio}`);
for (let i = 0; i < fechas.length; i += 7) console.log(`  ${fechas.slice(i, i + 7).join(', ')},`);
