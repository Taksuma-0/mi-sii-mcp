import { describe, expect, it } from 'vitest';
import { conciliarPeriodo } from '../../src/reconciliation/conciliar.js';
import { CODIGO_F29, VERSION_REGLAS } from '../../src/reconciliation/mapeo-f29.js';
import { reglaRetencionHonorarios } from '../../src/reconciliation/reglas.js';
import { entrada } from '../helpers/entrada.js';
import { valores } from '../helpers/fabricas.js';

const MENOR =
  'La retención de honorarios declarada en el F29 (código 151) es menor que la de las boletas recibidas del mes. Si alguna boleta se pagó en otro mes, su retención va en ese mes.';
const MAYOR =
  'El F29 declara más retención que las boletas recibidas del mes (puede incluir boletas de terceros o boletas de meses anteriores pagadas este mes).';

/** El F29 del mes cuadrado con un 151 dado (sin 151, el PDF compacto lo omite: vale 0). */
const conRetencion = (r151: number | null) =>
  valores({ '538': 190_000, '537': 24_000, '504': 5_000, '89': 166_000, '77': 0, '91': 166_000, ...(r151 === null ? {} : { [CODIGO_F29.RETENCION_HONORARIOS]: r151 }) });

describe('RET-01 retención de honorarios vs código 151 del F29', () => {
  it('el código 151 es la retención de honorarios y las reglas subieron de versión', () => {
    expect(CODIGO_F29.RETENCION_HONORARIOS).toBe('151');
    expect(VERSION_REGLAS).toBe('iva-2026.10.7');
  });

  it('151 menor que la retención de las boletas: advertencia con los montos', () => {
    const [h, ...resto] = reglaRetencionHonorarios(entrada({ valores: conRetencion(100_000), bhe: { consultado: true, retencion: 152_500 } }));

    expect(resto).toEqual([]);
    expect(h).toMatchObject({
      regla: 'RET-01',
      severidad: 'advertencia',
      naturaleza: 'DERIVADO',
      montos: { esperado: 152_500, declarado: 100_000, diferencia: 52_500 },
      evidencia: ['F29:555001', 'BHE:2026-09'],
    });
    expect(h!.detalle).toContain(MENOR);
  });

  it('sin 151 en un F29 leído vale 0: menor que la retención de las boletas', () => {
    const [h] = reglaRetencionHonorarios(entrada({ valores: conRetencion(null), bhe: { consultado: true, retencion: 30_000 } }));

    expect(h).toMatchObject({ severidad: 'advertencia', montos: { esperado: 30_000, declarado: 0, diferencia: 30_000 } });
  });

  it('151 mayor que la retención de las boletas: info, nunca crítico', () => {
    const [h] = reglaRetencionHonorarios(entrada({ valores: conRetencion(200_000), bhe: { consultado: true, retencion: 152_500 } }));

    expect(h).toMatchObject({ regla: 'RET-01', severidad: 'info', montos: { esperado: 152_500, declarado: 200_000, diferencia: -47_500 } });
    expect(h!.detalle).toContain(MAYOR);
  });

  it('igual, o dentro de la tolerancia: sin hallazgo', () => {
    expect(reglaRetencionHonorarios(entrada({ valores: conRetencion(152_500), bhe: { consultado: true, retencion: 152_500 } }))).toEqual([]);
    expect(reglaRetencionHonorarios(entrada({ valores: conRetencion(152_000), bhe: { consultado: true, retencion: 152_500 }, toleranciaPesos: 500 }))).toEqual([]);
    expect(reglaRetencionHonorarios(entrada({ valores: conRetencion(null), bhe: { consultado: true, retencion: 0 } }))).toEqual([]);
  });

  it('no aplica si las boletas no se consultaron', () => {
    expect(reglaRetencionHonorarios(entrada({ valores: conRetencion(100_000) }))).toEqual([]);
    expect(reglaRetencionHonorarios(entrada({ valores: conRetencion(100_000), bhe: { consultado: false, retencion: 0 } }))).toEqual([]);
  });

  it('no aplica si el F29 no se leyó (sin valores o sin códigos)', () => {
    expect(reglaRetencionHonorarios(entrada({ valores: null, bhe: { consultado: true, retencion: 152_500 } }))).toEqual([]);
    expect(reglaRetencionHonorarios(entrada({ valores: valores({}), bhe: { consultado: true, retencion: 152_500 } }))).toEqual([]);
  });

  it('conciliarPeriodo la incluye', () => {
    const r = conciliarPeriodo(entrada({ valores: conRetencion(100_000), bhe: { consultado: true, retencion: 152_500 } }));

    expect(r.hallazgos.map((h) => [h.regla, h.severidad])).toEqual([['RET-01', 'advertencia']]);
    expect(r.versionReglas).toBe('iva-2026.10.7');
  });
});
