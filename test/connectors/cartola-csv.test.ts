import { describe, expect, it } from 'vitest';
import { leerCartolaCsv } from '../../src/connectors/banco/cartola-csv.js';
import { ErrorMiSiiMcp } from '../../src/domain/errores.js';

const latin1 = (texto: string): Uint8Array => new Uint8Array(Buffer.from(texto, 'latin1'));
const utf8 = (texto: string): Uint8Array => new Uint8Array(Buffer.from(texto, 'utf8'));

/** Cartola ficticia con preámbulo, saldo inicial y totales, como la descargan varios bancos. */
const CARTOLA_CARGO_ABONO = [
  'Cartola de movimientos',
  'Cuenta Corriente;N° 000-0-000000-0',
  'Período;01/10/2026 al 31/10/2026',
  '',
  'Fecha;Descripción;N° Documento;Cargos ($);Abonos ($);Saldo ($)',
  '01/10/2026;Saldo inicial;;;;1.000.000',
  '02/10/2026;TRANSFERENCIA DE 76.123.456-7 CLIENTE SPA;123;;1.190.000;2.190.000',
  '03/10/2026;PAGO PROVEEDOR ÑANDÚ LTDA;124;119.000;;2.071.000',
  '05/10/2026;COMISIÓN MANTENCIÓN;;$ 5.990;;2.065.010',
  'Totales;;;124.990;1.190.000;',
].join('\r\n');

describe('leerCartolaCsv', () => {
  it('lee una cartola con cargos y abonos separados por punto y coma, en latin1 y con preámbulo', () => {
    const r = leerCartolaCsv(latin1(CARTOLA_CARGO_ABONO));

    expect(r.movimientos.map(({ fecha, descripcion, documento, monto, saldo }) => ({ fecha, descripcion, documento, monto, saldo }))).toEqual([
      { fecha: '2026-10-02', descripcion: 'TRANSFERENCIA DE 76.123.456-7 CLIENTE SPA', documento: '123', monto: 1_190_000, saldo: 2_190_000 },
      { fecha: '2026-10-03', descripcion: 'PAGO PROVEEDOR ÑANDÚ LTDA', documento: '124', monto: -119_000, saldo: 2_071_000 },
      { fecha: '2026-10-05', descripcion: 'COMISIÓN MANTENCIÓN', documento: null, monto: -5_990, saldo: 2_065_010 },
    ]);
    expect(r.descartadas).toBe(2);
    expect(r.columnas).toEqual({ fecha: 'Fecha', descripcion: 'Descripción', documento: 'N° Documento', cargo: 'Cargos ($)', abono: 'Abonos ($)', monto: null, saldo: 'Saldo ($)' });
  });

  it('lee una cartola con un monto con signo, separada por comas, con comillas y BOM', () => {
    const r = leerCartolaCsv(utf8('﻿fecha,detalle,monto,saldo\n2026-10-02,"Pago, factura 55",-50.000,950.000\n2026-10-03,Depósito,200.000,1.150.000\n'));

    expect(r.movimientos.map((m) => [m.fecha, m.descripcion, m.monto, m.saldo])).toEqual([
      ['2026-10-02', 'Pago, factura 55', -50_000, 950_000],
      ['2026-10-03', 'Depósito', 200_000, 1_150_000],
    ]);
    expect(r.columnas).toMatchObject({ fecha: 'fecha', descripcion: 'detalle', monto: 'monto', cargo: null, abono: null });
  });

  it('no confunde «Descripción de la operación» ni «Monto operación» con el número de documento', () => {
    const r = leerCartolaCsv(utf8('Fecha;Descripción de la operación;N° Operación;Monto operación\n02/10/2026;Pago;77;-1.000\n'));

    expect(r.columnas).toMatchObject({ descripcion: 'Descripción de la operación', documento: 'N° Operación', monto: 'Monto operación' });
    expect(r.movimientos.map((m) => [m.descripcion, m.documento, m.monto])).toEqual([['Pago', '77', -1_000]]);
  });

  it('usa las columnas indicadas cuando sus nombres no se reconocen, y entiende años de dos dígitos', () => {
    const r = leerCartolaCsv(utf8('Día;Glosa banco;Movimiento\n02/10/26;Arriendo;-300.000\n'), { fecha: 'Día', descripcion: 'Glosa banco', monto: 'Movimiento' });

    expect(r.movimientos.map((m) => [m.fecha, m.descripcion, m.monto])).toEqual([['2026-10-02', 'Arriendo', -300_000]]);
  });

  it('dos cargos idénticos el mismo día son dos movimientos con huellas distintas y estables entre archivos', () => {
    const fila = '07/10/2026;PAGO SERVICIO;;10.000;;';
    const encabezado = 'Fecha;Descripción;N° Documento;Cargos;Abonos;Saldo';
    const a = leerCartolaCsv(utf8([encabezado, fila, fila].join('\n')));
    const b = leerCartolaCsv(utf8([encabezado, '06/10/2026;OTRO;;1;;', fila, fila].join('\n')));

    expect(a.movimientos).toHaveLength(2);
    expect(new Set(a.movimientos.map((m) => m.huella)).size).toBe(2);
    expect(b.movimientos.slice(1).map((m) => m.huella)).toEqual(a.movimientos.map((m) => m.huella));
  });

  it('una cartola sin cabecera reconocible es ARCHIVO_INVALIDO y el error no muestra su contenido', () => {
    let error: unknown;
    try {
      leerCartolaCsv(utf8('secreto-123;otra cosa\n1;2\n'));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorMiSiiMcp);
    expect((error as ErrorMiSiiMcp).codigo).toBe('ARCHIVO_INVALIDO');
    expect((error as ErrorMiSiiMcp).message).not.toContain('secreto-123');
  });

  it('una cartola con cabecera pero sin movimientos también es ARCHIVO_INVALIDO', () => {
    expect(() => leerCartolaCsv(utf8('Fecha;Descripción;Monto\nTotales;;0\n'))).toThrow(/sin movimientos/);
  });
});
