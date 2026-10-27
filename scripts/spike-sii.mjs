#!/usr/bin/env node
// SPIKE DESECHABLE — Tarea 1 del plan mi-sii-mcp v1. No es código de producto.
// Verifica en vivo: login con clave tributaria, RCV por estado, F29 (estados y PDF compacto).
// Uso:  node scripts/spike-sii.mjs <RUT> [AAAA-MM]
// Hace UN solo intento de login: cada intento fallido acerca la cuenta al bloqueo del SII.
// Guarda las respuestas en .spike/<rut>/ (ignorado por git: contiene datos tributarios reales).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MI_SII = 'https://misiir.sii.cl/cgi_misii/siihome.cgi';
const LOGIN_PAGINA = `https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html?${MI_SII}`;
const LOGIN_POST = 'https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi';
const LOGOUT = 'https://zeusr.sii.cl/cgi_AUT2000/autTermino.cgi';
const RCV = 'https://www4.sii.cl/consdcvinternetui/services/data/facadeService';
const RCV_NS = 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService';
const RCV_REF = 'https://www4.sii.cl/consdcvinternetui/';
const F29 = 'https://www4.sii.cl/propuestaf29ui/services/data/facadeAdapterService';
const F29_NS = 'cl.sii.sdi.lob.iva.propuestaf29.data.api.interfaces.FacadeAdapterService';
const F29_REF = 'https://www4.sii.cl/propuestaf29ui/';

const [rutArg, periodoArg] = process.argv.slice(2);
if (!rutArg) {
  console.error('Uso: node scripts/spike-sii.mjs <RUT> [AAAA-MM]');
  process.exit(1);
}
const limpio = rutArg.replace(/[.\s-]/g, '').toUpperCase();
const cuerpo = String(Number(limpio.slice(0, -1)));
const dv = limpio.slice(-1);
const rutPuntos = `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
const periodo =
  periodoArg ??
  (() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
const [anio, mes] = periodo.split('-').map(Number);
const dir = join('.spike', `${cuerpo}-${dv}`);
mkdirSync(dir, { recursive: true });
const resumen = [];
const anotar = (linea) => {
  console.log(linea);
  resumen.push(linea);
};
const guardar = (nombre, contenido) => writeFileSync(join(dir, nombre), contenido);

const cookies = new Map();
function recibirCookies(res) {
  for (const sc of res.headers.getSetCookie()) {
    const par = sc.split(';')[0] ?? '';
    const i = par.indexOf('=');
    const nombre = par.slice(0, i).trim();
    const valor = par.slice(i + 1).trim();
    if (!valor || /max-age=0/i.test(sc)) cookies.delete(nombre);
    else cookies.set(nombre, valor);
  }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
function decodificar(buf, ct) {
  const cs = /charset=([^;]+)/i.exec(ct ?? '')?.[1]?.trim().toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(cs).decode(buf);
  } catch {
    return new TextDecoder().decode(buf);
  }
}

async function pedir(url, { method = 'GET', headers = {}, body } = {}) {
  let actual = url;
  let m = method;
  let b = body;
  for (let salto = 0; salto < 10; salto++) {
    await dormir(1000);
    const h = { 'User-Agent': UA, 'Accept-Language': 'es-CL,es;q=0.9', ...headers };
    if (cookies.size) h.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(actual, { method: m, headers: h, body: b, redirect: 'manual' });
    recibirCookies(res);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      actual = new URL(loc, actual).toString();
      if (new URL(actual).hostname === 'salaespera.sii.cl') throw new Error('El SII tiene sala de espera (Queue-it). Intenta más tarde.');
      if ([301, 302, 303].includes(res.status)) {
        m = 'GET';
        b = undefined;
      }
      continue;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, url: actual, ct, buf, texto: decodificar(buf, ct) };
  }
  throw new Error('Demasiadas redirecciones');
}

function pedirClave(pregunta) {
  return new Promise((resolve, reject) => {
    const entrada = process.stdin;
    if (!entrada.isTTY) {
      reject(new Error('Ejecuta el script en una terminal interactiva.'));
      return;
    }
    process.stderr.write(pregunta);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    let clave = '';
    const fin = () => {
      entrada.off('data', alDato);
      entrada.setRawMode(false);
      entrada.pause();
    };
    function alDato(trozo) {
      for (const c of trozo) {
        if (c === '\r' || c === '\n') {
          fin();
          process.stderr.write('\n');
          resolve(clave);
          return;
        }
        if (c === '\u0003') {
          fin();
          process.stderr.write('\n');
          reject(new Error('Cancelado'));
          return;
        }
        if (c === '\u007f' || c === '\b') {
          if (clave.length) {
            clave = clave.slice(0, -1);
            process.stderr.write('\b \b');
          }
          continue;
        }
        clave += c;
        process.stderr.write('*');
      }
    }
    entrada.on('data', alDato);
  });
}

async function sdi(nombre, url, ns, referer, data, conPage) {
  const metaData = { namespace: ns, conversationId: cookies.get('TOKEN') ?? '', transactionId: randomUUID() };
  if (conPage) metaData.page = null;
  const r = await pedir(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', Origin: 'https://www4.sii.cl', Referer: referer },
    body: JSON.stringify({ metaData, data }),
  });
  guardar(`${nombre}.json`, r.texto);
  try {
    return JSON.parse(r.texto);
  } catch {
    anotar(`  ${nombre}: NO es JSON (status ${r.status}, url final ${r.url})`);
    return null;
  }
}

// --- S1: login --------------------------------------------------------------------------
const clave = await pedirClave(`Clave tributaria de ${rutPuntos}: `);
await pedir(LOGIN_PAGINA);
const form = new URLSearchParams({ rut: cuerpo, dv, referencia: MI_SII, '411': '', rutcntr: rutPuntos, clave });
const login = await pedir(LOGIN_POST, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://zeusr.sii.cl', Referer: LOGIN_PAGINA },
  body: form.toString(),
});
const errLogin = /El c.{1,2}digo de este mensaje es\s*([\d.]+\d)/.exec(login.texto);
if (errLogin) {
  anotar(`S1 login: RECHAZADO (código ${errLogin[1]}). No se reintenta.`);
  guardar('resumen.txt', resumen.join('\n'));
  process.exit(2);
}
anotar(`S1 login: status ${login.status}, cookie TOKEN ${cookies.has('TOKEN') ? 'presente' : 'AUSENTE'}, cookies: ${[...cookies.keys()].join(',')}`);
const mi = await pedir(MI_SII);
anotar(`S1 Mi SII: ${mi.texto.includes('DatosCntrNow') ? 'DatosCntrNow presente' : 'SIN DatosCntrNow'} (url ${mi.url})`);
guardar('mi-sii.html', mi.texto);

// --- S1: RCV por estado -----------------------------------------------------------------
const ptributario = periodo.replace('-', '');
for (const lado of ['COMPRA', 'VENTA']) {
  const estados = lado === 'COMPRA' ? ['REGISTRO', 'PENDIENTE', 'NO_INCLUIR', 'RECLAMADO'] : ['REGISTRO'];
  for (const estado of estados) {
    const j = await sdi(`rcv-resumen-${lado}-${estado}`, `${RCV}/getResumen`, `${RCV_NS}/getResumen`, RCV_REF, { rutEmisor: cuerpo, dvEmisor: dv, ptributario, estadoContab: estado, operacion: lado, busquedaInicial: true }, true);
    const filas = j?.data ?? [];
    anotar(`S1 RCV resumen ${lado} ${estado}: codRespuesta=${j?.respEstado?.codRespuesta} msg="${j?.respEstado?.msgeRespuesta ?? ''}" filas=${filas.map((f) => `${f.rsmnTipoDocInteger}:${f.rsmnTotDoc}`).join(' ')}`);
    if (filas[0]) anotar(`    campos resumen: ${Object.keys(filas[0]).join(',')}`);
    const conDocs = filas.find((f) => Number(f.rsmnTotDoc) > 0 && ![35, 38, 39, 41, 48].includes(Number(f.rsmnTipoDocInteger)));
    if (conDocs) {
      const sufijo = lado === 'COMPRA' ? 'Compra' : 'Venta';
      const d = await sdi(
        `rcv-detalle-${lado}-${estado}-${conDocs.rsmnTipoDocInteger}`,
        `${RCV}/getDetalle${sufijo}`,
        `${RCV_NS}/getDetalle${sufijo}`,
        RCV_REF,
        { rutEmisor: cuerpo, dvEmisor: dv, ptributario, estadoContab: estado, operacion: lado, codTipoDoc: String(conDocs.rsmnTipoDocInteger), accionRecaptcha: lado === 'COMPRA' ? 'RCV_DETC' : 'RCV_DETV', tokenRecaptcha: 't-o-k-e-n-web' },
        true,
      );
      const docs = d?.data ?? [];
      anotar(`S1 RCV detalle ${lado} ${estado} tipo ${conDocs.rsmnTipoDocInteger}: codRespuesta=${d?.respEstado?.codRespuesta} docs=${docs.length} de ${conDocs.rsmnTotDoc}`);
      if (docs[0]) anotar(`    campos detalle: ${Object.keys(docs[0]).join(',')}`);
    }
  }
}

// --- S3: estados F29 de 12 meses --------------------------------------------------------
let ultimo = null;
for (let k = 0; k < 12; k++) {
  const d = new Date(anio, mes - 1 - k, 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const aa = String(d.getFullYear());
  const j = await sdi(`f29-estados-${aa}-${mm}`, `${F29}/getDeclaracionConEstados`, `${F29_NS}/getDeclaracionConEstados`, F29_REF, { rut: cuerpo, dv, formId: '2', mes: mm, anno: aa }, false);
  const filas = Array.isArray(j?.data) ? j.data : [];
  const errores = j?.metaData?.errors;
  anotar(`S3 F29 ${aa}-${mm}: ${filas.map((f) => `folio=${f.folio} estado="${f.estado}" fecha=${f.declFechaCreacion} codigo=${f.codigo}`).join(' | ') || 'sin declaraciones'}${errores ? ` errores=${JSON.stringify(errores)}` : ''}`);
  if (filas[0] && !ultimo) anotar(`    campos estado: ${Object.keys(filas[0]).join(',')}`);
  const presentada = filas.find((f) => Number(f.folio) > 0);
  if (!ultimo && presentada) ultimo = { ...presentada, periodo: `${aa}-${mm}` };
}

// --- S2: PDF compacto del último F29 presentado ----------------------------------------
if (ultimo) {
  const q = new URLSearchParams({ folio: String(ultimo.folio), rut: cuerpo, form: '029', codInt: String(ultimo.codigo) });
  const r = await pedir(`https://www4.sii.cl/rfiInternet/formCompacto?${q}`, { headers: { Referer: F29_REF, Accept: 'application/pdf,*/*' } });
  const esPdf = new TextDecoder('latin1').decode(r.buf.slice(0, 5)) === '%PDF-';
  if (esPdf) guardar(`f29-${ultimo.periodo}-compacto.pdf`, r.buf);
  else guardar(`f29-${ultimo.periodo}-compacto.txt`, r.texto);
  anotar(`S2 F29 compacto ${ultimo.periodo} folio ${ultimo.folio}: ${esPdf ? `PDF ${r.buf.length} bytes` : `NO es PDF (content-type ${r.ct}, url ${r.url})`}`);
} else {
  anotar('S2 F29 compacto: no hay F29 presentado en los últimos 12 meses');
}

try {
  await pedir(LOGOUT);
} catch {
  /* best-effort */
}
guardar('resumen.txt', resumen.join('\n'));
console.log(`\nListo. Revisa ${join(dir, 'resumen.txt')} (no lo subas a git: tiene datos reales).`);
