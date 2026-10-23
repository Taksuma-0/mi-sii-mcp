/** Sólo recibe valores controlados por el servidor, nunca datos del SII. */
export function paginaLocal(token: string, nonce: string, mes: string): string {
  return `<!doctype html>
<html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="csrf-token" content="@@TOKEN@@"><title>impuestocl · Verificar IVA</title>
<style nonce="@@NONCE@@">
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#183047;background:#f3f6fa;font-synthesis:none}*{box-sizing:border-box}body{margin:0;padding:40px 20px}main{max-width:720px;margin:0 auto}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}.marca{font-size:22px;font-weight:750;letter-spacing:-.7px}.marca span{color:#087d77}.local{font-size:12px;font-weight:650;color:#16645e;background:#e2f3ec;border:1px solid #c3e4d6;border-radius:20px;padding:5px 11px}.tarjeta{background:#fff;border:1px solid #dce3ed;border-radius:18px;padding:30px;box-shadow:0 6px 24px #173b5910}h1{font-size:28px;line-height:1.2;letter-spacing:-.6px;margin:0 0 12px}p{font-size:15px;line-height:1.6;color:#526278;margin:0 0 22px}label{display:block;font-size:14px;font-weight:650;margin:0 0 8px}input{display:block;width:100%;height:46px;padding:10px 12px;border:1px solid #b8c5d4;border-radius:8px;background:#fff;color:#183047;font:inherit}input:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #7cb6fb;outline-offset:3px}.campo{margin:0 0 20px}.ayuda{display:block;font-size:12px;line-height:1.5;color:#596b80;margin-top:6px}.fila{display:grid;grid-template-columns:1fr 1fr;gap:20px}button{font:inherit;font-weight:650;cursor:pointer;border:0;border-radius:8px;padding:13px 18px}.principal{width:100%;background:#1764b6;color:#fff}.principal:hover{background:#125396}button:disabled,input:disabled{opacity:.6;cursor:wait}.privacidad{margin:18px 0 0;font-size:12px;line-height:1.6}.pie{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:18px}.pie p{margin:0;font-size:12px}.secundario{background:transparent;color:#3e5672;font-size:13px;padding:9px 0;white-space:nowrap}#estado{font-size:14px;line-height:1.6;margin:20px 0 0;min-height:24px;color:#185d9d}#estado[data-tipo="error"]{color:#a12627}#estado[data-tipo="parcial"]{color:#85520a}#resultado{margin-top:22px}#resultado h2{font-size:20px;margin:0 0 18px}#resultado h3{font-size:14px;margin:22px 0 8px}pre{font:13px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;color:#32475f}details{border-top:1px solid #e1e7ef;margin-top:22px;padding-top:18px}summary{cursor:pointer;font-size:14px;font-weight:650}details pre{margin-top:12px}[hidden]{display:none!important}@media(max-width:520px){body{padding:24px 14px}.tarjeta{padding:23px 20px}.fila{grid-template-columns:1fr;gap:0}h1{font-size:25px}.pie{align-items:flex-start}}
</style></head><body><main><header><div class="marca">impuesto<span>cl</span></div><span class="local">● Local</span></header>
<section class="tarjeta" aria-labelledby="titulo"><h1 id="titulo">Revisa tu IVA mensual</h1><p>Conecta con el SII para consultar tus registros y compararlos con tu F29. Elige un mes ya declarado que conozcas.</p>
<form id="formulario" method="post" action="/verificar" autocomplete="off"><div class="campo"><label for="rut">RUT del contribuyente</label><input id="rut" name="rut" type="text" placeholder="22.222.222-2" required maxlength="20" spellcheck="false" autocapitalize="characters" aria-describedby="ayuda-rut"><span class="ayuda" id="ayuda-rut">Puedes ingresarlo con o sin puntos.</span></div>
<div class="fila"><div class="campo"><label for="clave">Clave tributaria</label><input id="clave" name="clave" type="password" required autocomplete="off"></div><div class="campo"><label for="mes">Mes a verificar</label><input id="mes" name="mes" type="month" value="@@MES@@" min="2000-02" max="2100-12" required></div></div>
<button id="enviar" class="principal" type="submit">Conectar y verificar</button></form>
<p class="privacidad">Tu clave se envía al SII para iniciar sesión y esta interfaz no la guarda. Los datos consultados y las cookies de sesión pueden permanecer en el almacenamiento local de impuestocl.</p>
<div id="estado" role="status" aria-live="polite" aria-atomic="true"></div>
<noscript><p>Activa JavaScript en tu navegador para usar esta interfaz local.</p></noscript></section>
<section id="resultado" class="tarjeta" aria-labelledby="titulo-resultado" hidden><h2 id="titulo-resultado"></h2><h3>Sincronización</h3><pre id="sincronizacion"></pre><h3>Resumen de IVA</h3><pre id="resumen"></pre><h3>Plazos</h3><pre id="plazos"></pre><details id="detalle-codigos" hidden><summary>Códigos del F29</summary><pre id="codigos"></pre></details></section>
<footer class="pie"><p>En tu equipo. Sin servicios externos de esta interfaz.</p><button id="cerrar" type="button" class="secundario">Cerrar aplicación</button></footer></main>
<script nonce="@@NONCE@@">
const $ = (id) => document.getElementById(id);
const formulario = $('formulario');
const clave = $('clave');
const estado = $('estado');
const token = document.querySelector('meta[name="csrf-token"]').content;
let ocupado = false;
function informar(texto, tipo = '') { estado.textContent = texto; estado.dataset.tipo = tipo; }
function bloquear(valor) { ocupado = valor; formulario.querySelectorAll('input,button').forEach((control) => { control.disabled = valor; }); $('cerrar').disabled = valor; formulario.setAttribute('aria-busy', String(valor)); }
async function enviar(ruta, datos) {
  const respuesta = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(datos), cache: 'no-store', credentials: 'omit' });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.mensaje || 'No se pudo completar la consulta.');
  return resultado;
}
formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (ocupado) return;
  let datos = { rut: $('rut').value, clave: clave.value, mes: $('mes').value };
  clave.value = '';
  bloquear(true); $('resultado').hidden = true; informar('Verificando… La consulta puede tardar unos minutos.');
  try {
    const pendiente = enviar('/verificar', datos); datos = null;
    const resultado = await pendiente;
    $('titulo-resultado').textContent = resultado.estado === 'parcial' ? 'Resultado parcial' : 'Consulta completada';
    for (const campo of ['sincronizacion', 'resumen', 'plazos']) $(campo).textContent = resultado[campo];
    $('detalle-codigos').hidden = resultado.codigosF29 === null;
    $('codigos').textContent = resultado.codigosF29 === null ? '' : JSON.stringify(resultado.codigosF29, null, 2);
    $('resultado').hidden = false;
    informar(resultado.estado === 'parcial' ? 'Hay datos incompletos. Revisa la sincronización antes de interpretar el resumen.' : 'Consulta completada. Revisa el resumen y sus avisos.', resultado.estado);
  } catch (error) {
    informar(error instanceof TypeError ? 'Se perdió la conexión local. Vuelve a abrir «Abrir impuestocl».' : error.message, 'error');
  } finally { datos = null; clave.value = ''; bloquear(false); }
});
$('cerrar').addEventListener('click', async () => {
  if (ocupado) return;
  bloquear(true);
  try { await enviar('/cerrar', {}); informar('Aplicación cerrada. Puedes cerrar esta pestaña.'); }
  catch (error) { informar(error instanceof TypeError ? 'La aplicación ya no responde. Vuelve a abrir «Abrir impuestocl».' : error.message, 'error'); bloquear(false); }
});
</script></body></html>`.replaceAll('@@TOKEN@@', token).replaceAll('@@NONCE@@', nonce).replaceAll('@@MES@@', mes);
}
