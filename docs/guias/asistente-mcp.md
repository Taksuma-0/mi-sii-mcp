# Usar impuestocl con un asistente (MCP)

Con esta guía, Claude (Claude Code o Claude Desktop) puede traer tus datos del SII a tu equipo, cruzarlos entre meses y contrapartes, y responder preguntas como «¿cómo evolucionó mi remanente de IVA en los últimos tres años?». Tú preguntas en lenguaje natural; el asistente usa las herramientas de impuestocl para hacer el trabajo.

Qué hace cada parte:

- **impuestocl** descarga tus datos desde el SII (RCV, F29 y más; ver la cobertura abajo), los guarda en tu equipo y responde consultas de solo lectura sobre ellos.
- **El asistente** decide qué consultar, escribe las consultas y te explica el resultado.
- **Tú** inicias sesión en el SII una sola vez, en tu propia terminal. La clave tributaria no se escribe nunca en el chat y ninguna herramienta del asistente la recibe.

Cobertura actual:

- **RCV** (compras y ventas) y **F29** (declaraciones presentadas, con sus códigos).
- **Propuesta de F29** del SII: crédito, remanente y retención propuestos; no trae débito ni total a pagar.
- **Boletas de honorarios recibidas**, con su retención, que se cruza con el código 151 del F29.
- **Renta anual (F22)** por año tributario: declaraciones, conclusión del SII, códigos con su glosa, observaciones y eventos.
- **Perfil tributario** (si el SII autoriza declarar el F29 hasta el día 20, régimen, segmento) y **empresas autorizadas** de la cuenta.

No incluye carpeta tributaria, deuda en la Tesorería, otros impuestos ni otras áreas del portal, ni emite ni presenta nada en el SII: solo lee. Esta herramienta no es oficial, no está afiliada al SII y no es asesoría tributaria.

Todo se ejecuta en PowerShell, en la carpeta del proyecto: `C:\ruta\a\mi-sii-mcp`.

## 1. Compilar

```powershell
cd 'C:\ruta\a\mi-sii-mcp'
npm.cmd run build
```

Esto genera la carpeta `dist`. El asistente ejecuta ese código compilado, no el código fuente. Para comprobar que quedó bien:

```powershell
npm.cmd run probar:mcp
```

Debe terminar con una línea que empieza con `OK`. La prueba usa una carpeta temporal y no entra al SII ni toca tus datos.

## 2. Registrar el servidor en Claude Code

```powershell
claude mcp add --scope user impuestocl -- node "C:\ruta\a\mi-sii-mcp\dist\interfaces\cli\bin.js" mcp
```

`--scope user` lo deja disponible en cualquier carpeta y sesión de Claude Code, no solo dentro del proyecto. Se usa `node` con la ruta completa, así que no hace falta instalar nada de forma global.

Comprueba que quedó conectado:

```powershell
claude mcp list
```

Debe aparecer `impuestocl` con `✔ Connected`. Dentro de una sesión de Claude Code, `/mcp` muestra lo mismo y deja reconectar.

Una sesión de Claude Code que ya estaba abierta no ve las herramientas nuevas hasta que la reinicies o ejecutes `/mcp` para reconectar.

## 3. Iniciar sesión en el SII (una sola vez)

En tu propia terminal, no en el chat:

```powershell
node "C:\ruta\a\mi-sii-mcp\dist\interfaces\cli\bin.js" login <tu RUT> --guardar-clave
```

Reemplaza `<tu RUT>` por el RUT del contribuyente, con o sin puntos. El programa te pide la clave tributaria con la escritura oculta y hace **un solo intento**: si el SII la rechaza, no reintenta. El login también registra el perfil (si no existía, con el nombre que informa el SII como alias), así que después el RUT aparece en `perfiles_listar`.

Qué implica `--guardar-clave`:

- La clave queda guardada en el **Administrador de credenciales de Windows**, bajo el servicio `impuestocl` (en la lista aparece una entrada cuyo nombre contiene `impuestocl`). No se guarda en archivos del proyecto ni en la base de datos.
- Con la clave guardada, cuando la sesión del SII vence, impuestocl inicia una nueva sola. No tienes que volver a la terminal cada vez que expire.
- Quien use tu cuenta de Windows podría usar esa clave guardada. Si prefieres no guardarla, omite `--guardar-clave`: cuando la sesión venza, tendrás que repetir el login.
- Para olvidarla en cualquier momento:

  ```powershell
  node "C:\ruta\a\mi-sii-mcp\dist\interfaces\cli\bin.js" logout <tu RUT> --olvidar-clave
  ```

  Esto cierra la sesión local y borra la clave del Administrador de credenciales.

Si el asistente necesita sesión y no hay una válida, te mostrará este mismo comando con tu RUT para que lo ejecutes tú. También sirve entrar por **Abrir impuestocl.cmd** (ver `docs/guias/interfaz-local.md`): esa interfaz no guarda la clave, pero el asistente toma la sesión nueva sin reiniciarse. Si el SII rechazó una clave, impuestocl bloquea ese RUT localmente hasta que hagas un login correcto, para no seguir intentando con una clave incorrecta.

## 4. Qué puedes preguntar

Escribe en el chat de Claude como lo harías con una persona. Algunos ejemplos:

- «¿Qué contribuyentes tengo configurados y qué meses hay guardados de cada uno?»
- «Trae el RCV y el F29 de 2024 a hoy.» El asistente descarga por tramos de 12 meses y te va informando el avance.
- «Revisa el IVA de septiembre de 2026 y dime qué hallazgos hay.»
- «¿En qué meses el crédito del F29 no coincide con el RCV?»
- «Muéstrame mes a mes cómo evolucionaron el remanente y el total a pagar del F29 en los últimos tres años.»
- «¿Qué proveedores concentran más de la mitad de mis compras de 2026? Dame el detalle por mes.»
- «Cruza mis ventas con mis compras: ¿qué contrapartes aparecen en ambos lados y cuánto suman?»
- «¿Qué facturas recibidas están pendientes y cuándo vence su plazo de reclamo?»
- «¿Qué plazos tengo en los próximos 30 días?»
- «Trae las boletas de honorarios recibidas de 2026 y dime si la retención que declaré en el F29 (código 151) coincide con la de las boletas.» (`sincronizar` con la superficie `bhe`, luego `iva_hallazgos` y `f29_historial`).
- «Trae la propuesta de F29 de septiembre y compárala con lo que declaré.» (superficie `propuesta`).
- «Muéstrame mi renta de los años tributarios 2024 a 2026: conclusión, impuesto pagado y remanente.» (`renta_sincronizar`, luego `renta_resumen`; el año tributario es el año comercial + 1).
- «Sincroniza mi perfil y dime si el SII me autoriza a declarar hasta el día 20.» (`perfil_sincronizar`).

Cómo trabaja el asistente: para los cálculos de IVA, retenciones y plazos usa herramientas que aplican las reglas del dominio (`iva_resumen`, `iva_hallazgos`, `f29_historial`, `plazos_proximos`) y, para la renta, `renta_resumen`. Para cruces y preguntas libres lee primero el mapa de las tablas (`datos_esquema`) y luego escribe consultas de solo lectura (`consulta_sql`) sobre una **copia** de tus datos, así que no puede modificar la base real. Cada respuesta tiene un tope de 200 filas y 40 000 caracteres: si una pregunta es muy amplia, el asistente agrupa o filtra.

Una ausencia de filas no significa cero: puede ser un mes que nunca se descargó. Pídele que lo distinga con la bitácora de sincronización.

Si un F29 leído no cuadra, o tras actualizar impuestocl, pídele «relee mis F29 guardados»: `f29_releer` vuelve a leer los PDF ya descargados con el lector actual, sin entrar al SII (en la terminal, `releer-f29 <tu RUT>`).

### Herramientas (14)

| Herramienta | Para qué sirve | ¿Va al SII? |
| --- | --- | --- |
| `perfiles_listar` | Contribuyentes configurados y estado de su sesión. | No |
| `sii_panorama` | Qué hay guardado por mes (y renta por año) para un RUT. | No |
| `sincronizar` | Trae RCV y F29 de un rango de meses; con `superficies` agrega `propuesta` y `bhe`. Por defecto solo `rcv` y `f29`. | Sí (lee) |
| `perfil_sincronizar` | Perfil tributario y empresas autorizadas. | Sí (lee) |
| `renta_sincronizar` | F22 por año tributario (hasta 10 años por llamada). | Sí (lee) |
| `iva_resumen`, `iva_hallazgos`, `f29_historial`, `plazos_proximos` | IVA, conciliación, retenciones y vencimientos con las reglas del dominio. | No |
| `renta_resumen` | La renta guardada por año tributario. | No |
| `rcv_documentos` | Documentos del RCV de un mes, paginados. | No |
| `f29_releer` | Relee los PDF de F29 ya guardados con el lector actual. | No |
| `datos_esquema`, `consulta_sql` | Mapa de las tablas y consultas `SELECT` de solo lectura. | No |

Qué puede cambiar el estado local: `perfil_sincronizar` reemplaza a quién representa el perfil (`representa`) por las empresas activas que informa el SII, de modo que lo que anotaste a mano se sobrescribe. De las empresas autorizadas se guarda también la razón social, que puede ser el nombre de una persona. Los hallazgos guardados se recalculan al pedir `iva_resumen` o `iva_hallazgos`, por lo que pueden quedar desfasados después de `perfil_sincronizar` (por ejemplo, el plazo del F29 depende del día 20) hasta que se vuelvan a pedir.

**Qué se sincroniza por defecto.** `sincronizar` trae solo `rcv` y `f29` si no indicas superficies: la propuesta y las boletas de honorarios son opcionales porque cada una agrega consultas al SII por mes. Pídelas expresamente («incluye las boletas de honorarios»). La renta y el perfil tienen su propia herramienta.

**Errores y reintentos.** Cada error trae una línea «Reintentar: ahora mismo», «Reintentar: más tarde» o «Reintentar: no», y una sincronización parcial lista los «Reintentables más tarde». El asistente solo vuelve a intentar lo que dice «ahora mismo» o «más tarde»; con «no», repetirlo igual no lo resuelve y sigue la acción indicada. Si falta sesión, te mostrará el comando de login para que lo ejecutes tú.

Los resultados de las herramientas pasan a la conversación con el asistente, igual que cualquier cosa que le muestres. Pregunta solo por los contribuyentes que estés dispuesto a comentar en ese chat.

## 5. Claude Desktop

Si usas Claude Desktop en vez de Claude Code, agrega el servidor a su archivo de configuración (en Claude Desktop: Configuración → Desarrollador → Editar configuración; normalmente es `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "impuestocl": {
      "command": "node",
      "args": ["C:\\ruta\\a\\mi-sii-mcp\\dist\\interfaces\\cli\\bin.js", "mcp"]
    }
  }
}
```

Si el archivo ya tiene otros servidores, agrega solo la entrada `impuestocl` dentro de `mcpServers`. Reinicia Claude Desktop por completo para que lo cargue. El login (sección 3) se hace igual, en tu terminal.

## 6. Cuidados al usarlo

- **No sincronices el mismo RUT desde dos lugares a la vez**, por ejemplo la interfaz de **Abrir impuestocl.cmd** y el asistente. Cada uno coordina sus descargas por separado y dos descargas simultáneas del mismo RUT pueden pisarse. Espera a que termine una antes de iniciar la otra.
- Los datos están al día hasta la última sincronización. Si necesitas cifras recientes, pide primero que sincronice el rango que te interesa.
- Las cifras y los hallazgos son una ayuda para revisar tu información, no asesoría tributaria. Contrástalos con el SII o con tu contador antes de declarar o pagar.

## 7. Si algo falla

- **`claude mcp list` muestra un error en `impuestocl`** (o la conexión se cae al abrir Claude): ejecuta el servidor a mano para ver el mensaje real.

  ```powershell
  node "C:\ruta\a\mi-sii-mcp\dist\interfaces\cli\bin.js" mcp
  ```

  Si todo está bien, escribe «impuestocl: servidor MCP listo (stdio).» y queda esperando: cierra con Ctrl+C. Si hay un problema, imprime el error y termina.
- **Actualizaste Node a otra versión mayor** (por ejemplo, de 22 a 24): el módulo nativo de la base de datos hay que reconstruirlo y volver a compilar el proyecto.

  ```powershell
  cd 'C:\ruta\a\mi-sii-mcp'
  npm.cmd rebuild better-sqlite3
  npm.cmd run build
  ```

- **Una consulta al SII tarda demasiado y se corta**: cada petición HTTP tiene un plazo de 60 segundos por defecto. Se puede cambiar con la variable de entorno `IMPUESTOCL_PLAZO_HTTP_MS` (en milisegundos; se acota entre 10 000 y el máximo del programa). En Claude Code se define al registrar el servidor, por ejemplo: `claude mcp add --scope user --env IMPUESTOCL_PLAZO_HTTP_MS=120000 impuestocl -- node "<ruta>\dist\interfaces\cli\bin.js" mcp` (si ya estaba registrado, quítalo antes; ver sección 8). En Claude Desktop se agrega un bloque `"env": { "IMPUESTOCL_PLAZO_HTTP_MS": "120000" }` a la entrada `impuestocl`.
- **Respaldo de la base**: antes de migrar el esquema de la base a una versión nueva (por ejemplo, tras actualizar impuestocl), el programa guarda una copia íntegra junto a ella, con el nombre `impuestocl-antes-v<N>.db`, en la carpeta `.impuestocl`. Si la copia falla, la migración no se aplica y verás el error `RESPALDO_FALLIDO`. Las copias contienen tus datos: bórralas cuando ya no las necesites.
- **`node` debe estar en el PATH, versión 22.12 o superior.** Compruébalo en una terminal nueva con `node --version`. Esto vale también para Claude Desktop: lanza `node` con el PATH de Windows, así que reinícialo por completo después de instalar o actualizar Node.
- **No encuentras «Abrir impuestocl.cmd»**: está en la carpeta del proyecto, `C:\ruta\a\mi-sii-mcp\Abrir impuestocl.cmd`. Haz doble clic para abrir la interfaz local (ver `docs/guias/interfaz-local.md`).

## 8. Quitar el registro

```powershell
claude mcp remove --scope user impuestocl
```

Esto desconecta al asistente. No borra tus datos guardados ni tu clave: para la clave, usa `logout <tu RUT> --olvidar-clave` (sección 3). Tus datos locales están en la carpeta `.impuestocl` de tu usuario de Windows. En Claude Desktop, borra la entrada `impuestocl` del archivo de configuración y reinicia la aplicación.

## 9. Actualizar el código

Cada vez que cambie el código del proyecto (por ejemplo, tras bajar una versión nueva), recompila:

```powershell
cd 'C:\ruta\a\mi-sii-mcp'
npm.cmd run build
npm.cmd run probar:mcp
```

El registro en Claude Code apunta a la carpeta `dist`, así que no hay que registrarlo de nuevo. Reinicia Claude Code, o usa `/mcp` para reconectar, para que cargue la versión compilada.
