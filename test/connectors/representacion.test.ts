import { describe, expect, it } from 'vitest';
import { AVISO_REPRESENTACION, LectorPorRepresentacion } from '../../src/connectors/sii/representacion.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { declaracion } from '../helpers/fabricas.js';
import { SiiFalso } from '../helpers/sii-falso.js';

const EMPRESA = '22222222-2';
const PERSONA = '33333333-3';
const SEPT = parsePeriodo('2026-09');

describe('LectorPorRepresentacion', () => {
  it('lee el RCV de la empresa con la sesión de su representante y lo marca como no confirmado en vivo', async () => {
    const base = new SiiFalso();
    const lector = new LectorPorRepresentacion(base, PERSONA);
    expect(lector.aviso).toBe(`${AVISO_REPRESENTACION} (sesión de ${PERSONA})`);
    expect(AVISO_REPRESENTACION).toBe('lectura por representación sin confirmar en vivo');
    await lector.rcvResumen(EMPRESA, SEPT, 'COMPRA', 'REGISTRO');
    await lector.rcvDetalle(EMPRESA, SEPT, 'COMPRA', 33, 'REGISTRO');
    expect(base.llamadas).toEqual(['resumen|2026-09|COMPRA|REGISTRO', 'detalle|2026-09|COMPRA|REGISTRO|33']);
  });

  it.each([
    ['f29Declaraciones', (l: LectorPorRepresentacion) => l.f29Declaraciones(EMPRESA, SEPT)],
    ['f29Valores', (l: LectorPorRepresentacion) => l.f29Valores(EMPRESA, declaracion())],
    ['f29Propuesta', (l: LectorPorRepresentacion) => l.f29Propuesta(EMPRESA, SEPT)],
    ['bheRecibidas', (l: LectorPorRepresentacion) => l.bheRecibidas(EMPRESA, SEPT)],
    ['perfilTributario', (l: LectorPorRepresentacion) => l.perfilTributario(EMPRESA)],
    ['empresasAutorizadas', (l: LectorPorRepresentacion) => l.empresasAutorizadas()],
    ['f22Declaraciones', (l: LectorPorRepresentacion) => l.f22Declaraciones(EMPRESA, 2026)],
    ['f22Detalle', (l: LectorPorRepresentacion) => l.f22Detalle(EMPRESA, 2026, 1)],
  ] as const)('%s exige la sesión propia del contribuyente: SIN_PERMISO sin llamar al SII', async (_nombre, llamar) => {
    const base = new SiiFalso();
    const error = await llamar(new LectorPorRepresentacion(base, PERSONA)).catch((e: unknown) => e);
    expect(error).toMatchObject({
      codigo: 'SIN_PERMISO',
      accion: 'Inicia sesión con la identidad del contribuyente (login o login-navegador).',
      message: expect.stringContaining(PERSONA),
    });
    expect(base.llamadas).toEqual([]);
  });
});
