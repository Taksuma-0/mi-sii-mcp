/** JavaScript autónomo del navegador; sin estado persistente ni dependencias. */
export const scriptLocal = String.raw`
'use strict';
const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="csrf-token"]').content;
const clave = $('clave');
const mesSugerido = $('historial-hasta').value;
const moneda = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const dinero = (n) => n === null || n === undefined ? 'Sin datos' : moneda.format(n);
let contexto = null;
let ocupado = false;
let paginaDocumentos = null;
let filtroDocumentos = null;
let panoramaListo = null;
function nodo(tipo, texto, clase) {
  const e = document.createElement(tipo);
  if (texto !== undefined) e.textContent = texto;
  if (clase) e.className = clase;
  return e;
}
function informar(texto, tipo = '') { $('estado').textContent = texto; $('estado').dataset.tipo = tipo; }
function paginacion() {
  $('documentos-anterior').disabled = ocupado || !paginaDocumentos || paginaDocumentos.pagina <= 1;
  $('documentos-siguiente').disabled = ocupado || !paginaDocumentos || paginaDocumentos.pagina * paginaDocumentos.tamano >= paginaDocumentos.total;
}
function bloquear(valor) {
  ocupado = valor;
  document.querySelectorAll('input,select,button').forEach((c) => { c.disabled = valor; });
  document.querySelector('main').setAttribute('aria-busy', String(valor));
  paginacion();
}
class ErrorPublico extends Error {}
async function enviar(ruta, datos) {
  const respuesta = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(datos), cache: 'no-store', credentials: 'omit' });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new ErrorPublico(resultado.mensaje || 'No se pudo completar la consulta.');
  return resultado;
}
function fallo(error) {
  informar(error instanceof TypeError ? 'Se perdió la conexión local. Vuelve a abrir «Abrir mi-sii-mcp.cmd».' : error instanceof ErrorPublico ? error.message : 'No se pudo completar la consulta. Vuelve a abrir «Abrir mi-sii-mcp.cmd» si el problema continúa.', 'error');
}
function limpiarDocumentos() {
  paginaDocumentos = null; filtroDocumentos = null;
  $('resultado-documentos').replaceChildren(); $('documentos-pagina').textContent = ''; paginacion();
}
function limpiarConsultas() {
  $('resultado-sync').replaceChildren(); $('resultado-analisis').replaceChildren(); $('resultado-cartola').replaceChildren(); limpiarDocumentos();
}
function limpiarEspacio() {
  contexto = null; panoramaListo = null;
  $('espacio').hidden = true; $('listo').hidden = true; $('acceso').hidden = false;
  $('identidad').textContent = ''; $('totales').replaceChildren(); $('filas-panorama').replaceChildren();
  limpiarConsultas();
  for (const id of ['formulario', 'form-historial', 'form-analisis', 'form-documentos', 'form-cartola']) {
    $(id).reset();
    $(id).querySelectorAll('input').forEach((c) => { c.value = ''; });
  }
  $('vacio').hidden = true; $('tabla-panorama').hidden = true;
}
function sugerirFechas() {
  const enero = mesSugerido.slice(0, 4) + '-01';
  $('historial-desde').value = enero; $('historial-hasta').value = mesSugerido;
  $('analisis-desde').value = enero; $('analisis-hasta').value = mesSugerido;
  $('documentos-periodo').value = mesSugerido;
}
function fecha(valor) {
  if (!valor) return 'Sin consultar';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? valor : d.toLocaleString('es-CL', { timeZone: 'America/Santiago' });
}
function cobertura(d) { return 'Ventas: ' + (d.ventasRcv ? 'Disponible' : 'Sin consultar') + ' · Compras: ' + (d.comprasRcv ? 'Disponible' : 'Sin consultar') + ' · F29: ' + (d.f29 ? 'Consultado' : 'Sin consultar'); }
function frescura(f) { return 'RCV: ' + fecha(f.rcv) + ' · F29: ' + fecha(f.f29); }
function estadoF29(f) { return !f.consultado ? 'Sin consultar' : !f.presentado ? 'Sin presentación' : 'Folio ' + f.folio + ' · ' + f.estado; }
function celda(fila, texto, detalle) {
  const c = nodo('td', texto);
  if (detalle !== undefined) c.append(nodo('small', detalle));
  fila.append(c);
}
function mostrarPanorama(p) {
  $('identidad').textContent = (p.perfil.razonSocial || p.perfil.alias || 'Contribuyente') + ' · RUT ' + p.perfil.rut;
  $('totales').replaceChildren(); $('filas-panorama').replaceChildren();
  const metricas = [['ventas', 'Ventas RCV'], ['compras', 'Compras RCV'], ['ivaDebito', 'IVA débito RCV'], ['ivaCredito', 'IVA crédito RCV'], ['f29', 'Total declarado en F29']];
  for (const [campo, etiqueta] of metricas) {
    const t = p.totales[campo], tarjeta = nodo('div', undefined, 'metrica');
    tarjeta.append(nodo('h3', etiqueta), nodo('strong', dinero(t.monto)), nodo('small', t.mesesConDatos + ' meses con importe · ' + t.mesesSinDatos + ' sin datos'));
    $('totales').append(tarjeta);
  }
  for (const mes of p.periodos) {
    const fila = nodo('tr');
    celda(fila, mes.periodo);
    celda(fila, dinero(mes.ventas), 'IVA débito: ' + dinero(mes.ivaDebito));
    celda(fila, dinero(mes.compras), 'IVA crédito: ' + dinero(mes.ivaCredito));
    celda(fila, estadoF29(mes.f29), 'Total declarado: ' + dinero(mes.f29.totalAPagar));
    const c = nodo('td');
    c.append(nodo('div', 'Ventas: ' + (mes.disponibilidad.ventasRcv ? 'Disponible' : 'Sin consultar')), nodo('div', 'Compras: ' + (mes.disponibilidad.comprasRcv ? 'Disponible' : 'Sin consultar')), nodo('div', 'F29: ' + (mes.disponibilidad.f29 ? 'Consultado' : 'Sin consultar')));
    fila.append(c);
    celda(fila, 'RCV: ' + fecha(mes.frescura.rcv), 'F29: ' + fecha(mes.frescura.f29));
    $('filas-panorama').append(fila);
  }
  $('vacio').hidden = p.periodos.length !== 0;
  $('tabla-panorama').hidden = p.periodos.length === 0;
}
/** Pone puntos y guion mientras se escribe: la K solo vale como dígito verificador. */
function formatearRut(texto) {
  const limpio = texto.replace(/[^0-9kK]/g, '').toUpperCase().replace(/K(?=.)/g, '').slice(0, 9);
  if (limpio.length < 2) return limpio;
  return limpio.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + limpio.slice(-1);
}
$('rut').addEventListener('input', () => {
  const campo = $('rut'), significativos = (t) => t.replace(/[^0-9kK]/g, '').length;
  const antes = significativos(campo.value.slice(0, campo.selectionStart ?? campo.value.length));
  campo.value = formatearRut(campo.value);
  let pos = 0;
  for (let vistos = 0; pos < campo.value.length && vistos < antes; pos++) if (/[0-9K]/.test(campo.value[pos])) vistos++;
  campo.setSelectionRange(pos, pos);
});
function estadoCuenta(c) {
  if (c.bloqueada) return ['error', 'El SII rechazó la clave: vuelve a conectar'];
  if (!c.conectada) return ['error', 'Sin sesión: vuelve a conectar'];
  return c.renuevaSola ? ['ok', 'Conectada · se mantiene sola'] : ['', 'Conectada · cuando venza, vuelve a conectar'];
}
async function cargarCuentas() {
  try {
    const r = await enviar('/cuentas', {});
    $('cuentas').replaceChildren();
    for (const c of r.cuentas) {
      const [tipo, texto] = estadoCuenta(c), li = nodo('li'), info = nodo('div'), boton = nodo('button', 'Usar este RUT', 'secundario');
      li.dataset.tipo = tipo; boton.type = 'button';
      boton.addEventListener('click', () => { $('rut').value = formatearRut(c.rut); clave.focus(); });
      info.append(nodo('strong', c.nombre), nodo('small', 'RUT ' + formatearRut(c.rut) + ' · ' + texto));
      li.append(info, boton); $('cuentas').append(li);
    }
    $('bloque-cuentas').hidden = r.cuentas.length === 0;
  } catch { $('bloque-cuentas').hidden = true; }
}
function mostrarListo(r, sesion) {
  const p = r.panorama;
  contexto = r.contexto; panoramaListo = p;
  $('listo-identidad').textContent = (p.perfil.razonSocial || p.perfil.alias || 'Contribuyente') + ' · RUT ' + p.perfil.rut;
  $('listo-sesion').textContent = sesion;
  $('acceso').hidden = true; $('espacio').hidden = true; $('listo').hidden = false;
  informar('');
}
function rango(prefijo) { return { desde: $(prefijo + '-desde').value, hasta: $(prefijo + '-hasta').value }; }
function validarRango(r) {
  if (r.desde > r.hasta) throw new ErrorPublico('El mes inicial debe ser anterior o igual al final.');
  const numero = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5));
  if (numero(r.hasta) - numero(r.desde) >= 120) throw new ErrorPublico('Elige un rango de hasta 120 meses.');
}
$('formulario').addEventListener('submit', async (evento) => {
  evento.preventDefault(); if (ocupado) return;
  let datos = { rut: $('rut').value, clave: clave.value, recordar: $('recordar').checked };
  clave.value = ''; contexto = null; limpiarConsultas(); bloquear(true); informar('Conectando con el SII…');
  try {
    const pendiente = enviar('/conectar', datos); datos = null;
    const r = await pendiente;
    mostrarListo(r, r.recordada ? 'La sesión se mantiene sola: no tendrás que volver a conectar esta cuenta.' : 'La clave no quedó guardada: cuando la sesión venza, vuelve a conectar aquí.');
  } catch (error) { limpiarEspacio(); fallo(error); }
  finally { datos = null; clave.value = ''; await cargarCuentas(); bloquear(false); }
});
$('entrar-navegador').addEventListener('click', async () => {
  if (ocupado) return;
  const rut = $('rut').value.trim();
  clave.value = ''; contexto = null; limpiarConsultas(); bloquear(true); informar('Entra en la ventana del SII que se abrió (hasta ' + document.querySelector('meta[name="plazo-navegador"]').content + ' minutos).');
  try {
    const r = await enviar('/conectar-navegador', rut ? { rut } : {});
    mostrarListo(r, 'Esta sesión no se renueva sola: cuando venza, vuelve a entrar aquí.');
  } catch (error) { limpiarEspacio(); fallo(error); }
  finally { await cargarCuentas(); bloquear(false); }
});
$('ver-datos').addEventListener('click', () => {
  if (ocupado || !contexto || !panoramaListo) return;
  mostrarPanorama(panoramaListo); sugerirFechas();
  $('listo').hidden = true; $('espacio').hidden = false;
  informar('Revisa los datos guardados o elige un historial para cargar.');
});
$('otra-cuenta').addEventListener('click', async () => {
  if (ocupado) return;
  const anterior = contexto;
  limpiarEspacio(); informar('');
  if (anterior) { bloquear(true); try { await enviar('/desconectar', { contexto: anterior }); } catch (error) { fallo(error); } finally { bloquear(false); } }
  $('rut').focus();
});
$('form-historial').addEventListener('submit', async (evento) => {
  evento.preventDefault(); if (ocupado || !contexto) return;
  const r = rango('historial'), fuente = $('historial-fuentes').value;
  limpiarConsultas(); bloquear(true); informar('Cargando historial… La consulta puede tardar varios minutos.');
  try {
    validarRango(r);
    const resultado = await enviar('/sincronizar', { contexto, ...r, superficies: fuente === 'ambas' ? ['rcv', 'f29'] : [fuente] });
    mostrarPanorama(resultado.panorama);
    const parcial = resultado.estado === 'parcial';
    $('resultado-sync').append(nodo('h3', (parcial ? 'Carga parcial' : 'Carga completada') + ' · ' + r.desde + ' a ' + r.hasta), nodo('p', 'Fuentes solicitadas: ' + (fuente === 'ambas' ? 'RCV y F29' : fuente.toUpperCase())), nodo('pre', resultado.sincronizacion));
    informar(parcial ? 'Carga parcial: faltan datos o hay avisos. Revisa el detalle y la cobertura por fuente.' : 'Carga completada para las fuentes y el rango solicitados. Revisa la cobertura local.', resultado.estado);
  } catch (error) { $('resultado-sync').replaceChildren(); fallo(error); }
  finally { bloquear(false); }
});
function mostrarAnalisis(resumenes, r) {
  const destino = $('resultado-analisis');
  destino.append(nodo('h3', 'Cruce local · ' + r.desde + ' a ' + r.hasta));
  if (!resumenes.length) destino.append(nodo('p', 'Sin resultados para este rango.'));
  for (const mes of resumenes) {
    const a = nodo('article'), f = mes.f29;
    a.append(nodo('h3', mes.periodo), nodo('p', cobertura(mes.disponibilidad)), nodo('p', frescura(mes.frescura), 'nota'), nodo('p', 'F29: ' + (!mes.disponibilidad.f29 ? 'Sin consultar' : !f ? 'Sin presentación' : 'Folio ' + f.folio + ' · ' + f.estado + ' · Presentado: ' + (f.fechaPresentacion || 'Sin fecha'))), nodo('p', 'Total declarado en F29: ' + dinero(f?.totalAPagar)));
    const c = mes.comparaciones;
    a.append(nodo('p', 'Débito RCV: ' + dinero(c.debitoRcv) + ' · Débito F29: ' + dinero(c.debitoF29)), nodo('p', 'Crédito RCV: ' + dinero(c.creditoRcv) + ' · Crédito F29: ' + dinero(c.creditoF29)), nodo('p', 'Remanente anterior [77]: ' + dinero(c.remanenteAnterior77) + ' · Remanente actual [504]: ' + dinero(c.remanenteActual504)));
    if (!mes.hallazgos.length) a.append(nodo('p', 'Sin hallazgos en los datos disponibles. Esto no confirma que las fuentes estén completas.'));
    const lista = nodo('ul');
    for (const h of mes.hallazgos) {
      const li = nodo('li'); li.append(nodo('strong', h.titulo + ' · ' + h.severidad), nodo('p', h.detalle));
      if (h.montos) li.append(nodo('p', 'Esperado: ' + dinero(h.montos.esperado) + ' · Declarado: ' + dinero(h.montos.declarado) + ' · Diferencia: ' + dinero(h.montos.diferencia)));
      for (const evidencia of h.evidencia) li.append(nodo('p', evidencia, 'nota'));
      lista.append(li);
    }
    a.append(lista); destino.append(a);
  }
}
$('form-analisis').addEventListener('submit', async (evento) => {
  evento.preventDefault(); if (ocupado || !contexto) return;
  const r = rango('analisis'); $('resultado-analisis').replaceChildren(); bloquear(true); informar('Analizando los datos locales…');
  try { validarRango(r); mostrarAnalisis(await enviar('/analizar', { contexto, ...r }), r); informar('Cruce local disponible. Revisa la cobertura y los avisos de cada mes.'); }
  catch (error) { $('resultado-analisis').replaceChildren(); fallo(error); }
  finally { bloquear(false); }
});
function leerFiltrosDocumentos() {
  const lado = $('documentos-lado').value, estado = $('documentos-estado').value;
  return { periodo: $('documentos-periodo').value, ...(lado ? { lado } : {}), ...(estado ? { estado } : {}) };
}
async function consultarDocumentos(filtro, pagina) {
  if (ocupado || !contexto) return;
  limpiarDocumentos(); bloquear(true); informar('Consultando documentos locales…');
  try {
    const r = await enviar('/documentos', { contexto, ...filtro, pagina });
    const destino = $('resultado-documentos');
    destino.append(nodo('h3', filtro.periodo + ' · ' + (filtro.lado || 'Compras y ventas') + ' · ' + (filtro.estado || 'Todos los estados')));
    if (!r.documentos.length) destino.append(nodo('p', 'Sin documentos guardados para estos filtros. Esto no confirma ausencia de movimientos en el SII.'));
    else {
      const contenedor = nodo('div', undefined, 'tabla'), tabla = nodo('table'), cabecera = nodo('thead'), fila = nodo('tr'), cuerpo = nodo('tbody');
      for (const titulo of ['Razón social / RUT', 'Registro / estado', 'Tipo / folio', 'Fecha emisión', 'Neto', 'IVA', 'Total']) { const th = nodo('th', titulo); th.scope = 'col'; fila.append(th); }
      cabecera.append(fila); tabla.append(cabecera, cuerpo);
      for (const d of r.documentos) {
        const f = nodo('tr');
        celda(f, d.razonSocial || 'Sin razón social', d.rutContraparte); celda(f, d.lado, d.estado); celda(f, 'Tipo ' + d.tipoDoc, 'Folio ' + d.folio); celda(f, d.fechaEmision || 'Sin fecha');
        celda(f, dinero(d.montoNeto)); celda(f, dinero(d.montoIva)); celda(f, dinero(d.montoTotal)); cuerpo.append(f);
      }
      contenedor.append(tabla); destino.append(contenedor);
    }
    paginaDocumentos = { pagina: r.pagina, tamano: r.tamano, total: r.total }; filtroDocumentos = filtro;
    $('documentos-pagina').textContent = r.total + ' documentos · Página ' + r.pagina + ' de ' + Math.max(1, Math.ceil(r.total / r.tamano));
    informar('Documentos locales disponibles para los filtros indicados.');
  } catch (error) { limpiarDocumentos(); fallo(error); }
  finally { bloquear(false); }
}
$('form-documentos').addEventListener('submit', (evento) => { evento.preventDefault(); if (!ocupado) void consultarDocumentos(leerFiltrosDocumentos(), 1); });
for (const evento of ['input', 'change']) $('form-documentos').addEventListener(evento, () => { if (!ocupado) limpiarDocumentos(); });
$('documentos-anterior').addEventListener('click', () => { if (!ocupado && filtroDocumentos && paginaDocumentos && paginaDocumentos.pagina > 1) void consultarDocumentos(filtroDocumentos, paginaDocumentos.pagina - 1); });
$('documentos-siguiente').addEventListener('click', () => { if (!ocupado && filtroDocumentos && paginaDocumentos && paginaDocumentos.pagina * paginaDocumentos.tamano < paginaDocumentos.total) void consultarDocumentos(filtroDocumentos, paginaDocumentos.pagina + 1); });
$('form-cartola').addEventListener('submit', async (evento) => {
  evento.preventDefault(); if (ocupado || !contexto) return;
  const archivo = $('cartola-archivo').files[0];
  if (!archivo) { informar('Elige el archivo de la cartola.', 'error'); return; }
  if (archivo.size > 5 * 1024 * 1024) { informar('La cartola pasa del máximo de 5 MB.', 'error'); return; }
  $('resultado-cartola').replaceChildren(); bloquear(true); informar('Importando la cartola…');
  try {
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    let binario = '';
    for (let i = 0; i < bytes.length; i += 32768) binario += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    const cuenta = $('cartola-cuenta').value.trim();
    const r = await enviar('/banco/importar', { contexto, nombre: archivo.name, contenido: btoa(binario), ...(cuenta ? { cuenta } : {}) });
    for (const linea of r.texto.split('\n')) $('resultado-cartola').append(nodo('p', linea));
    informar('Cartola importada en este equipo. Pide al asistente que la concilie con banco_conciliar.');
  } catch (error) { fallo(error); }
  finally { bloquear(false); }
});
$('cambiar').addEventListener('click', async () => {
  if (ocupado || !contexto) return;
  const anterior = contexto;
  limpiarEspacio(); bloquear(true); informar('Desconectando el espacio anterior…');
  try { await enviar('/desconectar', { contexto: anterior }); informar('Espacio desconectado. Ingresa el contribuyente que quieras consultar.'); }
  catch (error) { fallo(error); }
  finally { await cargarCuentas(); bloquear(false); $('rut').focus(); }
});
$('cerrar').addEventListener('click', async () => {
  if (ocupado) return;
  limpiarEspacio(); bloquear(true); informar('Cerrando aplicación…');
  try { await enviar('/cerrar', {}); informar('Aplicación cerrada. Puedes cerrar esta pestaña.'); }
  catch (error) { fallo(error); bloquear(false); }
});
const etiquetaSeveridad = { critico: 'CRÍTICO', advertencia: 'ADVERTENCIA', info: 'INFO' };
async function cargarAvisos() {
  try {
    const [lista, revision] = await Promise.all([enviar('/avisos', {}), enviar('/avisos/estado', {})]);
    $('avisos-activo').checked = revision.activa;
    if (revision.hora) $('avisos-hora').value = revision.hora;
    $('avisos-resumen').textContent = (revision.activa ? 'Revisión diaria activa a las ' + revision.hora + '. ' : 'Revisión diaria desactivada. ') + lista.sinVer + ' aviso(s) sin ver.';
    const destino = $('lista-avisos'); destino.replaceChildren();
    if (!lista.avisos.length) destino.append(nodo('li', 'Sin avisos por ahora.'));
    for (const a of lista.avisos) {
      const li = nodo('li'); li.append(nodo('strong', '[' + etiquetaSeveridad[a.severidad] + '] ' + a.titulo + (a.vistoEn ? '' : ' · nuevo')), nodo('p', a.detalle + ' (' + a.rut + ')', 'nota'));
      destino.append(li);
    }
  } catch (error) { fallo(error); }
}
async function cambiarRevision() {
  if (ocupado) return;
  bloquear(true); informar('Guardando la revisión diaria…');
  try {
    const r = $('avisos-activo').checked ? await enviar('/avisos/activar', { hora: $('avisos-hora').value }) : await enviar('/avisos/desactivar', {});
    informar(r.activa ? 'Revisión diaria activada a las ' + r.hora + '.' : 'Revisión diaria desactivada.');
  } catch (error) { $('avisos-activo').checked = !$('avisos-activo').checked; fallo(error); }
  finally { bloquear(false); await cargarAvisos(); }
}
$('avisos-activo').addEventListener('change', () => void cambiarRevision());
$('avisos-hora').addEventListener('change', () => { if ($('avisos-activo').checked) void cambiarRevision(); });
$('avisos-vistos').addEventListener('click', async () => {
  if (ocupado) return;
  bloquear(true);
  try { const r = await enviar('/avisos/vistos', {}); informar(r.marcados + ' aviso(s) marcados como vistos.'); }
  catch (error) { fallo(error); }
  finally { bloquear(false); await cargarAvisos(); }
});
void cargarCuentas();
void cargarAvisos();
`.replace(/^ +/gm, '');
