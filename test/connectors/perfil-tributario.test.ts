import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { ClienteHttp } from '../../src/connectors/sii/http.js';
import { extraerDatosCntrNow, leerPerfilTributario, perfilTributarioDesde } from '../../src/connectors/sii/login.js';
import { codigoDe } from '../helpers/errores.js';
import { crearFetchFalso, HTML, sinEsperas } from '../helpers/http-falso.js';
import { RUTA_MI_SII } from '../helpers/sii-login.js';

const fixture = (nombre: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sii', nombre), 'utf8');
const datos = (): Record<string, unknown> => JSON.parse(fixture('mi-sii-datos.json')) as Record<string, unknown>;
const pagina = (d: unknown): string => `<html><head><script>var DatosCntrNow = ${JSON.stringify(d)};</script></head><body>Mi SII</body></html>`;

describe('perfilTributarioDesde', () => {
  it('toma solo la lista permitida: día 20, tipo, subtipo, segmento, actividad, fechas y atributos', () => {
    expect(perfilTributarioDesde(datos())).toEqual({
      autorizadoDia20: true,
      tipoCodigo: '1',
      tipoDescripcion: 'Primera Categoría',
      subtipoCodigo: '10',
      subtipoDescripcion: 'Sociedad por acciones',
      segmentoCodigo: '5',
      segmentoDescripcion: 'Segmento ficticio',
      glosaActividad: 'SERVICIOS DE ASESORIA DE EJEMPLO',
      fechaInicioActividades: '2020-03-02',
      fechaTerminoGiro: null,
      personaEmpresa: 'E',
      atributos: [
        { codigo: '14TT', descripcion: 'Régimen Pro Pyme Transparente 14 D N°8', fechaInicio: '2025-01-01', fechaTermino: null, valor: 'S' },
        { codigo: 'EMTP', descripcion: 'Tamaño de empresa', fechaInicio: '2020-03-02', fechaTermino: null, valor: 'MICRO' },
        { codigo: 'FPYM', descripcion: 'Facturador electrónico MIPYME', fechaInicio: '2022-05-10', fechaTermino: '2024-12-31', valor: 'S' },
        { codigo: 'NOTI', descripcion: 'Notificación por correo electrónico', fechaInicio: '2021-01-01', fechaTermino: null },
        { codigo: 'REGS', descripcion: 'Registro de sociedades', fechaInicio: '2020-03-02', fechaTermino: null },
        { codigo: 'SGMI', descripcion: 'Segmento', fechaInicio: '2023-01-01', fechaTermino: null, valor: 'Segmento ficticio' },
      ],
    });
  });

  it('nunca deja pasar el correo, los nombres, los teléfonos, el pasaporte, el nacimiento ni las direcciones', () => {
    const perfil = perfilTributarioDesde(datos());
    const texto = JSON.stringify(perfil);
    for (const privado of ['ejemplo.invalid', 'NOMBRE FICTICIO', 'APELLIDO', 'INVENTADA', 'COMUNA FICTICIA', '+56', 'PASAPORTE', '1990', 'INSCRIPCION']) {
      expect(texto, privado).not.toContain(privado);
    }
    // Los códigos fuera de la lista permitida llegan sin la clave `valor`, no con un valor vacío.
    expect('valor' in perfil.atributos.find((a) => a.codigo === 'NOTI')!).toBe(false);
    expect('valor' in perfil.atributos.find((a) => a.codigo === 'REGS')!).toBe(false);
    expect(Object.keys(perfil).sort()).toEqual([
      'atributos',
      'autorizadoDia20',
      'fechaInicioActividades',
      'fechaTerminoGiro',
      'glosaActividad',
      'personaEmpresa',
      'segmentoCodigo',
      'segmentoDescripcion',
      'subtipoCodigo',
      'subtipoDescripcion',
      'tipoCodigo',
      'tipoDescripcion',
    ]);
  });

  it('un valor permitido que parezca un correo se descarta', () => {
    const d = datos();
    (d['atributos'] as Record<string, unknown>[])[1]!['valor'] = 'alguien@ejemplo.invalid';
    const perfil = perfilTributarioDesde(d);
    expect(perfil.atributos.find((a) => a.codigo === 'EMTP')!.valor ?? null).toBeNull();
    expect(JSON.stringify(perfil)).not.toContain('@');
  });

  it.each([
    ['S', true],
    ['s', true],
    ['N', false],
    ['n', false],
    ['', null],
    ['X', null],
    [null, null],
    [1, null],
  ])('autorizadoDeclararDia20 %j es %j', (valor, esperado) => {
    const d = datos();
    (d['contribuyente'] as Record<string, unknown>)['autorizadoDeclararDia20'] = valor;
    expect(perfilTributarioDesde(d).autorizadoDia20).toBe(esperado);
  });

  it('lo ausente es null y los atributos mal formados se descartan', () => {
    const p = perfilTributarioDesde({ contribuyente: { rut: '22222222', dv: '2' }, atributos: [null, 5, { descAtrCodigo: 'sin código' }, { atrCodigo: '  ', valor: 'x' }, { atrCodigo: 'EMTP' }] });
    expect(p).toEqual({
      autorizadoDia20: null,
      tipoCodigo: null,
      tipoDescripcion: null,
      subtipoCodigo: null,
      subtipoDescripcion: null,
      segmentoCodigo: null,
      segmentoDescripcion: null,
      glosaActividad: null,
      fechaInicioActividades: null,
      fechaTerminoGiro: null,
      personaEmpresa: null,
      atributos: [{ codigo: 'EMTP', descripcion: null, fechaInicio: null, fechaTermino: null, valor: null }],
    });
    expect(perfilTributarioDesde({ contribuyente: { rut: '22222222', dv: '2' }, atributos: 'no es lista' }).atributos).toEqual([]);
  });

  it('sin el bloque contribuyente es PORTAL_CAMBIO', async () => {
    expect(await codigoDe(Promise.resolve().then(() => perfilTributarioDesde({ atributos: [] })))).toBe('PORTAL_CAMBIO');
    expect(await codigoDe(Promise.resolve().then(() => perfilTributarioDesde({ contribuyente: [] })))).toBe('PORTAL_CAMBIO');
  });
});

describe('leerPerfilTributario', () => {
  const http = (fetchFalso: typeof fetch) => new ClienteHttp(new CookieJar(), { fetch: fetchFalso, temporizador: sinEsperas });

  it('lee Mi SII con la sesión y entrega el perfil permitido, sin RUT ni datos personales', async () => {
    const { fetchFalso, llamadas } = crearFetchFalso({ [RUTA_MI_SII]: { headers: HTML, body: pagina(datos()) } });

    const perfil = await leerPerfilTributario(http(fetchFalso), '22222222-2');

    expect(perfil.autorizadoDia20).toBe(true);
    expect(perfil.atributos).toHaveLength(6);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.method).toBe('GET');
    expect(JSON.stringify(perfil)).not.toMatch(/ejemplo\.invalid|22222222/);
  });

  it('si Mi SII entrega a otro contribuyente no devuelve su perfil', async () => {
    const d = datos();
    (d['contribuyente'] as Record<string, unknown>)['rut'] = '33333333';
    (d['contribuyente'] as Record<string, unknown>)['dv'] = '3';
    const { fetchFalso } = crearFetchFalso({ [RUTA_MI_SII]: { headers: HTML, body: pagina(d) } });
    expect(await codigoDe(leerPerfilTributario(http(fetchFalso), '22222222-2'))).toBe('PORTAL_CAMBIO');
  });

  it('sin DatosCntrNow la sesión no está activa', async () => {
    const { fetchFalso } = crearFetchFalso({ [RUTA_MI_SII]: { headers: HTML, body: '<html>sin datos</html>' } });
    expect(await codigoDe(leerPerfilTributario(http(fetchFalso), '22222222-2'))).toBe('SESION_REQUERIDA');
  });

  it('la página de la fixture se extrae con extraerDatosCntrNow', () => {
    expect(extraerDatosCntrNow(pagina(datos()))).toMatchObject({ codigoError: 0 });
  });
});
