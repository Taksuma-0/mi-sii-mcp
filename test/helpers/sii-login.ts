import { HTML, type DefRespuesta } from './http-falso.js';

export const RUTA_PAGINA = 'GET https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html';
export const RUTA_POST = 'POST https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi';
export const RUTA_MI_SII = 'GET https://misiir.sii.cl/cgi_misii/siihome.cgi';
export const RUTA_LOGOUT = 'GET https://zeusr.sii.cl/cgi_AUT2000/autTermino.cgi';

export const PAGINA_STUB =
  "<html><script>location.replace('https://zeusr.sii.cl//AUT2000/InicioAutenticacion/IngresoRutClave.html?https://misiir.sii.cl/cgi_misii/siihome.cgi')</script></html>";

export function paginaDatosCntr(rut: string, dv: string, razonSocial: string | null): string {
  const datos = {
    codigoError: 0,
    contribuyente: {
      rut,
      dv,
      razonSocial,
      nombres: razonSocial ? null : 'JUANA',
      apellidoPaterno: razonSocial ? null : 'PÉREZ',
      apellidoMaterno: null,
      glosaActividad: 'texto con } llave',
    },
  };
  return `<html><head><script>var DatosCntrNow = ${JSON.stringify(datos)};</script></head><body>Mi SII</body></html>`;
}

/** Página de clave incorrecta, codificada en ISO-8859-1 como la sirve el SII. */
export function paginaErrorClave(): DefRespuesta {
  const html =
    '<html><body>La Clave Tributaria ingresada no es correcta, verifique que su teclado no está con opción "mayúsculas" e inténtelo nuevamente.' +
    '<br>El código de este mensaje es 01.01.203.500.720.20 <button>Aceptar</button></body></html>';
  return { body: Uint8Array.from(Buffer.from(html, 'latin1')), headers: [['content-type', 'text/html; charset=ISO-8859-1']] };
}

export function rutasLoginOk(rut = '22222222', dv = '2', razonSocial: string | null = 'EMPRESA DEMO SPA'): Record<string, DefRespuesta> {
  return {
    [RUTA_PAGINA]: { headers: [...HTML, ['set-cookie', 'TS01=waf; Domain=.sii.cl; Path=/']] },
    [RUTA_POST]: {
      headers: [...HTML, ['set-cookie', 'TOKEN=tok123; Domain=.sii.cl; Path=/'], ['set-cookie', 'CSESSIONID=ses; Domain=.sii.cl; Path=/']],
      body: '<html><script>window.location="https://misiir.sii.cl/cgi_misii/siihome.cgi"</script></html>',
    },
    [RUTA_MI_SII]: { headers: HTML, body: paginaDatosCntr(rut, dv, razonSocial) },
    [RUTA_LOGOUT]: { headers: HTML, body: '<html></html>' },
  };
}
