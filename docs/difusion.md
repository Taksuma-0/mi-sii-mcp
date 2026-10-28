# Difusión: buscadores y directorios MCP

Cómo se presenta **mi-sii-mcp** fuera del repositorio: sitio web, Google Search Console y directorios de servidores MCP. Revisado el 27 de octubre de 2026. Nada de lo que está marcado como «pendiente» se ha enviado ni registrado todavía.

## Estado (27-10-2026)

| Acción | Estado |
| --- | --- |
| Sitio en GitHub Pages, About, enlace al sitio y topics del repo | ✅ Hecho |
| Imagen social del repositorio (Settings → Social preview) | ✅ Hecho |
| Bing Webmaster Tools: sitio importado desde Search Console (acceso de solo lectura), sitemap en proceso y URL principal enviada a indexación | ✅ Hecho |
| Google Search Console: propiedad `https://taksuma-0.github.io/mi-sii-mcp/` verificada con `docs/google71cc82c95b49bdda.html` (no borrar ese archivo), sitemap enviado e indexación solicitada | ✅ Hecho |
| Raíz del dominio: repo `Taksuma-0/Taksuma-0.github.io` (https://taksuma-0.github.io/) con favicon, logo, `WebSite` «mi-sii-mcp» y `robots.txt` con ambos sitemaps, para que Google muestre el ícono y el nombre del sitio en vez de «GitHub Pages documentation». Verificado en Search Console y Bing, sitemap enviado e indexación solicitada; Google tarda días o semanas en cambiar el ícono y el nombre | ✅ Hecho |
| Glama: ficha reclamada, descripción actualizada y build de prueba exitoso (Node 24, `npm ci --ignore-scripts`, `npm run build`, inicio `node dist/interfaces/cli/bin.js mcp`) | ✅ Hecho |
| Glama: release 0.1.0 publicado (auto-release activo en cada release de GitHub); 15/15 herramientas inspeccionadas, calidad A; puntuación de descubrimiento 83 % (falta un release estable en GitHub y uso real) | ✅ Hecho |
| Insignia de Glama en el README | ✅ Hecho |
| mcpservers.org: aprobado y publicado (https://mcpservers.org/servers/taksuma-0/mi-sii-mcp), con su insignia en el README | ✅ Hecho |
| MCP Market (cola gratuita) | ✅ Enviado, en cola (4 a 6 semanas) |
| npm (`npm publish`) | Pendiente: la suspensión temporal ya se levantó; falta publicar con el código de 6 dígitos de la app de verificación |
| MCP Registry oficial | Pendiente: requiere el paquete en npm |
| Release `v0.1.0` en GitHub (https://github.com/Taksuma-0/mi-sii-mcp/releases/tag/v0.1.0) | ✅ Hecho |
| PR a awesome-mcp-servers, sección Finance & Fintech (https://github.com/punkpeye/awesome-mcp-servers/pull/17810) | ✅ Abierto, en revisión |

Nota sobre la instalación con npm: en Glama, `npm ci` intentó compilar `better-sqlite3` con `node-gyp` y falló por falta de compilador; con `--ignore-scripts` usa los binarios precompilados que trae el paquete (`prebuilds/`). Al publicar en npm, conviene probar `npx mi-sii-mcp --help` en un equipo limpio.

## Lo que ya está en el repositorio

| Archivo | Para qué |
| --- | --- |
| `docs/index.html` | Sitio web del proyecto en GitHub Pages: https://taksuma-0.github.io/mi-sii-mcp/ (title, description, canonical, Open Graph, Twitter Cards y datos estructurados Schema.org: `WebSite`, `SoftwareApplication`, `SoftwareSourceCode` y `FAQPage`). |
| `docs/sitemap.xml` | Mapa del sitio para Google Search Console. |
| `docs/robots.txt` | Permite todo y declara el sitemap. Los buscadores solo leen el `robots.txt` de la raíz del dominio, que vive en el repo `Taksuma-0/Taksuma-0.github.io` y declara los dos sitemaps (raíz y `/mi-sii-mcp/`). |
| `docs/llms.txt` | Resumen en texto plano para sistemas de búsqueda con IA (qué es, qué resuelve, funcionalidades, compatibilidad e instalación). Es una convención voluntaria: no garantiza aparecer en respuestas generadas por IA. |
| `docs/.nojekyll` | Publica la carpeta `docs/` tal cual, sin procesarla con Jekyll. |
| `server.json` | Metadatos para el MCP Registry oficial, validados contra el esquema `2025-12-11`. |
| `glama.json` | Declara al mantenedor (`Taksuma-0`) para reclamar la ficha en Glama. Validado contra su esquema. |
| `package.json` | `description`, `keywords`, `homepage`, `repository`, `bugs`, `author` y `mcpName` (`io.github.Taksuma-0/mi-sii-mcp`, que debe coincidir con `name` en `server.json`). |

## Textos listos para usar

**GitHub About (descripción, máximo 350 caracteres):**

> 🤖 Servidor MCP para el SII de Chile: conecta Claude, Codex, Cursor o Gemini CLI con tu IVA, F29, F22, boletas de honorarios y renta. Concilia y detecta descuadres y vencimientos. 🔒 Open source, solo lectura y 100 % local: tu clave nunca pasa por el chat.

**Topics de GitHub (máximo 20):** `mcp`, `mcp-server`, `model-context-protocol`, `sii`, `sii-chile`, `chile`, `impuestos`, `tributario`, `iva`, `f29`, `f22`, `renta`, `boletas-de-honorarios`, `claude`, `claude-code`, `codex`, `cursor`, `gemini-cli`, `ai-agents`, `typescript`.

**Descripción corta (hasta 100 caracteres, la del MCP Registry):**

> Servidor MCP para el SII de Chile: IVA, F29, F22 y boletas de honorarios. Solo lectura y local.

**Descripción corta en inglés (para directorios en inglés):**

> Read-only MCP server for Chile's tax service (SII): VAT (RCV, F29), fee receipts and income tax (F22).

**Descripción larga en inglés:**

> mi-sii-mcp is an open-source Model Context Protocol server that connects AI assistants (Claude, Codex, Cursor, Gemini CLI, VS Code with Copilot) to a taxpayer's data in Chile's Internal Revenue Service (SII). It syncs VAT purchase and sales records (RCV), F29 returns, income tax (F22), fee receipts (boletas de honorarios) and third-party sworn statements into a local SQLite database, then cross-checks them for mismatches and upcoming deadlines. Read-only; the assistant never receives the taxpayer's password.

**Categorías sugeridas:** Finance / Fintech, Government data, Legal & compliance.

## Google Search Console (hecho; pasos de referencia)

1. Entra a https://search.google.com/search-console con tu cuenta de Google.
2. **Agregar propiedad → Prefijo de URL** → `https://taksuma-0.github.io/mi-sii-mcp/`. (La opción «Dominio» no sirve: `github.io` no es tuyo.)
3. Elige la verificación **Archivo HTML**: descarga el archivo `googleXXXXXXXX.html` que entrega Google, cópialo a la carpeta `docs/` del repositorio y súbelo a GitHub. Cuando GitHub Pages lo publique en `https://taksuma-0.github.io/mi-sii-mcp/googleXXXXXXXX.html`, pulsa **Verificar**. (Alternativa: la etiqueta `<meta name="google-site-verification" …>` dentro del `<head>` de `docs/index.html`.)
4. En **Sitemaps**, envía `https://taksuma-0.github.io/mi-sii-mcp/sitemap.xml`.
5. En **Inspección de URLs**, inspecciona `https://taksuma-0.github.io/mi-sii-mcp/` y pulsa **Solicitar indexación**.
6. Opcional: repite en **Bing Webmaster Tools** (https://www.bing.com/webmasters), que puede importar la propiedad desde Search Console.
7. Con **Prueba de resultados enriquecidos** (https://search.google.com/test/rich-results) puedes revisar los datos estructurados. Google solo muestra resultados enriquecidos de preguntas frecuentes a ciertos sitios, así que el marcado `FAQPage` sirve para describir la página, no garantiza un resultado especial.

## Directorios MCP

| Directorio | ¿Califica hoy? | Qué hacer |
| --- | --- | --- |
| **MCP Registry oficial** (registry.modelcontextprotocol.io) | No: exige un paquete publicado (npm, PyPI, NuGet, OCI, MCPB o cargo). | Publicar en npm y luego con `mcp-publisher` (ver abajo). |
| **Glama** (glama.ai/mcp/servers) | Sí: https://glama.ai/mcp/servers/Taksuma-0/mi-sii-mcp | Hecho: ficha reclamada, Dockerfile, build y release 0.1.0. |
| **MCP Market** (mcpmarket.com) | Sí. | Enviado el 27-10-2026 (cola gratuita, 4–6 semanas). |
| **mcpservers.org** | Sí. | Hecho: aprobado (https://mcpservers.org/servers/taksuma-0/mi-sii-mcp). |
| **awesome-mcp-servers** (punkpeye) | Sí: pasa los controles de Glama. | PR #17810 abierto (https://github.com/punkpeye/awesome-mcp-servers/pull/17810). |
| **mcp.so** | Sí, en lo técnico. | https://mcp.so/submit; hoy solo se ve una opción de pago. |
| **PulseMCP** | No por ahora: tiene los envíos pausados. | Lo toma desde el Registry oficial cuando reabra. |
| **Smithery** | No recomendable: cierra sus servicios de conexión el 31-10-2026 y para servidores locales exige un paquete `.mcpb`. | — |
| **modelcontextprotocol/servers** | No aplica: ya no acepta servidores nuevos y remite al Registry. | — |

### MCP Registry oficial (pendiente: requiere publicar en npm)

El nombre `mi-sii-mcp` estaba libre en npm el 27-10-2026. El nombre en el Registry distingue mayúsculas y debe usar el usuario exacto de GitHub: `io.github.Taksuma-0/mi-sii-mcp`.

1. Crea una cuenta en npm e inicia sesión: `npm login`.
2. Publica: `npm publish` (el script `prepublishOnly` corre los tipos, las pruebas y la compilación). Las versiones publicadas no se pueden reutilizar.
3. Instala `mcp-publisher` (https://modelcontextprotocol.io/registry/quickstart) e inicia sesión con GitHub: `mcp-publisher login github`.
4. Valida y publica desde la raíz del repo: `mcp-publisher validate` y `mcp-publisher publish`.
5. Comprueba: `https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Taksuma-0/mi-sii-mcp`.

En cada versión nueva, actualiza `version` en `package.json` y en `server.json` (en la raíz y dentro de `packages`).

### Glama (hecho; pasos de referencia)

1. Entra a la ficha con tu cuenta de GitHub y pulsa **Claim** (el `glama.json` del repo declara a `Taksuma-0` como mantenedor).
2. En **Admin → Dockerfile**, pega un Dockerfile para que Glama pueda arrancar el servidor e inspeccionar sus herramientas. Borrador **no probado** (falta confirmar que las dependencias nativas `better-sqlite3` y `@napi-rs/keyring` funcionen en su entorno):

   ```dockerfile
   FROM node:22-bookworm-slim
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   COPY . .
   RUN npm run build && npm prune --omit=dev
   CMD ["node", "dist/interfaces/cli/bin.js", "mcp"]
   ```

   El servidor responde a `initialize` y `tools/list` sin sesión del SII (lo comprueba `npm run probar:mcp`).
3. Crea un release en GitHub (por ejemplo `v0.1.0`); Glama lo considera en su evaluación.
4. Cuando la ficha muestre las herramientas, se puede agregar la insignia al README:

   ```md
   [![Taksuma-0/mi-sii-mcp MCP server](https://glama.ai/mcp/servers/Taksuma-0/mi-sii-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Taksuma-0/mi-sii-mcp)
   ```

### awesome-mcp-servers (PR #17810 abierto)

PR al README de https://github.com/punkpeye/awesome-mcp-servers, sección «💰 Finance & Fintech», en orden alfabético. Emojis: 📇 (TypeScript), ☁️ (habla con un servicio remoto, el portal del SII) y 🪟 (Windows, la plataforma probada; agregar 🍎 y 🐧 cuando se prueben):

```md
- [Taksuma-0/mi-sii-mcp](https://github.com/Taksuma-0/mi-sii-mcp) [![Taksuma-0/mi-sii-mcp MCP server](https://glama.ai/mcp/servers/Taksuma-0/mi-sii-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Taksuma-0/mi-sii-mcp) 📇 ☁️ 🪟 - Read-only assistant for Chile's tax service (SII): syncs VAT purchase/sales records (RCV), F29, fee receipts (boletas de honorarios) and income tax (F22) into a local SQLite database, then cross-checks them for mismatches and upcoming deadlines.
```

## Imagen para redes (hecho)

GitHub no permite subir la imagen social por API. En el repositorio: **Settings → General → Social preview → Edit → Upload an image** y sube `docs/img/marca/social-preview.png` (1280 × 640). El sitio web ya la usa en Open Graph y Twitter Cards.

## Mantenimiento

- Al cambiar el sitio, actualiza `lastmod` en `docs/sitemap.xml`.
- Mantén alineados los textos del README, `docs/index.html` y `docs/llms.txt` cuando cambien las funcionalidades: el JSON-LD de preguntas frecuentes debe repetir exactamente las preguntas visibles de la página.

## Fuentes (consultadas el 27-10-2026)

- MCP Registry: https://modelcontextprotocol.io/registry/quickstart · https://modelcontextprotocol.io/registry/package-types · https://modelcontextprotocol.io/registry/authentication · https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json · https://github.com/modelcontextprotocol/registry
- Glama: https://glama.ai/mcp/faq · https://glama.ai/mcp/schemas/server.json · https://glama.ai/blog/2025-07-08-what-is-glamajson
- awesome-mcp-servers: https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md
- MCP Market: https://mcpmarket.com/submit · mcpservers.org: https://mcpservers.org/submit · mcp.so: https://mcp.so/submit · PulseMCP: https://www.pulsemcp.com/submit · Smithery: https://smithery.ai/future
- modelcontextprotocol/servers: https://github.com/modelcontextprotocol/servers/blob/main/CONTRIBUTING.md
- Google Search Console: https://support.google.com/webmasters/answer/34592
