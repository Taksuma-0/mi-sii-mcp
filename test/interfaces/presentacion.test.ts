import { describe, expect, it } from 'vitest';
import { bloques, conclusion, estado, siguientesPasos, tabla } from '../../src/interfaces/presentacion.js';

describe('piezas de la plantilla de respuestas', () => {
  it.each([
    ['critico', '⛔'],
    ['advertencia', '⚠️'],
    ['info', 'ℹ️'],
    ['ok', '✅'],
  ] as const)('el estado %s se muestra con %s', (severidad, icono) => {
    expect(estado(severidad)).toBe(icono);
  });

  it('la conclusión empieza con su ícono', () => {
    expect(conclusion('✅', 'El IVA de 2026-09 cuadra con el F29.')).toBe('✅ El IVA de 2026-09 cuadra con el F29.');
  });

  it('arma una tabla Markdown', () => {
    expect(tabla(['Concepto', 'RCV', 'F29'], [['Débito', '$100', '$100']])).toBe('| Concepto | RCV | F29 |\n| --- | --- | --- |\n| Débito | $100 | $100 |');
  });

  it('escapa la barra vertical dentro de una celda para no romper la tabla', () => {
    expect(tabla(['Contraparte'], [['A|B Ltda.']])).toBe('| Contraparte |\n| --- |\n| A\\|B Ltda. |');
  });

  it('sin filas no hay tabla', () => {
    expect(tabla(['Concepto', 'Monto'], [])).toBe('');
  });

  it('separa los bloques con una línea en blanco, para que la tabla no se trague la línea siguiente, y omite los vacíos', () => {
    const t = tabla(['A'], [['1']]);
    expect(bloques(['✅ Listo.'], [t], ['Dato 1', '', 'Dato 2'], [siguientesPasos([])])).toBe(`✅ Listo.\n\n${t}\n\nDato 1\nDato 2`);
  });

  it('los siguientes pasos van en una línea y desaparecen si no hay', () => {
    expect(siguientesPasos(['f29_estimar para el monto', 'plazos_proximos'])).toBe('Siguientes pasos: f29_estimar para el monto · plazos_proximos');
    expect(siguientesPasos([])).toBe('');
  });
});
