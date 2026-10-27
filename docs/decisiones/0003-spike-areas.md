# 0003 — Prueba de lectura de áreas nuevas del SII

Fecha: 27 de octubre de 2026. Sesión: la guardada de la empresa del usuario (clave tributaria). Solo consultas de lectura, ritmo de 1,5 s, ~20 consultas. Las respuestas crudas quedaron fuera del repositorio (`%TEMP%\mi-sii-mcp-spike-20261027\`). Aquí solo hay estructura: sin RUT, nombres, montos, folios ni direcciones.

## Mi SII (`misiir.sii.cl/cgi_misii/siihome.cgi`, `DatosCntrNow`)
- Raíz: `contribuyente`, `direcciones[]`, `atributos[]`, `alertas[]`, más `codigoError`, `descripcionError`, `sysdate`.
- `contribuyente.autorizadoDeclararDia20` existe y vale `"S"`/`"N"` (aquí `"S"`).
- Campos tributarios útiles: `tipoContribuyenteCodigo/Descripcion`, `subtipoContribuyenteCodigo/Descrip`, `segmentoCodigo/Descripcion`, `glosaActividad`, `fechaInicioActividades`, `fechaTerminoGiro`, `personaEmpresa`.
- `atributos[]`: `{atrCodigo, descAtrCodigo, valor, fechaInicio, fechaTermino, …}`. Códigos vistos: `14TT` (régimen Pro Pyme transparente 14D N°8), `EMTP` (tamaño de empresa), `FPYM` (facturador electrónico MIPYME), `NOTI` (notificación por correo; **su valor es un correo: dato personal, no se guarda**), `REGS` (registro de sociedades), `SGMI` (segmento).
- Datos personales que nunca se guardan: nombres, apellidos, e-mail, teléfonos, pasaporte, fechas de nacimiento, `direcciones[]` completo, `valor` de `NOTI`.

## Empresas autorizadas (`getDcvEmpresasAutorizadas`)
- Funciona con `page: null`, `data: {}`. Respuesta `{metaData, data[], rutAutenticado, dvAutenticado, respEstado}`; `respEstado.codRespuesta = 0`.
- Filas `{usrEmpRut, usrEmpDv, usrUsuarioRut, usrUsuarioDv, usrPrivilegios, usrFechaDesautorizacion, empFechaDesautorizacion, usrEmpRutDv, razonSocONombreEmp}`. Con la sesión de la empresa vino 1 fila (la propia). La representación queda para el Grupo 3.

## Propuesta F29 (`propuestaf29ui … getDeclaracionConCondicionesYTipoPropuesta`)
- Responde con TOKEN; `data` con `tipopropuesta`, `tipopropuestadescrip`, `listCondiciones`, `listCodPropuestos[] {codigo, valor}`, `listGlosasProp`, `listCodBase[] {codigo, valor}` (**datos de identificación: no se guarda**), `listCodAdministrativos[] {codigo, valor}`, `estado`, `descripcionEstado`, `resultadoCalculoPP29 {estado, glosaError, traza}` (**traza: no se guarda**), `anotacion`, `tieneAnotaciones`, y otros (`documentosDelGiro`, `ppmo`, `vectores`, `actividadesEco`, …).
- Meses con propuesta (tipo 40): `listCodPropuestos` trae **511, 520, 519, 504, 151** (crédito de documentos, remanente y retención), con `valor` numérico en texto. **No trae 538, 537 ni 91**, así que no sirve para saber si el F29 llevará pago. `listCodAdministrativos`: 9114, 9132, 9137, 9186.
- Meses recientes sin propuesta: `tipopropuesta` 48, `resultadoCalculoPP29.estado` 5, listas vacías (sin error).

## Boletas de honorarios recibidas (`loa.sii.cl/cgi_IMT/TMBCOC_InformeMensualBheRec.cgi`)
- GET con las cookies de la sesión; `text/html` sin charset en el encabezado; `<meta charset=iso-8859-1>`.
- Filas: `arr_informe_mensual['<campo>_<n>'] = …;` con los 13 campos `nroboleta, rutemisor, dvemisor, nombre_emisor, fecha_boleta (DD/MM/AAAA), totalhonorarios, honorariosliquidos, es_soc_profesional (SI/NO), cod_comuna, retencion_receptor, estado (N vigente / S anulada), fechaanulacion, codigobarras`. Montos como `formatMiles("12345",'.')`.
- Totales y paginación en `xml_values['…']`: `anio_consulta, mes_consulta, porcentaje_retencion, cant_boletas, total_boletas, pagina_solicitada, pagina_sig_codigo, pagina_med_codigo, pagina_ant_codigo, pagina_actual, pagina_lista, suma_honorarios, suma_retencion_receptor, suma_liquido, suma_retencion_emisor` (las sumas sin comillas).
- Con pocos documentos, pedir `pagina_solicitada=1` devolvió exactamente la misma página: hay que deduplicar y parar al alcanzar `total_boletas`.
- Informe anual (`TMBCOC_InformeAnualBheRec.cgi`): sin `arr_informe_mensual`; claves `ene1…dic7`, `sum<mes>`, `sumtot` en `xml_values`. No se usa por ahora.

## F22 (`consultaestadof22ui/services/data/facadeService/<op>`)
- Las 4 operaciones responden con TOKEN: `{data, respCod, errorMsg, metaData}`.
- `buscaDeclVgte`: `data.decls[]` con muchos campos (incluye **datos personales y bancarios: nombres, apellidos, calle, comuna, cuenta, banco** → solo se guarda una lista permitida: `folio, tipoIng, fecIng, codConc, vgte, tipoImpugnado, remanenteSolicitado, remanenteDevuelto, impuestoPagado, montoGiro, fechaVencimiento, …` sin cuenta ni banco), y `data.glosas[] {codConclusion, descripcion}`. `vgte` vino como `"1"` en AT2026 y AT2025.
- `f22Compacto`: `data[] {codigo, valor, glosa}` (38–40 filas). Códigos con valor no numérico y/o de identificación: **1, 6, 8, 13, 55, 301, 780, 903, 8811** (nombre, domicilio, comuna, giro, correo, banco, tipo de cuenta, RUT representante, moneda) → no se guardan; 15 y 315 son fechas; 39, 85, 86, 87, 90, 92, 93, 94 pueden venir vacíos o con formato (se guardan como número o null).
- `situacionObservacion`: `data[]` (vacío en ambos años; sin observaciones).
- `buscaEventos`: `data[] {folio, codEvento, nombre, fechaEvento, codCarta, idCarta, codigo, tipoEvento, referencia, evigCodigo, fechaCitacion, unidadSii}` (2 eventos por año).

## Consecuencias para el plan
- T13 propuesta: se implementa para mostrar crédito, remanente y retención propuestos (sin 91). IVA-04 se gradúa sin la propuesta: con monto desconocido, advertencia entre el día de pago y el 28; crítico después del 28.
- T14/T15 boletas: habilitadas; deduplicar páginas.
- T16 perfil: `autorizadoDeclararDia20` confirmado; atributos por código con valores solo de la lista permitida (nunca `NOTI`).
- T17: la empresa está autorizada al día 20.
- T18/T19 F22: habilitadas, con lista permitida de campos y lista de códigos excluidos.
