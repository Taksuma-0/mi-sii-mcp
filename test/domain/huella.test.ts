import { describe, expect, it } from 'vitest';
import { huellaRespuesta, superficieHuella } from '../../src/domain/huella.js';

const json = (v: unknown) => JSON.stringify(v);

describe('huella de una respuesta del SII', () => {
  it('describe solo los nombres de los campos, sin valores', () => {
    const rutas = huellaRespuesta(json({ data: [{ detNroDoc: 1234, detRznSoc: 'PROVEEDOR SECRETO SPA', detMntNeto: 100000 }], metaData: { conversationId: 'TOKEN123' } }));

    expect(rutas).toEqual(['data', 'data[]', 'data[].detMntNeto', 'data[].detNroDoc', 'data[].detRznSoc', 'metaData', 'metaData.conversationId']);
    expect(JSON.stringify(rutas)).not.toMatch(/SECRETO|TOKEN123|100000|1234/);
  });

  it('une las filas de una lista y normaliza las llaves numéricas', () => {
    const a = huellaRespuesta(json({ data: { listAgenteRetenedor: { '1879': { resumen: 1 } } } }));
    const b = huellaRespuesta(json({ data: { listAgenteRetenedor: { '39': { resumen: 2 } } } }));
    const filas = huellaRespuesta(json({ data: [{ a: 1 }, { b: 2 }] }));

    expect(a).toEqual(b);
    expect(a).toContain('data.listAgenteRetenedor.#.resumen');
    expect(filas).toEqual(['data', 'data[]', 'data[].a', 'data[].b']);
  });

  it('un mes vacío no inventa campos: solo trae los de la envoltura', () => {
    expect(huellaRespuesta(json({ data: null, metaData: { errors: null } }))).toEqual(['data', 'metaData', 'metaData.errors']);
  });

  it('lee los campos de las páginas de boletas de honorarios', () => {
    const html = "<script>arr_informe_mensual['nroboleta_1'] = '12';\narr_informe_mensual['totalhonorarios_1'] = formatMiles(\"50000\",'.');\nxml_values['total_boletas'] = '1';</script>";

    expect(huellaRespuesta(html)).toEqual(['html:arr.nroboleta', 'html:arr.totalhonorarios', 'html:xml.total_boletas']);
  });

  it('no describe PDF, JSON roto ni texto sin estructura', () => {
    expect(huellaRespuesta('JVBERi0xLjQKJaqrrK0K')).toBeNull();
    expect(huellaRespuesta('{"data": [1, 2')).toBeNull();
    expect(huellaRespuesta('<html><body>hola</body></html>')).toBeNull();
  });

  it('pone tope a la profundidad y a la cantidad de rutas', () => {
    let hondo: Record<string, unknown> = { fin: 1 };
    for (let i = 0; i < 20; i++) hondo = { n: hondo };
    const ancho = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`c${i}`, i]));

    expect(huellaRespuesta(json(hondo))!.every((r) => r.split('.').length <= 8)).toBe(true);
    expect(huellaRespuesta(json(ancho))!.length).toBe(400);
  });

  it('agrupa las superficies que solo cambian en un número (tipo de documento)', () => {
    expect(superficieHuella('rcv.detalle.COMPRA.REGISTRO.33')).toBe('rcv.detalle.COMPRA.REGISTRO.N');
    expect(superficieHuella('rcv.resumen.VENTA.REGISTRO')).toBe('rcv.resumen.VENTA.REGISTRO');
    expect(superficieHuella('terceros.1879')).toBe('terceros.N');
  });
});
