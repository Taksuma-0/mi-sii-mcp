import { describe, expect, it } from 'vitest';
import { importarCartola } from '../../src/app/banco.js';
import { depsDePrueba } from '../helpers/deps.js';
import { codigoDe } from '../helpers/errores.js';
import { perfilEmpresa, RUT_EMPRESA } from '../helpers/fabricas.js';

const ENCABEZADO = 'Fecha;Descripción;N° Documento;Cargos;Abonos;Saldo';
const CARTOLA = [ENCABEZADO, '02/10/2026;TRANSFERENCIA CLIENTE;1;;1.190.000;2.190.000', '03/10/2026;PAGO PROVEEDOR;2;119.000;;2.071.000', '05/10/2026;COMISION;;5.990;;2.065.010'].join('\n');

function preparar() {
  const p = depsDePrueba({ ahora: '2026-10-30T15:00:00.000Z' });
  p.store.guardarContribuyente(perfilEmpresa());
  return p;
}

describe('importarCartola', () => {
  it('importa una cartola, cuadra el saldo y al reimportarla no repite movimientos', async () => {
    const { deps, store, archivos } = preparar();
    archivos.poner('C:/cartolas/octubre.csv', CARTOLA);

    const r = await importarCartola(deps, '22.222.222-2', 'C:/cartolas/octubre.csv', { cuenta: 'corriente' });
    const otra = await importarCartola(deps, RUT_EMPRESA, 'C:/cartolas/octubre.csv', { cuenta: 'corriente' });

    expect(r).toMatchObject({ rut: RUT_EMPRESA, cuenta: 'corriente', archivo: 'octubre.csv', leidos: 3, nuevos: 3, repetidos: 0, desde: '2026-10-02', hasta: '2026-10-05', saldoCuadra: true, avisos: [] });
    expect(otra).toMatchObject({ nuevos: 0, repetidos: 3 });
    expect(store.movimientosBanco(RUT_EMPRESA).map((m) => m.monto)).toEqual([1_190_000, -119_000, -5_990]);
  });

  it('la misma cartola en otra cuenta son movimientos distintos, y sin cuenta se usa «principal»', async () => {
    const { deps, store, archivos } = preparar();
    archivos.poner('a.csv', CARTOLA);

    await importarCartola(deps, RUT_EMPRESA, 'a.csv', { cuenta: 'corriente' });
    const r = await importarCartola(deps, RUT_EMPRESA, 'a.csv');

    expect(r).toMatchObject({ cuenta: 'principal', nuevos: 3 });
    expect(store.cuentasBanco(RUT_EMPRESA)).toEqual(['corriente', 'principal']);
  });

  it('avisa cuando el saldo se corta: faltan movimientos', async () => {
    const { deps, archivos } = preparar();
    archivos.poner('b.csv', [ENCABEZADO, '02/10/2026;A;;;100.000;1.100.000', '05/10/2026;B;;10.000;;1.050.000'].join('\n'));

    const r = await importarCartola(deps, RUT_EMPRESA, 'b.csv');

    expect(r.saldoCuadra).toBe(false);
    expect(r.avisos).toEqual(['El saldo no cuadra entre el 2026-10-02 y el 2026-10-05: faltan movimientos en la cartola.']);
  });

  it('entiende las cartolas ordenadas de la más nueva a la más antigua', async () => {
    const { deps, archivos } = preparar();
    archivos.poner('c.csv', [ENCABEZADO, '05/10/2026;B;;10.000;;1.090.000', '02/10/2026;A;;;100.000;1.100.000'].join('\n'));

    expect((await importarCartola(deps, RUT_EMPRESA, 'c.csv')).saldoCuadra).toBe(true);
  });

  it('rechaza un alias de cuenta inválido y un perfil que no existe', async () => {
    const { deps, archivos } = preparar();
    archivos.poner('a.csv', CARTOLA);
    expect(await codigoDe(importarCartola(deps, RUT_EMPRESA, 'a.csv', { cuenta: '' }))).toBe('PARAMETROS_INVALIDOS');
    expect(await codigoDe(importarCartola(deps, '11.111.111-1', 'a.csv'))).toBe('PERFIL_NO_EXISTE');
  });
});
