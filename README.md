# mi-sii-mcp

**Pregúntale a tu asistente por tus impuestos del SII, con tus datos reales.**

mi-sii-mcp es un servidor [MCP](https://modelcontextprotocol.io) que conecta un asistente (Claude Code, Claude Desktop u otro cliente MCP) con **tu cuenta del SII de Chile**. Trae tus datos tributarios, los guarda **solo en tu equipo** y los cruza para mostrarte qué cuadra, qué no y qué vence.

> ⚠️ **No oficial.** No está afiliado al Servicio de Impuestos Internos ni es asesoría tributaria. Úsalo para revisar tu información; las decisiones tributarias son tuyas o de tu contador.

---

## ¿Qué puedes preguntarle?

- «¿Cuánto me han retenido este año en boletas de honorarios?»
- «¿Cuadran mis boletas con lo que declaré en la renta?»
- «¿Qué informaron mis pagadores al SII sobre mí?»
- «¿Tengo algún F29 sin presentar o por vencer?»
- «¿Cuadra el IVA de mis compras y ventas con el F29 de septiembre?»
- «¿A quién le emití más boletas en 2026?»
- «Estímame la devolución de la próxima renta» (con fuentes oficiales para los valores públicos)

## Qué lee del SII

| Área | Qué trae | Qué cruza |
| --- | --- | --- |
| **IVA** | Registro de compras y ventas (RCV), F29 presentados (con su PDF) y propuesta de F29 | IVA del RCV contra el F29, F29 faltantes, facturas por reclamar, coherencia interna del F29 |
| **Boletas de honorarios** | Recibidas (por mes) y emitidas (resumen anual y detalle boleta por boleta) | Retención de las boletas contra el F29 (código 151) y contra la renta (códigos 547 y 492) |
| **Renta (F22)** | Declaraciones por año, folio vigente, códigos, observaciones y eventos (devoluciones, giros) | Boletas emitidas y lo informado por terceros contra el F22 |
| **Informado por terceros** | Declaraciones juradas que otros presentan sobre ti (p. ej. retenciones de honorarios, sueldos) | Retención informada por cada pagador contra tus boletas y tu F22; avisa si el SII observó la declaración de un informante |
| **Cuenta** | Perfil tributario (régimen, segmento, si declara el F29 hasta el día 20) y empresas autorizadas | Vencimientos del F29 según tu caso (día 12, 20 o 28) |

Los **datos públicos** (UTM, tablas de impuestos, tasas de cotización, comisiones de AFP) no se guardan: la herramienta `fuentes_oficiales` indica en qué página oficial consultarlos para el año que corresponda.

## Seguridad y privacidad

- **Solo lee.** Nunca presenta, modifica ni emite nada en el SII.
- **Tus datos quedan en tu equipo**, en una base SQLite en `~/.mi-sii-mcp`. No hay servidores intermedios.
- **El asistente nunca ve tu clave.** El inicio de sesión lo haces tú en una página local o en el navegador; el MCP no tiene ninguna herramienta que reciba claves.
- Si eliges «Mantener conectada», la clave queda en el **almacén de credenciales del sistema** (Administrador de credenciales de Windows, Llavero de macOS o Secret Service en Linux), no en archivos.
- Los datos de terceros se limitan a lo necesario (p. ej. razón social del pagador); no se guardan correos, direcciones, códigos de barra ni el token de la sesión.
- Lo que el asistente consulta pasa a la conversación con él: pregunta solo por los contribuyentes que estés dispuesto a comentar ahí.

## Requisitos

- [Node.js](https://nodejs.org) 22.12 o superior (probado con Node 24).
- Un cliente MCP: [Claude Code](https://docs.claude.com/en/docs/claude-code) o Claude Desktop.
- Clave tributaria del SII (o ClaveÚnica, desde el navegador).
- Windows es la plataforma probada; macOS y Linux deberían funcionar con el mismo código.

## Instalación

```bash
git clone https://github.com/Taksuma-0/mi-sii-mcp.git
cd mi-sii-mcp
npm install
npm run build
```

### 1. Registrar el servidor en Claude Code

Reemplaza la ruta por la carpeta donde clonaste el proyecto:

```bash
claude mcp add --scope user mi-sii-mcp -- node "C:\ruta\a\mi-sii-mcp\dist\interfaces\cli\bin.js" mcp
```

Para Claude Desktop, agrega el servidor en su archivo de configuración (ver la [guía del asistente](docs/guias/asistente-mcp.md#5-claude-desktop)).

### 2. Conectar tu cuenta del SII

En Windows, haz doble clic en **`Abrir mi-sii-mcp.cmd`** (en la carpeta del proyecto). Se abre una página local donde:

1. Escribes tu RUT (los puntos y el guion se ponen solos) y tu clave tributaria.
2. Dejas marcado **Mantener conectada** para que la sesión se renueve sola.
3. Pulsas **Conectar**.

Puedes conectar varias cuentas (tu RUT personal y tus empresas). También puedes entrar con **ClaveÚnica** desde la misma página, aunque esa sesión no se renueva sola.

En otras plataformas, abre la página con `npm run local`, o inicia sesión desde la terminal con `node dist/interfaces/cli/bin.js login <rut> --guardar-clave`.

### 3. Preguntar

En Claude Code escribe `/mcp` para cargar el servidor y luego pregunta, por ejemplo: «lista mis perfiles» o «trae mi renta de los últimos 3 años».

## Herramientas del MCP

| Herramienta | Para qué sirve | ¿Consulta al SII? |
| --- | --- | --- |
| `perfiles_listar` | Cuentas configuradas, estado de su sesión y si se renueva sola | No |
| `sii_panorama` | Qué hay guardado por mes y por año | No |
| `sincronizar` | Trae RCV y F29 de un rango de meses (opcional: propuesta de F29 y boletas recibidas) | Sí (lectura) |
| `renta_sincronizar` | Trae el F22, las boletas emitidas y lo informado por terceros, por año tributario | Sí (lectura) |
| `perfil_sincronizar` | Trae el perfil tributario y las empresas autorizadas | Sí (lectura) |
| `iva_resumen`, `iva_hallazgos` | Conciliación del IVA y hallazgos por mes | No |
| `f29_historial`, `plazos_proximos` | Historial de F29 y vencimientos | No |
| `rcv_documentos` | Documentos del RCV de un mes | No |
| `renta_resumen` | Renta guardada con sus cruces (boletas, pagadores, terceros) | No |
| `f29_releer` | Vuelve a leer los PDF de F29 guardados, sin ir al SII | No |
| `fuentes_oficiales` | Dónde consultar los datos públicos (UTM, tablas, tasas) y cómo estimar una renta | No |
| `datos_esquema`, `consulta_sql` | Mapa de las tablas y consultas `SELECT` de solo lectura para preguntas libres | No |

## Uso desde la terminal (opcional)

Todo lo anterior también está disponible como comandos:

```bash
node dist/interfaces/cli/bin.js --help
node dist/interfaces/cli/bin.js perfil listar
node dist/interfaces/cli/bin.js sync <rut> --desde 2026-01 --hasta 2026-09
node dist/interfaces/cli/bin.js renta sync <rut> --desde 2025 --hasta 2027
node dist/interfaces/cli/bin.js renta ver <rut>
```

## Configuración

Variables de entorno opcionales:

| Variable | Para qué |
| --- | --- |
| `MI_SII_MCP_HOME` | Carpeta de datos (por defecto `~/.mi-sii-mcp`) |
| `MI_SII_MCP_PLAZO_HTTP_MS` | Plazo de cada consulta al SII (por defecto 60 s) |
| `MI_SII_MCP_INTERVALO_MS` | Pausa mínima entre consultas al SII (por defecto 1 s) |
| `MI_SII_MCP_TOLERANCIA` | Tolerancia en pesos para los cruces de IVA |
| `MI_SII_MCP_NAVEGADOR` | Ruta de Edge o Chrome para entrar con ClaveÚnica |
| `MI_SII_MCP_PLAZO_NAVEGADOR_MS` | Tiempo para completar el inicio de sesión en el navegador |

## Desarrollo

```bash
npm test            # pruebas (solo datos ficticios; nunca consultan el SII real)
npm run typecheck   # tipos
npm run build       # compila a dist/
npm run probar:mcp  # prueba el servidor MCP compilado
```

El código está organizado por capas (`domain`, `app`, `connectors`, `store`, `interfaces`, `main`); `test/arquitectura.test.ts` verifica que se respeten. Las decisiones de diseño están en [`docs/decisiones`](docs/decisiones) y las guías de uso en [`docs/guias`](docs/guias).

Las contribuciones son bienvenidas. Por favor, **nunca incluyas datos tributarios reales** (RUT, nombres, montos) en issues, pruebas ni fixtures: usa RUT ficticios como `11.111.111-1`.

## Limitaciones

- La propuesta del F22 aún no se lee (el SII la publica en abril).
- La declaración de sueldos del empleador (DJ 1887) se lee de forma genérica: su formato no se ha verificado con datos reales.
- Si el SII cambia su portal, algunas lecturas pueden fallar hasta actualizar el lector; los errores lo indican y nunca se borran datos guardados por una respuesta vacía.

## Licencia

[MIT](LICENSE) © 2026 Welinton Barrera
