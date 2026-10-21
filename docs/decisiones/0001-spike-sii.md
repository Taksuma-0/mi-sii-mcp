# 0001 — Resultados de la spike en vivo del SII

Fecha: 2026-10-21 · Script: `scripts/spike-sii.mjs` (desechable)

Evidencia: una ejecución completada por el usuario, revisada con su autorización.
Este registro conserva únicamente códigos, estados y nombres de campos; omite
identificadores y valores tributarios reales.

## S1 — Login y RCV

- Login HTTP con clave tributaria (POST a `CAutInicio.cgi`): funciona, HTTP 200.
- Cookie `TOKEN` tras login: presente; no se registra su valor.
- Mi SII: `DatosCntrNow` presente y parseable como JSON, con `codigoError=0`.
- Consultas `getResumen` del RCV para septiembre de 2026:

| Operación | `estadoContab` | `respEstado.codRespuesta` | `data` |
|---|---|---|---|
| COMPRA | REGISTRO | 3 | null |
| COMPRA | PENDIENTE | 3 | null |
| COMPRA | NO_INCLUIR | 3 | null |
| COMPRA | RECLAMADO | 3 | null |
| VENTA | REGISTRO | 3 | null |

- Las cinco respuestas llegaron sin mensaje, errores ni rechazo. No se observaron
  indicios de captcha en estas respuestas vacías.
  La evidencia solo muestra consultas vacías sin rechazo explícito; no confirma
  el significado del código 3 ni la clasificación de documentos por estado.
- Campos observados en el sobre de respuesta de resumen: `data`, `totDocRes`,
  `tieneEmisorAgresivo`, `pDB`, `verF29`, `dataCabecera`, `metaData`, `respEstado`.
- Campos de filas de resumen: no observados, porque `data` fue `null`.
- No se ejecutó `getDetalleCompra` ni `getDetalleVenta`; no se observaron campos
  de detalle y sigue pendiente comprobar si el detalle exige captcha.

## S2 — F29 presentado (PDF compacto)

- `formCompacto` devuelve PDF sin navegador: sí, con cabecera válida `%PDF-`.
- La consulta de septiembre devolvió `data: []`, sin errores. El script seleccionó un F29 presentado de
  un mes anterior y descargó su PDF compacto; no se registran el período concreto
  ni el folio.
- La descarga está comprobada; la extracción del contenido y sus códigos aún
  no se ha calibrado.

## S3 — Estados F29

- `getDeclaracionConEstados` respondió a las consultas de doce meses sin errores.
- Etiquetas de `estado` observadas: `Vigente` y `Rechazada por pago inconcluso`.
- Campos observados en las filas: `estadoDeclaracionId`, `monto`, `folio`,
  `estado`, `declFechaCreacion`, `enNegocio`, `codigo`, `tingcodingreso`.
  Solo se conservan los nombres de los campos, sin sus valores tributarios.

## S4 — Empresa con su propia clave

- RCV y F29 respondieron con la sesión de la empresa, sin `SIN_PERMISO`.
- La identidad de `DatosCntrNow` coincidió con la de la ejecución; se observó
  `razonSocial` presente y `nombres` ausente. No se registran sus valores.
- La comprobación corresponde a esta sesión de empresa; no se realizó una
  ejecución adicional de persona natural.

## Decisiones

- `ESTADO_WIRE` (Tarea 12): conservar los literales `REGISTRO`, `PENDIENTE`,
  `NO_INCLUIR` y `RECLAMADO`. Queda pendiente validarlos con registros no vacíos
  para confirmar su clasificación y observar las filas de resumen y detalle.
  Estas respuestas vacías no permiten validar los requisitos del detalle.
- Etiqueta que indica F29 vigente (Tarea 5, `declaracionVigente`): `/vigente/i`,
  a partir de la etiqueta `Vigente` observada.
- Lector de PDF F29 (Tarea 13): seguir con `unpdf`. La viabilidad de descargar
  el compacto sin navegador está verificada; la extracción y calibración de
  códigos quedan sujetas a la PAUSA propia de la Tarea 13.
- La limitación de las consultas RCV vacías queda registrada para validación
  posterior y no bloquea el andamiaje de la Tarea 2.
