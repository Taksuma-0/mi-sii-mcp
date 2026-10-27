import { describe, expect, it } from 'vitest';
import { AVISO_REPRESENTACION, LectorPorRepresentacion } from '../../src/connectors/sii/representacion.js';
import { ErrorImpuestocl } from '../../src/domain/errores.js';
import { parsePeriodo } from '../../src/domain/periodo.js';
import { codigoDe } from '../helpers/errores.js';
import { declaracion } from '../helpers/fabricas.js';
import { SiiFalso } from '../helpers/sii-falso.js';

const EMPRESA = '22222222-2';
const PERSONA = '33333333-3';
const SEPT = parsePeriodo('2026-09');

describe('LectorPorRepresentacion', () => {
  it('lee el RCV de la empresa con la sesión de su representante y lo marca como no confirmado en vivo', async () => {
    const base = new SiiFalso();
    let aperturas = 0;
    const lector = new LectorPorRepresentacion(async () => {
      aperturas++;
      return base;
    }, PERSONA);
    expect(aperturas).toBe(0);
    expect(lector.aviso).toBe(`${AVISO_REPRESENTACION} (sesión de ${PERSONA})`);
    expect(AVISO_REPRESENTACION).toBe('lectura por representación sin confirmar en vivo');
    await lector.rcvResumen(EMPRESA, SEPT, 'COMPRA', 'REGISTRO');
    await lector.rcvDetalle(EMPRESA, SEPT, 'COMPRA', 33, 'REGISTRO');
    expect(base.llamadas).toEqual(['resumen|2026-09|COMPRA|REGISTRO', 'detalle|2026-09|COMPRA|REGISTRO|33']);
    // La sesión de quien accede se abre una sola vez, recién en la primera consulta del RCV.
    expect(aperturas).toBe(1);
  });

  it('si abrir la sesión de quien accede falla, las siguientes consultas de la misma llamada no vuelven a abrirla', async () => {
    let aperturas = 0;
    const lector = new LectorPorRepresentacion(async () => {
      aperturas++;
      throw new ErrorImpuestocl('PORTAL_CAMBIO', 'el portal cambió');
    }, PERSONA);
    expect(await codigoDe(lector.rcvResumen(EMPRESA, SEPT, 'VENTA', 'REGISTRO'))).toBe('PORTAL_CAMBIO');
    expect(await codigoDe(lector.rcvResumen(EMPRESA, SEPT, 'COMPRA', 'REGISTRO'))).toBe('PORTAL_CAMBIO');
    expect(await codigoDe(lector.rcvDetalle(EMPRESA, SEPT, 'COMPRA', 33, 'REGISTRO'))).toBe('PORTAL_CAMBIO');
    // Un solo intento de login por llamada: la clave guardada no se envía una y otra vez al SII.
    expect(aperturas).toBe(1);
  });

  it.each([
    ['f29Declaraciones', (l: LectorPorRepresentacion) => l.f29Declaraciones(EMPRESA, SEPT)],
    ['f29Valores', (l: LectorPorRepresentacion) => l.f29Valores(EMPRESA, declaracion())],
    ['f29Propuesta', (l: LectorPorRepresentacion) => l.f29Propuesta(EMPRESA, SEPT)],
    ['bheRecibidas', (l: LectorPorRepresentacion) => l.bheRecibidas(EMPRESA, SEPT)],
    ['bheEmitidasAnual', (l: LectorPorRepresentacion) => l.bheEmitidasAnual(EMPRESA, 2025)],
    ['bheEmitidasMes', (l: LectorPorRepresentacion) => l.bheEmitidasMes(EMPRESA, SEPT)],
    ['perfilTributario', (l: LectorPorRepresentacion) => l.perfilTributario(EMPRESA)],
    ['empresasAutorizadas', (l: LectorPorRepresentacion) => l.empresasAutorizadas()],
    ['f22Declaraciones', (l: LectorPorRepresentacion) => l.f22Declaraciones(EMPRESA, 2026)],
    ['f22Detalle', (l: LectorPorRepresentacion) => l.f22Detalle(EMPRESA, 2026, 1)],
  ] as const)('%s exige la sesión propia del contribuyente: SIN_PERMISO sin llamar al SII', async (_nombre, llamar) => {
    let aperturas = 0;
    const lector = new LectorPorRepresentacion(async () => {
      aperturas++;
      return new SiiFalso();
    }, PERSONA);
    const error = await llamar(lector).catch((e: unknown) => e);
    expect(error).toMatchObject({
      codigo: 'SIN_PERMISO',
      accion: 'Inicia sesión con la identidad del contribuyente (login o login-navegador).',
      message: expect.stringContaining(PERSONA),
    });
    // Ni siquiera se abre la sesión de quien accede: ni Mi SII ni el llavero.
    expect(aperturas).toBe(0);
  });
});
