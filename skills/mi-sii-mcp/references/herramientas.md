# Herramientas de mi-sii-mcp

Las 15 herramientas del servidor, con sus parámetros. `rut` acepta `12.345.678-9` o `12345678-9`; los períodos son `AAAA-MM` y los años tributarios `AAAA` (año comercial + 1). Un `?` indica que el parámetro es opcional.

## Consultan el SII (solo lectura)

| Herramienta | Parámetros | Qué hace |
| --- | --- | --- |
| `sincronizar` | `rut`, `desde`, `hasta?`, `superficies?` (`rcv`, `f29`, `propuesta`, `bhe`) | Trae RCV y F29 (por defecto) de un rango de hasta 120 meses; conviene ir por tramos de 12. `propuesta` agrega la propuesta de F29; `bhe`, las boletas de honorarios recibidas. |
| `renta_sincronizar` | `rut`, `desde`, `hasta?` (años tributarios, hasta 10) | Trae el F22 del año (declaraciones, folio vigente, códigos, observaciones y eventos); de una persona, también sus boletas emitidas (resumen anual y detalle por boleta) y lo informado por terceros. |
| `perfil_sincronizar` | `rut` | Perfil tributario (régimen, segmento, autorización para declarar el F29 hasta el día 20) y empresas autorizadas. |

## Trabajan con lo guardado en el equipo (no van al SII)

| Herramienta | Parámetros | Qué hace |
| --- | --- | --- |
| `perfiles_listar` | — | Cuentas configuradas, estado de la sesión y si se renueva sola. |
| `sii_panorama` | `rut` | Qué hay guardado por mes y por año, con montos y cobertura. |
| `iva_resumen` | `rut`, `periodo` | IVA del mes conciliado: RCV contra F29, remanente y hallazgos. |
| `iva_hallazgos` | `rut`, `desde?`, `hasta?`, `severidad?` (`info`, `advertencia`, `critico`) | Descuadres, F29 faltantes, facturas por reclamar, cambios posteriores al F29, retenciones. |
| `f29_historial` | `rut`, `desde`, `hasta` | Por mes: si el F29 está presentado, folio, débitos, créditos y total a pagar; con boletas recibidas sincronizadas, también la retención del código 151 frente a la de esas boletas. |
| `rcv_documentos` | `rut`, `periodo`, `lado?` (`COMPRA`, `VENTA`), `estado?` (`REGISTRO`, `PENDIENTE`, `NO_INCLUIR`, `RECLAMADO`), `tipo_doc?`, `rut_contraparte?`, `pagina?` | Documentos del RCV de un mes, paginados. |
| `plazos_proximos` | `rut`, `dias?` (1 a 365) | F29 por presentar y facturas cuyo plazo de reclamo (8 días) vence pronto. |
| `renta_resumen` | `rut`, `anio?` | Renta guardada: conclusión del SII, códigos clave, boletas emitidas y su cruce con el F22, pagadores y lo informado por terceros. |
| `f29_releer` | `rut`, `desde?`, `hasta?` | Relee los PDF de F29 guardados con el lector actual. |
| `fuentes_oficiales` | `buscar?`, `regla?` | Páginas oficiales para datos públicos (UTM, tablas, tasas, comisiones) y, con `regla: true`, la regla para estimar el F22 de una persona. |
| `datos_esquema` | — | Tablas y columnas disponibles para `consulta_sql`, con reglas de interpretación. Llámala una vez. |
| `consulta_sql` | `sql` | Un único `SELECT` o `WITH … SELECT` de solo lectura sobre una copia de los datos; máximo 200 filas y 40.000 caracteres. |

## Errores frecuentes

| Código | Qué significa | Qué hacer |
| --- | --- | --- |
| `SESION_REQUERIDA`, `CLAVE_RECHAZADA`, `RUT_BLOQUEADO_LOCAL` | Falta sesión o la clave fue rechazada | Pedir a la persona que conecte su cuenta en la página local; nunca pedir la clave |
| `SII_SESIONES_MAXIMAS` | Demasiadas sesiones abiertas en el SII | Esperar unos minutos; cerrar otras sesiones del SII; no sincronizar en paralelo |
| `SII_LIMITE`, `SII_NO_DISPONIBLE`, `SII_EN_ESPERA` | El SII limita o no responde | Reintentar más tarde |
| `RESPUESTA_VACIA`, `DATOS_INCOMPLETOS` | El SII respondió sin datos o con menos de los esperados | Se conserva lo guardado; reintentar más tarde |
| `PORTAL_CAMBIO`, `LECTURA_INCOHERENTE` | El SII cambió su portal o un F29 no cuadra | Informar a la persona; para el F29, `f29_releer` |
| `CONSULTA_RECHAZADA` | La SQL no es un único `SELECT` | Reescribir la consulta |
