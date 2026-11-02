# Seguridad de mi-sii-mcp: qué protege y cómo

Este documento explica dónde vive cada dato sensible, quién puede verlo y qué hace el código para protegerlo. Para reportar una vulnerabilidad, mira [SECURITY.md](../SECURITY.md).

## Principios

1. **Solo lectura frente al SII.** mi-sii-mcp nunca presenta, rectifica, emite ni paga nada.
2. **La clave no pasa por el chat.** Ninguna herramienta MCP recibe claves. La persona inicia sesión en una página local o en su terminal, nunca en la conversación con el asistente.
3. **Los datos quedan en el equipo.** No hay servidores intermedios ni telemetría.

## Dónde vive cada dato

| Dato | Dónde | Protección | Código |
| --- | --- | --- | --- |
| Clave tributaria (solo con «Mantener conectada» o `--guardar-clave`) | Almacén de credenciales del sistema: Administrador de credenciales de Windows, Llavero de macOS o Secret Service en Linux, bajo el servicio `mi-sii-mcp` | La cifra el sistema operativo; nunca se escribe en archivos | `src/connectors/secretos/llavero.ts` |
| Sesión del SII (cookies) | `~/.mi-sii-mcp/sesiones/` | Archivos con permisos `0600` (solo el usuario), escritos de forma atómica | `src/connectors/sii/sesiones.ts` |
| Datos tributarios | `~/.mi-sii-mcp/mi-sii-mcp.db` (SQLite) y sus respaldos en `~/.mi-sii-mcp/respaldos/` | En el equipo del usuario | `src/store/sqlite/` |
| Respuestas del SII guardadas como evidencia | La misma base | Se sanean antes de guardarlas: sin el token de la sesión, correos, direcciones ni códigos de barra | `src/connectors/sii/sdi.ts` y cada lector en `src/connectors/sii/` |

La carpeta de datos se cambia con `MI_SII_MCP_HOME`.

## La página local

La página para conectar cuentas («conecta mi cuenta», `mi-sii-mcp conectar` o «Abrir mi-sii-mcp.cmd») es un servidor HTTP en el propio equipo (`src/interfaces/web/servidor.ts`):

- Escucha solo en `127.0.0.1`: no se alcanza desde la red.
- Rechaza toda solicitud cuyo encabezado `Host` no sea el suyo, lo que frena el *DNS rebinding*.
- Toda acción (`POST`) exige el token CSRF de la página, el encabezado `Origin` propio y JSON. Un sitio web abierto en otra pestaña no puede usarla.
- La página lleva una política de contenido (CSP) con *nonce*: no carga recursos externos ni ejecuta scripts ajenos.
- Limita el tamaño de lo que recibe y se cierra sola tras 30 minutos sin uso.
- La abre `src/interfaces/web/lanzador.ts`, que solo acepta su propia dirección (`http://127.0.0.1:<puerto>`) al llamar al navegador.

## Las herramientas MCP

- **Ninguna recibe claves.** Las pruebas verifican que ningún esquema de entrada pide una clave (`test/interfaces/mcp.test.ts`).
- **Las que van al SII solo leen.** Las demás trabajan con la base local.
- **`consulta_sql` solo lee,** y lo hace sobre una copia de los datos (`src/store/sqlite/consulta-libre.ts`).
- **`cuenta_conectar` solo abre la página local** en el navegador.

## Qué llega al proveedor de IA

Lo que devuelven las herramientas pasa a la conversación con el asistente y, por lo tanto, a su proveedor de IA (Anthropic, OpenAI, Google u otro), como cualquier cosa que se le muestre. Por eso:

- las respuestas muestran solo lo necesario;
- la skill pide no repetir RUT ni nombres de terceros si no hace falta;
- la persona decide de qué contribuyentes pregunta.

La clave nunca está entre esos datos.

## Conexiones fuera del SII

Hay solo una: una consulta diaria a `https://registry.npmjs.org/mi-sii-mcp/latest` para avisar si hay una versión nueva, sin datos de la persona (`src/connectors/sistema/version-npm.ts`). Se apaga con `MI_SII_MCP_SIN_AVISO_VERSION=1`.

## Cadena de publicación

- El código es abierto y cada cambio pasa por las pruebas en Windows, macOS y Linux, el análisis de código CodeQL y la revisión de dependencias (Dependabot y `npm audit`).
- Las versiones se publican en npm desde GitHub Actions con *trusted publishing*, sin tokens guardados y con procedencia verificable del paquete (`.github/workflows/publicar.yml`).
