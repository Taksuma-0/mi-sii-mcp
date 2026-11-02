import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { anotacionesDesde, cumplimientoDesde, limpiarGlosa, mensajesDesde, situacionSii } from '../../src/connectors/sii/situacion.js';
import { avisosDeSituacion } from '../../src/domain/situacion-sii.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, HTML, JSON_CT, sinEsperas } from '../helpers/http-falso.js';
import { paginaDatosCntr, RUTA_MI_SII } from '../helpers/sii-login.js';

// Respuestas ficticias con la forma vista en vivo el 01-11-2026 (decisión 0009).
const TI = String.fromCodePoint(0x10019f);
const ANOTACIONES = {
  codigo: 0,
  descripcion: 'OK',
  objSalida: [
    { taltCodigo: '4310', fechaActivacion: '13-10-2026', cantTaltCodigo: 2, glosaSubstr: 'No ha presentado su Declaración de IVA (Formulario 29). </p>\n\nPodría verse afectado.', accionStr: 'Envíe la declaración faltante.  </p>' },
  ],
};
const SIN_ANOTACIONES = { objSalida: null, codigo: 97, descripcion: 'Contribuyente no posee observaciones/alertas vigentes.' };
const CUMPLIMIENTO = {
  semestreActual: '',
  estado: 'Cumple sus obligaciones tributarias',
  mostrarObligacionTributaria: '1',
  historicos: null,
  atributos: [
    { atrCodigo: 'NDIR', cumple: 'SI', condicion: 'B', titulo: 'No tener atrasos en declaración de IVA y/o Renta', descripcion: `a lo menos en ${TI}empo` },
    { atrCodigo: 'ATPJ', cumple: 'NO', condicion: 'D', titulo: `No tener documentos por jus${TI}ficar`, descripcion: '' },
  ],
};
const SIN_MENSAJES = { codigoError: 0, descripcionError: 'No se encontraron resultados', sysdate: null, mensajes: null };
const RUTA_CARTAS = 'POST https://misiir.sii.cl/cgi_misii/CViewCarta.cgi';

describe('lectura de la situación en Mi SII', () => {
  it('limpia las glosas: etiquetas, espacios y la ligadura «ti» del SII', () => {
    expect(limpiarGlosa(`Estarás en incumplimiento ${TI}empo y respec${TI}vo. </p>\n\n<b>Fin</b>&nbsp;`)).toBe('Estarás en incumplimiento tiempo y respectivo. Fin');
  });

  it('lee las anotaciones vigentes con su fecha en AAAA-MM-DD, y ninguna con el código 97', () => {
    expect(anotacionesDesde(ANOTACIONES)).toEqual([
      { codigo: '4310', cantidad: 2, fechaActivacion: '2026-10-13', descripcion: 'No ha presentado su Declaración de IVA (Formulario 29). Podría verse afectado.', accion: 'Envíe la declaración faltante.' },
    ]);
    expect(anotacionesDesde({ codigo: 0, objSalida: [{ taltCodigo: '1014', glosaSubstr: 'No podrá solicitar folios de', accionStr: 'Envíe los documentos.' }] })[0]).toMatchObject({ descripcion: 'No podrá solicitar folios de…', accion: 'Envíe los documentos.', cantidad: 1, fechaActivacion: null });
    expect(anotacionesDesde(SIN_ANOTACIONES)).toEqual([]);
    expect(() => anotacionesDesde({ codigo: 5, objSalida: null })).toThrow(/Mi SII cambió/);
  });

  it('lee el estado de cumplimiento y los mensajes', () => {
    expect(cumplimientoDesde(CUMPLIMIENTO)).toEqual({
      estado: 'Cumple sus obligaciones tributarias',
      periodo: null,
      requisitos: [
        { codigo: 'NDIR', condicion: 'B', titulo: 'No tener atrasos en declaración de IVA y/o Renta', cumple: true },
        { codigo: 'ATPJ', condicion: 'D', titulo: 'No tener documentos por justificar', cumple: false },
      ],
    });
    expect(cumplimientoDesde({ atributos: null })).toBeNull();
    expect(mensajesDesde(SIN_MENSAJES)).toEqual([]);
    expect(mensajesDesde({ mensajes: [{ glosaTitulo: 'Aviso', glosaDescripcion: 'Texto', glosaSolucion: '' }] })).toEqual([{ titulo: 'Aviso', descripcion: 'Texto', solucion: null }]);
  });

  it('confirma que la sesión es del RUT y consulta las tres opciones por POST', async () => {
    const respuestas: Record<string, unknown> = { '28': ANOTACIONES, '118': CUMPLIMIENTO, '33': SIN_MENSAJES };
    const { fetchFalso, llamadas } = crearFetchFalso({
      [RUTA_MI_SII]: { headers: HTML, body: paginaDatosCntr('22222222', '2', 'EMPRESA DEMO SPA') },
      [RUTA_CARTAS]: (ll) => ({ headers: JSON_CT, body: JSON.stringify(respuestas[/opc=(\d+)/.exec(ll.body ?? '')![1]!]) }),
    });
    const http = new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });

    const s = await situacionSii(http, '22222222-2');

    expect(s.anotaciones.map((a) => a.codigo)).toEqual(['4310']);
    expect(s.cumplimiento?.requisitos).toHaveLength(2);
    expect(llamadas.filter((l) => l.method === 'POST').map((l) => l.body)).toEqual(['opc=28&VIEW=1', 'opc=118&VIEW=1', 'opc=33&VIEW=1']);
    expect(await codigoDe(situacionSii(http, '33333333-3'))).toBe('PORTAL_CAMBIO');
  });
});

describe('avisos de la situación en Mi SII', () => {
  it('avisa cada anotación por su código y fecha, y cada requisito que no se cumple', () => {
    const avisos = avisosDeSituacion('22222222-2', { anotaciones: anotacionesDesde(ANOTACIONES), cumplimiento: cumplimientoDesde(CUMPLIMIENTO), mensajes: [] });

    expect(avisos.map((a) => [a.clave, a.tipo, a.severidad])).toEqual([
      ['A:4310:2026-10-13', 'anotacion', 'advertencia'],
      ['C:ATPJ:', 'anotacion', 'advertencia'],
    ]);
    expect(avisos[0]!.titulo).toBe('Anotación del SII 4310 (desde 2026-10-13)');
    expect(avisos[0]!.detalle).toContain('Qué hacer: Envíe la declaración faltante.');
  });
});
