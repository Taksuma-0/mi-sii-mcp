import { describe, expect, it } from 'vitest';
import { exportarLibro, libro } from '../../src/app/libros.js';
import { depsDePrueba } from '../helpers/deps.js';
import { codigoDe } from '../helpers/errores.js';
import { boleta, documento, fila, perfilEmpresa, resumen, RUT_CLIENTE, RUT_EMPRESA } from '../helpers/fabricas.js';
import { sembrarMes, T_SEMBRADO } from '../helpers/sembrar.js';

function preparar() {
  const p = depsDePrueba();
  p.store.guardarContribuyente(perfilEmpresa());
  sembrarMes(p.store, '2026-09', {
    resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000), fila(39, 50_000, 9_500, 3)] })],
    documentos: [
      documento({ lado: 'VENTA', rutContraparte: RUT_CLIENTE, folio: 1, razonSocial: 'CLIENTE DEMO SPA', fechaEmision: '2026-09-03', montoNeto: 1_000_000, montoIva: 190_000, montoTotal: 1_190_000 }),
      documento({ folio: 100, fechaEmision: '2026-09-05', montoNeto: 100_000, montoIva: 19_000, montoTotal: 119_000 }),
      documento({ tipoDoc: 61, folio: 7, fechaEmision: '2026-09-20', montoNeto: 10_000, montoIva: 1_900, montoTotal: 11_900 }),
    ],
  });
  const id = p.store.iniciarSincronizacion(RUT_EMPRESA, 'bhe.recibidas', '2026-09', T_SEMBRADO);
  p.store.reemplazarBhe(id, RUT_EMPRESA, '2026-09', [boleta(), boleta({ folio: 102, anulada: true })], T_SEMBRADO);
  p.store.terminarSincronizacion(id, T_SEMBRADO, 'ok');
  return p;
}

describe('libros', () => {
  it('el libro de compras resta las notas de crédito en los totales', () => {
    const { deps } = preparar();
    const l = libro(deps, RUT_EMPRESA, 'compras', '2026-09', '2026-09');

    expect(l.filas).toHaveLength(2);
    expect(l.totales).toMatchObject({ documentos: 2, neto: 90_000, iva: 17_100, total: 107_100 });
    expect(l.columnas).toEqual(['Fecha', 'Período', 'Tipo', 'Folio', 'RUT', 'Razón social', 'Exento', 'Neto', 'IVA', 'IVA no recuperable', 'IVA uso común', 'Total', 'Estado', 'Tipo de compra']);
  });

  it('el libro de ventas suma las boletas, que el RCV entrega solo como resumen', () => {
    const { deps } = preparar();
    const l = libro(deps, RUT_EMPRESA, 'ventas', '2026-09', '2026-09');

    expect(l.filas.map((f) => f[2])).toEqual(['Factura', 'Boleta (resumen de 3)']);
    expect(l.totales).toMatchObject({ neto: 1_050_000, iva: 199_500, total: 1_249_500 });
  });

  it('el libro de honorarios recibidos lleva bruto, retención y líquido, sin sumar las anuladas', () => {
    const { deps } = preparar();
    const l = libro(deps, RUT_EMPRESA, 'honorarios_recibidos', '2026-09', '2026-09');

    expect(l.filas).toHaveLength(2);
    expect(l.totales).toMatchObject({ boletas: 1, bruto: 1_000_000, retencion: 152_500, liquido: 847_500 });
  });

  it('exporta un CSV para Excel: BOM, punto y coma, fechas dd-mm-aaaa y montos sin separador', async () => {
    const { deps, archivos } = preparar();

    const ruta = await exportarLibro(deps, libro(deps, RUT_EMPRESA, 'compras', '2026-09', '2026-09'));

    expect(ruta).toBe('C:/exportaciones/libro-compras-22222222-2-2026-09-2026-09.csv');
    const csv = archivos.exportados.get(ruta)!;
    expect(csv.startsWith('\uFEFFFecha;Período;Tipo;Folio;')).toBe(true);
    expect(csv).toContain('05-09-2026;2026-09;Factura;100;33333333-3;PROVEEDOR DEMO LTDA;0;100000;19000;0;0;119000;REGISTRO;1');
    expect(csv).toContain('20-09-2026;2026-09;Nota de crédito;7;33333333-3;PROVEEDOR DEMO LTDA;0;-10000;-1900;0;0;-11900;REGISTRO;1');
  });

  it('el libro del banco necesita cartolas', async () => {
    const { deps } = preparar();
    expect(await codigoDe(Promise.resolve().then(() => libro(deps, RUT_EMPRESA, 'banco', '2026-09', '2026-09')))).toBe('SIN_DATOS_LOCALES');
  });
});
