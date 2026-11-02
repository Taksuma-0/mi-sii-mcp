# Difusión: buscadores y directorios MCP

Cómo se presenta **mi-sii-mcp** fuera del repositorio: sitio web, Google Search Console y directorios de servidores MCP. Revisado el 2 de noviembre de 2026. Nada de lo que está marcado como «pendiente» se ha enviado ni registrado todavía.

## Estado (02-11-2026)

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
| XERJ Corpus Hub (biblioteca de código que consultan los agentes de programación): página de colaborador publicada el 29-10-2026 (https://hub.xerj.org/contributors/Taksuma-0), con el commit `4c038c1` de mi-sii-mcp seleccionado, y su insignia en el README. Se pueden sumar más repos en https://hub.xerj.org/add | ✅ Hecho |
| npm: `mi-sii-mcp@0.1.0` (15 herramientas) y `mi-sii-mcp@0.2.0` (30 herramientas, `latest`) publicados el 01-11-2026 (https://www.npmjs.com/package/mi-sii-mcp), cada uno con el código de su tag; probados con `npx mi-sii-mcp` en una carpeta limpia | ✅ Hecho |
| MCP Registry oficial: `io.github.Taksuma-0/mi-sii-mcp` 0.1.0 y 0.2.0 publicados el 01-11-2026 (https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Taksuma-0/mi-sii-mcp) | ✅ Hecho |
| Release `v0.1.0` en GitHub (https://github.com/Taksuma-0/mi-sii-mcp/releases/tag/v0.1.0) | ✅ Hecho |
| PR a awesome-mcp-servers, sección Finance & Fintech (https://github.com/punkpeye/awesome-mcp-servers/pull/17810) | ✅ Abierto, en revisión |
| Instalación con npx en el README, la guía y el sitio (antes pedían clonar y compilar) | ✅ Hecho el 02-11-2026 |
| Botones de instalación en un clic para VS Code y Cursor (README y sitio). Probados: la redirección de VS Code entrega `vscode:mcp/install?…` y la página de Cursor responde «Installing MCP Server» | ✅ Hecho |
| Plugin de Claude Code: `.claude-plugin/plugin.json` y `.claude-plugin/marketplace.json` en la raíz (servidor por npx con versión fija y la skill). Validado con `claude plugin validate --strict` e instalado de prueba el 02-11-2026: carga la skill y el servidor se conecta | ✅ Hecho; queda disponible al subir a main |
| Extensión de Gemini CLI: `gemini-extension.json` en la raíz (servidor y skill). Validada con `gemini extensions validate` y probada con `gemini extensions link`: el servidor se conecta | ✅ Hecho; para la galería falta el topic y un tag (ver «Próximos pasos») |
| Codex (OpenAI): instala el mismo plugin desde `.claude-plugin/marketplace.json` (`codex plugin marketplace add Taksuma-0/mi-sii-mcp` y `codex plugin add mi-sii-mcp@mi-sii-mcp`). Probado el 02-11-2026 en una configuración aislada: carga la skill, y su servidor interno levantó el servidor con sus 30 herramientas. El plugin declara `startup_timeout_sec = 120` y `tool_timeout_sec = 900` porque Codex espera 10 s y 60 s por defecto | ✅ Hecho |
| Grok Build (xAI): `grok mcp add`, y lee la configuración, los plugins y las skills de Claude Code. Documentado con su guía oficial; no se probó porque su instalador cambia el PATH e instala su propio Git | ✅ Documentado |
| Guías del sitio para búsquedas concretas: conectar la IA al SII, IVA y F29, boletas de honorarios y Operación Renta 2027, contadores; enlazadas desde el inicio y en `sitemap.xml` | ✅ Hecho; falta pedir su indexación |
| `llms-install.md` (instalación para agentes como Cline) y logo de 400 × 400 (`docs/img/marca/kit/03_PNG_Transparentes/icono_400.png`) | ✅ Hecho |
| Topic `gemini-cli-extension` en lugar de `typescript` (02-11-2026) | ✅ Hecho |
| Cline MCP Marketplace: issue https://github.com/cline/mcp-marketplace/issues/3460 (02-11-2026). La casilla «probado con Cline» quedó sin marcar: no se pudo correr Cline para probarlo | ✅ Enviado, en revisión |
| Bing y demás buscadores de IndexNow: inicio y 4 guías enviados el 02-11-2026 (clave en `docs/<clave>.txt`; Bing respondió 200) | ✅ Hecho |
| `mcp.json` en la raíz, con la misma versión fija, para que cursor.directory detecte el servidor (su detector lee `.mcp.json` o `mcp.json`; Claude Code no lee `mcp.json`) | ✅ Hecho |
| Search Console (sitemap e indexación de las guías), directorio de Anthropic (claude.ai) y cursor.directory | Pendiente: los hace el usuario (ver «Próximos pasos») |

Nota sobre la instalación con npm: `npm ci` (con el `package-lock.json` del repo) intenta compilar `better-sqlite3` con `node-gyp` y falla sin compilador, en Glama y también en Windows; con `--ignore-scripts` usa los binarios precompilados que trae el paquete (`prebuilds/`). Instalar el paquete publicado (`npm install mi-sii-mcp` o `npx mi-sii-mcp`) no compila nada: se probó el 01-11-2026 en una carpeta limpia.

Cómo se publicó en npm (sirve para las versiones siguientes):

1. Se extrae el código del tag con `git archive` en una carpeta aparte, `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, `npm run build` y `npm pack`.
2. Se prueba el `.tgz` instalándolo en una carpeta limpia (`npm install <archivo>.tgz`) y con `initialize` + `tools/list`.
3. `npm login --auth-type=web`, y se publica el mismo `.tgz` desde **una ventana de terminal propia** (cmd): `npm publish <archivo>.tgz --access public --ignore-scripts --auth-type=web`. La cuenta tiene verificación en dos pasos para publicar; sin terminal interactiva npm no espera la verificación en el navegador y termina con `EOTP`.
4. npm responde «Your package is being processed» y muestra por un par de minutos una versión de reserva `0.0.0-stage` («placeholder for staged publishing»); luego aparece la versión real como `latest`. Para probarla al tiro usa `npx --prefer-online`, porque la caché local puede tener la ficha anterior.

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
| `docs/conectar-ia-al-sii/`, `docs/revisar-iva-f29-con-ia/`, `docs/boletas-de-honorarios-y-renta-con-ia/`, `docs/contadores/` | Guías del sitio, una por búsqueda, con `TechArticle`, `BreadcrumbList` y `FAQPage`. Comparten `docs/css/guias.css`. |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | Plugin de Claude Code (y para el directorio de Anthropic): el servidor por `npx -y mi-sii-mcp@<versión> mcp` y la skill de `skills/`. |
| `gemini-extension.json` | Extensión de Gemini CLI: el mismo servidor y la skill. |
| `llms-install.md` | Instrucciones de instalación para agentes (Cline las pide para su marketplace). |
| `test/distribucion.test.ts` | Comprueba que el plugin y la extensión lancen la misma versión exacta que declaran, y que el plugin conserve los plazos que necesita Codex. |

## Textos listos para usar

**GitHub About (descripción, máximo 350 caracteres):**

> 🤖 Servidor MCP para el SII de Chile: conecta Claude, Codex, Cursor o Gemini CLI con tu IVA, F29, F22, boletas de honorarios y renta. Concilia y detecta descuadres y vencimientos. 🔒 Open source, solo lectura y 100 % local: tu clave nunca pasa por el chat.

**Topics de GitHub (máximo 20):** `mcp`, `mcp-server`, `model-context-protocol`, `sii`, `sii-chile`, `chile`, `impuestos`, `tributario`, `iva`, `f29`, `f22`, `renta`, `boletas-de-honorarios`, `claude`, `claude-code`, `codex`, `cursor`, `gemini-cli`, `ai-agents`, `gemini-cli-extension`. (Desde el 02-11-2026, `gemini-cli-extension` reemplaza a `typescript`: la galería de Gemini CLI busca las extensiones por ese topic).

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
| **MCP Registry oficial** (registry.modelcontextprotocol.io) | Sí. | Hecho: 0.1.0 y 0.2.0 publicados el 01-11-2026 con `mcp-publisher` (ver abajo). |
| **Glama** (glama.ai/mcp/servers) | Sí: https://glama.ai/mcp/servers/Taksuma-0/mi-sii-mcp | Hecho: ficha reclamada, Dockerfile, build y release 0.1.0. |
| **MCP Market** (mcpmarket.com) | Sí. | Enviado el 27-10-2026 (cola gratuita, 4–6 semanas). |
| **mcpservers.org** | Sí. | Hecho: aprobado (https://mcpservers.org/servers/taksuma-0/mi-sii-mcp). |
| **XERJ Corpus Hub** (hub.xerj.org) | Sí. | Hecho: página de colaborador (https://hub.xerj.org/contributors/Taksuma-0). |
| **awesome-mcp-servers** (punkpeye) | Sí: pasa los controles de Glama. | PR #17810 abierto (https://github.com/punkpeye/awesome-mcp-servers/pull/17810). |
| **mcp.so** | Sí, en lo técnico. | https://mcp.so/submit; hoy solo se ve una opción de pago. |
| **PulseMCP** | No por ahora: tiene los envíos pausados. | Lo toma desde el Registry oficial cuando reabra. |
| **Smithery** | No recomendable: cierra sus servicios de conexión el 31-10-2026 y para servidores locales exige un paquete `.mcpb`. | — |
| **modelcontextprotocol/servers** | No aplica: ya no acepta servidores nuevos y remite al Registry. | — |
| **Directorio de Anthropic** (claude.ai/directory: claude.ai, Cowork y Claude Code) | Sí: el plugin está en la raíz del repo, con README, licencia e ícono. Su servidor local carga en Cowork y en Claude Code, no en el chat web. | Enviar desde https://claude.ai/directory/manage (requiere plan pagado). Ver «Próximos pasos». |
| **Galería de extensiones de Gemini CLI** (geminicli.com/extensions) | Sí, al cumplir sus requisitos. | Automática: indexa a diario los repos públicos con el topic `gemini-cli-extension`, `gemini-extension.json` en la raíz y un tag. |
| **Directorio de plugins de OpenAI** (ChatGPT y Codex) | No por ahora: los plugins con servidor local («Desktop only») son solo para socios aprobados por OpenAI. | Se instala por el marketplace del repo (ver arriba). |
| **Cline MCP Marketplace** (github.com/cline/mcp-marketplace) | Sí; revisan adopción y credibilidad, con más cuidado en temas financieros. | Enviado: issue #3460, en revisión. |
| **cursor.directory** (comunidad de Cursor) | Sí: detecta el plugin, la skill y el servidor (`mcp.json`). | Entrar con GitHub o Google en https://cursor.directory/plugins/new, pegar la URL del repo y enviar. |
| **Cursor Marketplace** (cursor.com/marketplace) | No por ahora: es para plugins oficiales que revisa el equipo de Cursor. | — |
| **LobeHub** (lobehub.com/mcp) | Sí: indexa más de 100 000 servidores por su cuenta. | Buscar la ficha y reclamarla si aparece. |

## Próximos pasos (los haces tú)

1. ~~Topics de GitHub~~: hecho el 02-11-2026.
2. **Indexación de las guías.** En Search Console, en **Sitemaps**, vuelve a enviar `https://taksuma-0.github.io/mi-sii-mcp/sitemap.xml`. En **Inspección de URLs**, pide la indexación de las cuatro guías:
   - https://taksuma-0.github.io/mi-sii-mcp/conectar-ia-al-sii/
   - https://taksuma-0.github.io/mi-sii-mcp/revisar-iva-f29-con-ia/
   - https://taksuma-0.github.io/mi-sii-mcp/boletas-de-honorarios-y-renta-con-ia/
   - https://taksuma-0.github.io/mi-sii-mcp/contadores/
   Bing ya las recibió por IndexNow (02-11-2026).
3. **Directorio de Anthropic.** Con un plan pagado de claude.ai, entra a https://claude.ai/directory/manage y envía el plugin desde el repositorio `Taksuma-0/mi-sii-mcp` (ruta: la raíz). La revisión retiene los servidores que se lanzan con npx aunque tengan versión fija («Runs a pinned npx or uvx package») y puede revisar el nombre por contener «SII»: el README ya aclara que no es oficial.
4. ~~Cline~~: enviado el 02-11-2026 (issue #3460). Si lo pruebas en Cline y funciona, marca en el issue la casilla de la prueba.
5. **cursor.directory.** Entra a https://cursor.directory/plugins/new con GitHub o Google, pega `https://github.com/Taksuma-0/mi-sii-mcp` y envía: detecta solo el plugin, la skill y el servidor.
6. **Siguiente versión.** Al publicar la 0.3.0, sigue la lista de abajo; su tag hace que la galería de Gemini CLI indexe la extensión.

### Al publicar una versión nueva

1. `npm run version:fijar -- X.Y.Z` pone la versión en `package.json`, `package-lock.json`, `server.json`, el plugin, la extensión, `mcp.json` y el sitio. La prueba `test/distribucion.test.ts` exige que coincidan.
2. Commit y push a `main`. El workflow «Pruebas» corre los tipos, las pruebas y el servidor compilado en Windows, macOS y Linux.
3. `git tag vX.Y.Z` y `git push origin vX.Y.Z`. El workflow «Publicar» repite las pruebas, publica en npm con *trusted publishing* (sin códigos y con procedencia verificada) y en el MCP Registry (con el OIDC de GitHub), y crea el release. Glama toma el release solo y la galería de Gemini CLI indexa el tag.
4. Si npm o el registro fallan, el plugin y la extensión quedan apuntando a una versión que npm aún no tiene: corrige y vuelve a correr el workflow, o publica a mano con los pasos de arriba.

Para ensayar sin publicar, corre «Publicar» desde la pestaña Actions con «Ensayo» marcado.

Requisito único: que el paquete en npm confíe en el workflow. Se configura una vez con verificación en dos pasos: `npm trust github mi-sii-mcp --file publicar.yml --repo Taksuma-0/mi-sii-mcp --yes`.

## Textos para redes

**LinkedIn (contadores y pymes):**

> Hice mi-sii-mcp, una herramienta gratuita y de código abierto que conecta tu asistente de IA (Claude, Codex, Gemini, Grok, Cursor) con tu información del SII. Le preguntas «¿cuadra mi IVA con el F29?», «¿tengo F29 por vencer?» o «¿qué informaron mis pagadores sobre mis boletas?» y responde con tus datos reales: los trae del SII, los guarda en tu equipo y los concilia. Solo lee el SII y la clave nunca pasa por el chat. Para contadores: una vista de toda la cartera, conciliación de cartolas, y libros y asientos exportables a Excel. https://taksuma-0.github.io/mi-sii-mcp/

**Reddit u otros foros (revisa antes las reglas de autopromoción de cada comunidad):**

> Título: Hice un conector gratuito para que la IA revise tu IVA, F29 y boletas de honorarios del SII
>
> Es un servidor MCP de código abierto: tu asistente (Claude, Codex, Gemini CLI, Grok, Cursor) lee tus datos del SII en solo lectura, los guarda en tu equipo y los cruza (RCV contra F29, boletas contra lo informado por tus pagadores, vencimientos). Se instala con un comando de npx. No es oficial del SII ni asesoría tributaria; busco comentarios de quienes lo prueben. https://github.com/Taksuma-0/mi-sii-mcp

### MCP Registry oficial (hecho: 0.1.0 y 0.2.0)

`mi-sii-mcp@0.1.0` se publicó en npm y en el Registry el 01-11-2026, con `mcp-publisher` v1.8.7 (binario de https://github.com/modelcontextprotocol/registry/releases). `mcp-publisher login github` entrega un código para https://github.com/login/device; si caduca, se lanza de nuevo. El nombre en el Registry distingue mayúsculas y debe usar el usuario exacto de GitHub: `io.github.Taksuma-0/mi-sii-mcp`.

1. Crea una cuenta en npm e inicia sesión: `npm login`.
2. Publica: `npm publish` (el script `prepublishOnly` corre los tipos, las pruebas y la compilación). Las versiones publicadas no se pueden reutilizar.
3. Instala `mcp-publisher` (https://modelcontextprotocol.io/registry/quickstart) e inicia sesión con GitHub: `mcp-publisher login github`.
4. Valida y publica desde la raíz del repo: `mcp-publisher validate` y `mcp-publisher publish`.
5. Comprueba: `https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Taksuma-0/mi-sii-mcp`.

En cada versión nueva, sigue «Al publicar una versión nueva» (arriba).

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
- Mantén alineados los textos del README, `docs/index.html`, las guías y `docs/llms.txt` cuando cambien las funcionalidades: el JSON-LD de preguntas frecuentes de cada página debe repetir exactamente las preguntas y respuestas visibles.
- Las guías describen lo que hace la versión publicada en npm: no anuncies ahí funciones que todavía no están publicadas.

## Fuentes (consultadas el 27-10-2026)

- MCP Registry: https://modelcontextprotocol.io/registry/quickstart · https://modelcontextprotocol.io/registry/package-types · https://modelcontextprotocol.io/registry/authentication · https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json · https://github.com/modelcontextprotocol/registry
- Glama: https://glama.ai/mcp/faq · https://glama.ai/mcp/schemas/server.json · https://glama.ai/blog/2025-07-08-what-is-glamajson
- awesome-mcp-servers: https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md
- MCP Market: https://mcpmarket.com/submit · mcpservers.org: https://mcpservers.org/submit · mcp.so: https://mcp.so/submit · PulseMCP: https://www.pulsemcp.com/submit · Smithery: https://smithery.ai/future
- modelcontextprotocol/servers: https://github.com/modelcontextprotocol/servers/blob/main/CONTRIBUTING.md
- Google Search Console: https://support.google.com/webmasters/answer/34592
