# 0010 — Resiliencia y auto-reparación ante cambios del SII

Fecha: 2 de noviembre de 2026. Estado: decidido.

## Decisión

mi-sii-mcp nota solo cuando el SII cambia sus respuestas. Si el cambio es un nombre de campo y los totales del propio SII permiten comprobarlo, se adapta solo. Si no, se detiene antes de guardar datos malos y avisa.

Nunca baja ni ejecuta código remoto: lo único que se aprende son nombres de campos, guardados en la base local.

Frente al SII no cambia el ritmo de las consultas (1 s entre cada una), ni lo que se descarga, ni el paralelismo. Todas las mejoras de velocidad son locales.

## Cómo nota los cambios

- **Huella de cada respuesta** (`src/domain/huella.ts`): las rutas de sus campos, sin un solo valor (por ejemplo, `data[].detMntNeto`).
  - Las llaves numéricas (códigos, años) se agrupan como `#`, y las filas de una lista se unen.
  - De las páginas de boletas se toman los nombres de `arr_informe_mensual` y `xml_values`.
  - El PDF del F29 no tiene huella: lo revisa su propia coherencia de códigos.
- **Base de comparación:** la primera vez se arma con todas las respuestas crudas ya guardadas. Después, cada campo nuevo queda como un cambio «aditivo» en `portal_cambio`. Es informativo: no avisa.

## Campos obligatorios

`src/connectors/sii/mapa-campos.ts` reúne los nombres conocidos de cada campo del RCV (resumen y detalle) y de los estados del F29. Son obligatorios los campos que vinieron en el 100 % de las filas de las respuestas reales revisadas el 02-11-2026:
- 88 filas de resumen;
- 454 de detalle;
- 87 estados del F29.

Si un obligatorio falta en todas las filas, la lectura se detiene con `PORTAL_CAMBIO`:
- no se guardan ceros;
- lo anterior queda intacto;
- un archivo de diagnóstico guarda lo que falta y las llaves sin usar.

Antes, un monto renombrado se habría leído como 0 sin ningún error.

## Auto-reparación con los totales del SII

En los datos reales, el detalle del RCV cuadra al peso con su resumen en 28 de 28 grupos (cantidad, neto, IVA, exento y total). Por eso, si un monto del detalle falta en todos los documentos, el lector busca entre las llaves sin usar.

Se adopta el campo **solo si es el único** que cumple todo esto:
- es numérico en todos los documentos;
- su suma iguala al peso el total del resumen;
- la cantidad de documentos coincide con la del resumen;
- ese total del resumen no es 0.

El nombre adoptado:
- se guarda en `portal_alias` y se usa en las lecturas siguientes;
- queda como cambio «reparado»;
- genera un aviso de tipo `portal`.

Con dos candidatos, con ninguno o sin un resumen con qué comprobar, no se adivina: es `PORTAL_CAMBIO`.

## Resiliencia operativa

- **Interruptor:** tras 3 superficies seguidas sin respuesta del SII (`SII_NO_DISPONIBLE`), la sincronización se detiene y conserva lo traído. Antes intentaba cada mes con reintentos de 60 s.
- **Renovación en caliente:** si el SII da la sesión por vencida a mitad de camino y la persona guardó la clave en el llavero («Mantener conectada»), se entra de nuevo una sola vez y se repite el período. Nunca se pide una clave.
- **Cola de reintentos:** la revisión diaria vuelve a traer lo que falló por una causa que se arregla esperando (`SII_NO_DISPONIBLE`, `SII_LIMITE`, `SII_EN_ESPERA`, `RESPUESTA_VACIA`, `DATOS_INCOMPLETOS`).
  - Toma los últimos 30 días y lo intenta hasta 5 veces seguidas.
  - Cada cuenta reintenta a lo más 6 períodos por revisión.
- **Escritura atómica:** los archivos de sesión, de bloqueo, de exportaciones y de caché de versión se escriben en un temporal que luego se renombra. Un corte no deja un archivo roto.
- **Proceso MCP:** una promesa rechazada o una excepción que nadie capturó se registra en stderr y el servidor sigue. Solo sale si hay más de 5 en un minuto.
- **Mantenimiento diario (al final de la revisión):**
  - poda de respuestas crudas viejas: quedan las 2 sincronizaciones más nuevas por superficie y período, y siempre el último PDF de cada folio del F29;
  - `PRAGMA quick_check`;
  - un respaldo por día con `VACUUM INTO` en `~/.mi-sii-mcp/respaldos/`, del que quedan los 3 más nuevos.

## Respuestas y procesamiento

- **JSON compacto** en todas las respuestas MCP.
- **Versiones livianas por defecto** de `sii_panorama`, `renta_resumen`, `contabilidad_libro` y `contabilidad_asientos`, con `detalle: true` para tener todo.
- Medido sobre una copia de la base real:

  | Herramienta | Antes | Ahora |
  | --- | --- | --- |
  | `sii_panorama` | 25,3 KB | 10,7 KB |
  | `renta_resumen` | 20,4 KB | 7,7 KB |
  | `contabilidad_libro` | 45,8 KB | 8,9 KB |
  | `contabilidad_asientos` | 117,4 KB | 14,5 KB |

- **`consulta_sql`:** un proceso queda esperando la siguiente consulta, y la copia curada se arma de nuevo solo si cambian los datos (según `data_version` y `total_changes()`). Pasó de unos 90 ms a menos de 1 ms por consulta tras la primera.

## Aviso de versión nueva

Es la única consulta fuera del SII: `https://registry.npmjs.org/mi-sii-mcp/latest`.
- Se hace a lo más una vez al día, con un plazo de 3 s.
- Su caché queda en `~/.mi-sii-mcp/version-npm.json`.
- Solo pide la ficha pública del paquete: no envía ningún dato de nadie.
- Se avisa una vez por versión, en novedades y en `perfiles_listar`. Nunca se instala nada solo.
- Se apaga con `MI_SII_MCP_SIN_AVISO_VERSION=1`.

## Lo que no se puede auto-reparar

Un cambio de dirección de un servicio, de versión de su API o de forma del sobre (no de un campo) no tiene un total con qué comprobarse.

En esos casos:
- se detecta;
- la lectura se detiene sin tocar lo guardado;
- se avisa;
- `diagnostico` lo muestra.

Se corrige con una versión nueva de mi-sii-mcp, que el aviso de versión ayuda a instalar pronto.
