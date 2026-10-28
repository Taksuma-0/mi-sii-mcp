---
name: mi-sii-mcp
description: Consulta y concilia la información tributaria del SII de Chile con el servidor MCP mi-sii-mcp (IVA, Registro de Compras y Ventas, F29, renta F22, boletas de honorarios, declaraciones juradas de terceros y vencimientos). Úsala cuando la persona pregunte por sus impuestos chilenos, el SII, IVA, F29, F22, renta, devolución, boletas de honorarios, retenciones, PPM, plazos o vencimientos, o quiera cruzar sus registros tributarios. Use it for Chilean SII tax questions (VAT, F29, F22 income tax, fee receipts).
---

# mi-sii-mcp: impuestos del SII con datos reales

Esta skill te enseña a usar las herramientas del servidor MCP **mi-sii-mcp** para responder preguntas tributarias de Chile con los datos reales de la persona, conciliarlos y explicar el resultado con claridad. Funciona con cualquier agente que tenga el servidor conectado (en Claude Code las herramientas aparecen como `mcp__mi-sii-mcp__<herramienta>`).

Si las herramientas no están disponibles, dile a la persona que instale y registre el servidor: https://github.com/Taksuma-0/mi-sii-mcp#instalación.

## Reglas que no se rompen

1. **Nunca pidas la clave tributaria ni la ClaveÚnica** y nunca intentes iniciar sesión. Ante `SESION_REQUERIDA`, `CLAVE_RECHAZADA` o `RUT_BLOQUEADO_LOCAL`, indica a la persona que abra «Abrir mi-sii-mcp.cmd» (o `npm run local`) y conecte su cuenta ahí; después reintenta.
2. **Solo lectura.** mi-sii-mcp no presenta declaraciones, no emite documentos ni paga nada. Si la persona quiere presentar un F29 o emitir una boleta, explícale que debe hacerlo en el portal del SII.
3. **No es asesoría tributaria.** Entrega cifras y hallazgos verificables; recomienda confirmar decisiones con un contador cuando haya dinero en juego.
4. **Reintentos:** reintenta solo si el error dice «Reintentar: ahora mismo» o «más tarde» (o lista «Reintentables más tarde»). Con «Reintentar: no», sigue la acción indicada.
5. **Datos públicos con fuente.** UTM, tablas de impuestos, tasas de cotización o comisiones de AFP no están guardados: usa `fuentes_oficiales` y cita la página oficial del año que corresponda.
6. **Privacidad.** Lo que consultes pasa a la conversación. Muestra solo lo necesario para responder y no repitas RUT ni nombres de terceros si no hacen falta.

## Primeros pasos en cada conversación

1. `perfiles_listar` → qué RUT hay, si son persona o empresa y si su sesión está activa.
2. `sii_panorama` del RUT → qué meses y años hay guardados.
3. Si falta información o está vieja, sincroniza (ver «Traer datos del SII»). Si ya está, responde con las herramientas locales, que no consultan al SII.

Para una **persona sin IVA** (solo boletas de honorarios o sueldo), parte por la renta (`renta_sincronizar` y `renta_resumen`) en vez de RCV y F29.

## Traer datos del SII

| Necesito | Herramienta | Notas |
| --- | --- | --- |
| Compras, ventas y F29 de meses | `sincronizar` | `rut`, `desde` y `hasta` (AAAA-MM). Por defecto trae `rcv` y `f29`; agrega `superficies: ["propuesta"]` o `["bhe"]` solo si se necesitan. Tramos de **hasta 12 meses** e informa el avance tras cada tramo. |
| Renta F22, boletas emitidas y lo que informan terceros | `renta_sincronizar` | `desde`/`hasta` son **años tributarios** (año comercial + 1): las boletas de 2026 están en el AT2027. |
| Régimen, autorización del día 20 y empresas | `perfil_sincronizar` | Hazlo antes de hablar de vencimientos del F29. |

## Recetas por tarea

**Revisión mensual del IVA (empresa)**
`sincronizar` el mes → `iva_resumen` (rut, periodo) → `iva_hallazgos` del mes → `plazos_proximos`. Responde con débito, crédito, remanente y total del F29, y los hallazgos ordenados por severidad (`critico`, `advertencia`, `info`).

**Historial y tendencias**
Sincroniza por tramos → `f29_historial` (desde, hasta) para la evolución mes a mes; para cruces más finos, `datos_esquema` una vez y luego `consulta_sql`.

**Documentos de un mes**
`rcv_documentos` (rut, periodo; filtros `lado` COMPRA/VENTA, `estado`, `tipo_doc`, `rut_contraparte`, `pagina`). Útil para facturas por reclamar o un proveedor puntual.

**Boletas de honorarios y retenciones**
`renta_sincronizar` del año tributario → `renta_resumen`: boletas emitidas por mes y por pagador, retención, y su cruce con el F22 (códigos 547 y 492, que vienen reajustados por IPC: una diferencia de 0 % a 10 % es normal). Las boletas recibidas vienen con `sincronizar` y `superficies: ["bhe"]` y se cruzan con el código 151 del F29.

**Lo que otros informaron al SII**
`renta_resumen` muestra las declaraciones juradas de terceros (por ejemplo, retenciones de honorarios) y avisa si el SII observó la declaración de un informante. Explica que una observación del SII al informante no es un error de la persona.

**Estimar la renta o una devolución**
1. `renta_resumen` para los datos de la persona.
2. `fuentes_oficiales` con `regla: true` para la regla de cálculo y las páginas oficiales.
3. Consulta esas páginas, calcula y **marca el resultado como estimación**, indicando qué valores son provisionales si el año aún no tiene tablas publicadas.

**Vencimientos**
`perfil_sincronizar` (si no se ha hecho) → `plazos_proximos` (opcional `dias`). El F29 vence el día 12, 20 o 28 según autorización y si hay pago.

**Un F29 que no cuadra**
`f29_releer` relee los PDF guardados con el lector actual, sin ir al SII. Luego vuelve a revisar `iva_resumen`.

**Preguntas libres**
`datos_esquema` una sola vez → `consulta_sql` con un único `SELECT` (o `WITH … SELECT`): filtra por RUT y período, agrupa o usa `LIMIT` (máximo 200 filas).

El detalle de parámetros está en [references/herramientas.md](references/herramientas.md).

## Varios agentes trabajando juntos

mi-sii-mcp funciona bien con subagentes si respetas una regla: **solo un agente consulta el SII a la vez**. El SII limita las sesiones simultáneas (`SII_SESIONES_MAXIMAS`) y la frecuencia de consultas (`SII_LIMITE`), y el servidor ya espacia sus peticiones. Las herramientas locales, en cambio, se pueden usar en paralelo sin riesgo.

| Rol | Hace | Herramientas |
| --- | --- | --- |
| Coordinador | Entiende la pregunta, revisa perfiles y lo guardado, reparte el trabajo y redacta la respuesta final | `perfiles_listar`, `sii_panorama` |
| Sincronizador (uno solo) | Trae del SII lo que falte, en tramos, uno tras otro | `sincronizar`, `renta_sincronizar`, `perfil_sincronizar` |
| Analistas (en paralelo) | Analizan datos ya guardados, por mes, año, RUT o tema | `iva_resumen`, `iva_hallazgos`, `f29_historial`, `rcv_documentos`, `renta_resumen`, `plazos_proximos`, `consulta_sql` |
| Revisor | Comprueba cifras y conclusiones contra los hallazgos y las fuentes oficiales | `iva_hallazgos`, `consulta_sql`, `fuentes_oficiales` |

Patrones y ejemplos en [references/multiagente.md](references/multiagente.md).

## Cómo responder

- Montos en pesos chilenos con separador de miles (`$1.234.567`); períodos como `2026-09`; años tributarios como «AT2027 (renta del año 2026)».
- Di de cuándo son los datos (cada respuesta trae la fecha de lectura) y qué no se consultó.
- Primero la conclusión en una frase, luego una tabla corta con las cifras y, al final, los pasos sugeridos.
- Si un dato falta o el SII respondió vacío, dilo; nunca lo rellenes con supuestos.
