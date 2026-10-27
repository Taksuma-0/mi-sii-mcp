import { describe, expect, it } from 'vitest';
import { FUENTES_OFICIALES, fuentesOficiales, REGLA_ESTIMACION_RENTA } from '../../src/app/fuentes.js';
import { textoFuentes } from '../../src/interfaces/formato.js';

describe('fuentes oficiales de datos públicos', () => {
  it('solo apunta a páginas oficiales por https y no guarda cifras de parámetros', () => {
    for (const f of FUENTES_OFICIALES) {
      expect(f.urls.length).toBeGreaterThan(0);
      for (const url of f.urls) expect(url).toMatch(/^https:\/\/(www\.)?(sii\.cl|spensiones\.cl|previsionsocial\.gob\.cl|chileatiende\.gob\.cl)\//);
    }
    // Ni montos en pesos ni tasas: esos valores se consultan en la fuente del año.
    const textos = [...FUENTES_OFICIALES.map((f) => `${f.parametro} ${f.buscar}`), ...REGLA_ESTIMACION_RENTA].join(' ');
    expect(textos).not.toMatch(/\$\s?\d|\d+(,\d+)?\s?%/);
  });

  it('filtra por todas las palabras, sin importar tildes ni mayúsculas', () => {
    expect(fuentesOficiales()).toHaveLength(FUENTES_OFICIALES.length);
    expect(fuentesOficiales('utm').map((f) => f.parametro)).toContain('UTM y UTA por mes');
    expect(fuentesOficiales('COTIZA honorarios').length).toBeGreaterThanOrEqual(2);
    expect(fuentesOficiales('afp comisiones').map((f) => f.parametro)).toEqual(['Comisiones de las AFP']);
    expect(fuentesOficiales('nada que calce')).toEqual([]);
  });

  it('el texto lista fuente y qué buscar, y agrega la regla solo si se pide', () => {
    const [utm] = fuentesOficiales('utm');
    const sin = textoFuentes([utm!], false);
    expect(sin).toContain('impuestocl no los guarda');
    expect(sin).toContain('https://www.sii.cl/valores_y_fechas/utm/utm2026.htm');
    expect(sin).toContain('Qué buscar:');
    expect(sin).not.toContain('Regla para estimar');
    const con = textoFuentes([], true);
    expect(con).toContain('Ninguna fuente calza');
    expect(con).toContain(`${REGLA_ESTIMACION_RENTA.length}. `);
    expect(con).toMatch(/saldo insoluto/);
  });
});
