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
  informar(error instanceof TypeError ? 'Se perdió la conexión local. Vuelve a abrir «Abrir impuestocl.cmd».' : error instanceof ErrorPublico ? error.message : 'No se pudo completar la consulta. Vuelve a abrir «Abrir impuestocl.cmd» si el problema continúa.', 'error');
}
function limpiarDocumentos() {
  paginaDocumentos = null; filtroDocumentos = null;
  $('resultado-documentos').replaceChildren(); $('documentos-pagina').textContent = ''; paginacion();
}
function limpiarConsultas() {
  $('resultado-sync').replaceChildren(); $('resultado-analisis').replaceChildren(); limpiarDocumentos();
}
function limpiarEspacio() {
  contexto = null;
  $('espacio').hidden = true; $('acceso').hidden = false;
  $('identidad').textContent = ''; $('totales').replaceChildren(); $('filas-panorama').replaceChildren();
  limpiarConsultas();
  for (const id of ['formulario', 'form-historial', 'form-analisis', 'form-documentos']) {
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
function rango(prefijo) { return { desde: $(prefijo + '-desde').value, hasta: $(prefijo + '-hasta').value }; }
function validarRango(r) {
  if (r.desde > r.hasta) throw new ErrorPublico('El mes inicial debe ser anterior o igual al final.');
  const numero = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5));
  if (numero(r.hasta) - numero(r.desde) >= 120) throw new ErrorPublico('Elige un rango de hasta 120 meses.');
}
$('formulario').addEventListener('submit', async (evento) => {
  evento.preventDefault(); if (ocupado) return;
  let datos = { rut: $('rut').value, clave: clave.value };
  clave.value = ''; contexto = null; limpiarConsultas(); bloquear(true); informar('Conectando con el SII…');
  try {
    const pendiente = enviar('/conectar', datos); datos = null;
    const r = await pendiente;
    mostrarPanorama(r.panorama); contexto = r.contexto; sugerirFechas();
    $('acceso').hidden = true; $('espacio').hidden = false;
    informar('Conectado. Revisa los datos locales o elige un historial para cargar.');
  } catch (error) { limpiarEspacio(); fallo(error); }
  finally { datos = null; clave.value = ''; bloquear(false); }
});
$('entrar-navegador').addEventListener('click', async () => {
  if (ocupado) return;
  const rut = $('rut').value.trim();
  clave.value = ''; contexto = null; limpiarConsultas(); bloquear(true); informar('Entra en la ventana del SII que se abrió (hasta 10 minutos).');
  try {
    const r = await enviar('/conectar-navegador', rut ? { rut } : {});
    mostrarPanorama(r.panorama); contexto = r.contexto; sugerirFechas();
    $('acceso').hidden = true; $('espacio').hidden = false; informar('Conectado. Esta sesión no se renueva sola.');
  } catch (error) { limpiarEspacio(); fallo(error); }
  finally { bloquear(false); }
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
$('cambiar').addEventListener('click', async () => {
  if (ocupado || !contexto) return;
  const anterior = contexto;
  limpiarEspacio(); bloquear(true); informar('Desconectando el espacio anterior…');
  try { await enviar('/desconectar', { contexto: anterior }); informar('Espacio desconectado. Ingresa el contribuyente que quieras consultar.'); }
  catch (error) { fallo(error); }
  finally { bloquear(false); $('rut').focus(); }
});
$('cerrar').addEventListener('click', async () => {
  if (ocupado) return;
  limpiarEspacio(); bloquear(true); informar('Cerrando aplicación…');
  try { await enviar('/cerrar', {}); informar('Aplicación cerrada. Puedes cerrar esta pestaña.'); }
  catch (error) { fallo(error); bloquear(false); }
});
`.replace(/^ +/gm, '');
