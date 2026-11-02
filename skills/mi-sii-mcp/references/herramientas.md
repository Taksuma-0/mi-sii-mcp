# Herramientas de mi-sii-mcp

Las 32 herramientas del servidor, con sus parámetros:
- `rut` acepta `12.345.678-9` o `12345678-9`.
- Los períodos van como `AAAA-MM`.
- Los años tributarios van como `AAAA` (año comercial + 1). En `regimen_simular` y `cierre_proyectar`, `anio` es el **año comercial**.
- Un `?` indica que el parámetro es opcional.

## Conectar la cuenta

| Herramienta | Parámetros | Qué hace |
| --- | --- | --- |
| `cuenta_conectar` | — | Abre en el navegador de la persona la página local donde conecta una cuenta del SII (RUT y clave tributaria, o ClaveÚnica); ahí también importa cartolas y activa la revisión diaria. La clave nunca pasa por el chat. |

## Consultan el SII (solo lectura)

| Herramienta | Parámetros | Qué hace |
| --- | --- | --- |
| `sincronizar` | `rut`, `desde`, `hasta?`, `superficies?` (`rcv`, `f29`, `propuesta`, `bhe`) | Trae RCV y F29 (por defecto) de un rango de hasta 120 meses; conviene ir por tramos de 12. `propuesta` agrega la propuesta de F29; `bhe`, las boletas de honorarios recibidas. |
| `renta_sincronizar` | `rut`, `desde`, `hasta?` (años tributarios, hasta 10) | Trae el F22 del año (declaraciones, folio vigente, códigos, observaciones y eventos), lo que el SII prepara para el F22 (PPM y comparativo F29-RCV); de una persona, también sus boletas emitidas y lo informado por terceros. |
| `perfil_sincronizar` | `rut` | Perfil tributario (régimen, segmento, autorización para declarar el F29 hasta el día 20) y empresas autorizadas. |
| `sii_avisos` | `rut` | Anotaciones vigentes de Mi SII (restricciones como F29 no presentado o domicilio sin acreditar), estado de cumplimiento y mensajes; registra cada anotación como aviso. Solo con la sesión propia del RUT. |

## Trabajan con lo guardado en el equipo (no van al SII)

### Consultas y conciliación

| Herramienta | Parámetros | Qué hace |
| --- | --- | --- |
| `perfiles_listar` | — | Cuentas configuradas, estado de la sesión y si se renueva sola. |
| `sii_panorama` | `rut`, `detalle?` | Qué hay guardado por mes y por año, con montos y cobertura; con `detalle`, también los códigos del F29 y la frescura de cada mes. |
| `iva_resumen` | `rut`, `periodo` | IVA del mes conciliado: RCV contra F29, remanente y hallazgos. |
| `iva_hallazgos` | `rut`, `desde?`, `hasta?`, `severidad?` (`info`, `advertencia`, `critico`) | Descuadres, F29 faltantes, facturas por reclamar, cambios posteriores al F29, retenciones y F29 pagados con recargos. |
| `f29_historial` | `rut`, `desde`, `hasta` | Por mes: si el F29 está presentado, folio, débitos, créditos y total a pagar; con boletas recibidas, también la retención del código 151 frente a la de esas boletas. |
| `rcv_documentos` | `rut`, `periodo`, `lado?` (`COMPRA`, `VENTA`), `estado?` (`REGISTRO`, `PENDIENTE`, `NO_INCLUIR`, `RECLAMADO`), `tipo_doc?`, `rut_contraparte?`, `pagina?` | Documentos del RCV de un mes, paginados. |
| `plazos_proximos` | `rut`, `dias?` (1 a 365) | F29 por presentar, F22 y facturas cuyo plazo de reclamo (8 días) vence pronto. |
| `renta_resumen` | `rut`, `anio?`, `detalle?` | Renta guardada: conclusión del SII, códigos clave, boletas emitidas y su cruce con el F22, pagadores, lo informado por terceros y el asistente del F22. |
| `f29_releer` | `rut`, `desde?`, `hasta?` | Relee los PDF de F29 guardados con el lector actual. |
| `fuentes_oficiales` | `buscar?`, `regla?` | Páginas oficiales para datos públicos (UTM, tablas, tasas, comisiones, tasa de Primera Categoría) y, con `regla: true`, la regla para estimar el F22 de una persona. |
| `datos_esquema` | — | Tablas y columnas disponibles para `consulta_sql`, con reglas de interpretación. Llámala una vez. |
| `consulta_sql` | `sql` | Un único `SELECT` o `WITH … SELECT` de solo lectura sobre una copia de los datos; máximo 200 filas y 40.000 caracteres. |

### Estimaciones

| Herramienta | Parámetros | Qué hace |
| --- | --- | --- |
| `f29_estimar` | `rut`, `periodo`, `utm_actual?`, `utm_anterior?`, `impuesto_unico?`, `tasa_ppm?` | F29 calculado con el RCV, el remanente anterior (presentado o estimado), la tasa de PPM del último F29 y las boletas recibidas; si ya se presentó, la diferencia con el código 91. El reajuste del remanente necesita las dos UTM. |
| `renta_estimar` | `rut`, `anio`, `tabla_igc`, `uta`, `gastos_presuntos_pct`, `tope_gastos_presuntos_uta`, `obligado_cotizar`, `cotizaciones?`, `factores_ipc?`, `gastos_efectivos?`, `apv_regimen_b?`, `otras_rentas?`, `sueldos?`, `impuesto_unico_retenido?` | F22 estimado de una persona; los datos públicos salen de `fuentes_oficiales`. Compara con el código 305 si hay F22. |
| `cierre_proyectar` | `rut`, `anio`, `tasa_idpc?` | Proyecta el año al cierre al ritmo de los meses con datos y lo compara con los PPM; con la tasa, estima Primera Categoría y el saldo de abril (no en el Pro Pyme Transparente). |
| `regimen_simular` | `rut`, `anio`, `socios` (`participacion`, `otras_rentas`), `tasa_idpc`, `tabla_igc`, `retiro_pct?`, `base?` | Pro Pyme General frente a Transparente para un año: impuesto de la empresa, de los dueños y total, con requisitos y plazo para cambiarse. |
| `ahorro_oportunidades` | `rut` | Oportunidades legales (crédito de IVA por usar, remanente, postergación del IVA, gastos efectivos, APV), cada una con su norma y la página oficial. |

### Banco y contabilidad

| Herramienta | Parámetros | Qué hace |
| --- | --- | --- |
| `banco_importar` | `rut`, `archivo` (ruta a un .csv o .txt de hasta 5 MB), `cuenta?`, `columnas?` | Importa una cartola de cualquier banco; detecta columnas, codificación y separador, y no duplica al reimportar. |
| `banco_conciliar` | `rut`, `desde`, `hasta?`, `accion?` (`asignar`, `descartar`), `huella?`, `partida?` | Empareja movimientos con ventas, compras, boletas, F29 y F22; con `accion`, fija a mano un movimiento. |
| `cuentas_pendientes` | `rut`, `al?`, `lado?` (`cobrar`, `pagar`) | Facturas sin cobro o pago en el banco, por tramos de antigüedad. |
| `contabilidad_cuentas` | `rut`, `accion` (`listar`, `crear`, `asignar`, `quitar`), `cuenta?`, `nombre?`, `tipo?`, `rut_contraparte?` | Plan de cuentas base, cuentas propias y la cuenta fija de un proveedor. |
| `contabilidad_libro` | `rut`, `tipo` (`compras`, `ventas`, `honorarios_recibidos`, `honorarios_emitidos`, `banco`), `desde`, `hasta?`, `exportar?`, `detalle?` | Libro con totales (50 filas salvo `detalle`); con `exportar`, CSV en `~/.mi-sii-mcp/exportaciones`. |
| `contabilidad_asientos` | `rut`, `desde`, `hasta?`, `exportar?`, `detalle?` | Propuesta de asientos (cada uno cuadra; 30 salvo `detalle`); lo que no se puede clasificar va a «Por clasificar». |
| `contabilidad_resultado` | `rut`, `desde`, `hasta?`, `base?` (`devengado`, `percibido`) | Ingresos, costos y gastos por cuenta, resultado y principales clientes y proveedores. |

### Seguimiento

| Herramienta | Parámetros | Qué hace |
| --- | --- | --- |
| `novedades` | `rut?`, `marcar_vistas?` | Avisos de la revisión diaria que aún no se ven; por defecto los marca como vistos. |
| `cartera_estado` | — | Una línea por cuenta: sesión, F29 vencidos o por vencer, hallazgos críticos, próximo plazo, avisos sin ver y movimientos sin conciliar. |
| `diagnostico` | `rut?` | Salud de mi-sii-mcp: versión, base y respaldo, sesión y última lectura buena por cuenta, fallas por reintentar y cambios del portal (campos nuevos, nombres adaptados, lecturas rotas). |

## Recetas (prompts MCP)

`revision_mensual`, `que_tengo_pendiente`, `cierre_contable`, `cartera_semanal`, `preparar_renta` y `ahorro_tributario`: cada una indica qué herramientas usar y en qué orden.

## Errores frecuentes

| Código | Qué significa | Qué hacer |
| --- | --- | --- |
| `SESION_REQUERIDA`, `CLAVE_RECHAZADA`, `RUT_BLOQUEADO_LOCAL` | Falta sesión o la clave fue rechazada | Pedir a la persona que conecte su cuenta en la página local; nunca pedir la clave |
| `SII_SESIONES_MAXIMAS` | Demasiadas sesiones abiertas en el SII | Esperar unos minutos; cerrar otras sesiones del SII; no sincronizar en paralelo |
| `SII_LIMITE`, `SII_NO_DISPONIBLE`, `SII_EN_ESPERA` | El SII limita o no responde | Reintentar más tarde |
| `RESPUESTA_VACIA`, `DATOS_INCOMPLETOS` | El SII respondió sin datos o con menos de los esperados | Se conserva lo guardado; reintentar más tarde |
| `PORTAL_CAMBIO`, `LECTURA_INCOHERENTE` | El SII cambió su portal (falta un campo que no se pudo comprobar) o un F29 no cuadra | Informar a la persona y revisar `diagnostico`; lo guardado no se tocó. Para el F29, `f29_releer` |
| `SIN_DATOS_LOCALES` | Falta sincronizar el mes o importar la cartola | Sincronizar o pedir la cartola (`banco_importar` o la página local) |
| `PARAMETROS_INVALIDOS` | Un parámetro no tiene sentido (p. ej. participaciones que no suman 100) | Corregirlo según el mensaje |
| `ARCHIVO_INVALIDO` | La cartola no se pudo leer | Indicar `columnas` o guardarla como CSV desde Excel |
| `SIN_PERMISO` | La sesión no permite ese dato (p. ej. Mi SII de una empresa representada) | Conectar la cuenta propia de ese RUT |
| `CONSULTA_RECHAZADA` | La SQL no es un único `SELECT` | Reescribir la consulta |
