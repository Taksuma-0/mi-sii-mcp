---
name: mi-sii-mcp
description: Consulta y concilia la información tributaria del SII de Chile con el servidor MCP mi-sii-mcp (IVA, Registro de Compras y Ventas, F29, renta F22, boletas de honorarios, declaraciones juradas de terceros, anotaciones de Mi SII y vencimientos), estima el F29 y la renta, concilia cartolas del banco, arma libros y asientos, y muestra formas legales de pagar menos impuestos. Úsala cuando la persona pregunte por sus impuestos chilenos, el SII, IVA, F29, F22, renta, devolución, boletas de honorarios, retenciones, PPM, plazos, anotaciones, banco, contabilidad, régimen Pro Pyme o ahorro tributario, o quiera cruzar sus registros tributarios. Use it for Chilean SII tax questions (VAT, F29, F22 income tax, fee receipts, bookkeeping, legal tax savings).
---

# mi-sii-mcp: impuestos del SII con datos reales

Esta skill te enseña a usar las herramientas del servidor MCP **mi-sii-mcp** para responder preguntas tributarias de Chile con los datos reales de la persona, conciliarlos y explicar el resultado con claridad. Funciona con cualquier agente que tenga el servidor conectado (en Claude Code las herramientas aparecen como `mcp__mi-sii-mcp__<herramienta>`).

Si las herramientas no están disponibles, dile a la persona que instale y registre el servidor: https://github.com/Taksuma-0/mi-sii-mcp#instalación.

## Reglas que no se rompen

1. **Nunca pidas la clave tributaria ni la ClaveÚnica** y nunca intentes iniciar sesión. Ante `SESION_REQUERIDA`, `CLAVE_RECHAZADA` o `RUT_BLOQUEADO_LOCAL`, usa `cuenta_conectar`: abre en el navegador de la persona la página local donde conecta su cuenta (RUT y clave tributaria, o ClaveÚnica). Después reintenta.
2. **Solo lectura.** mi-sii-mcp no presenta declaraciones, no emite documentos ni paga nada. Si la persona quiere presentar un F29 o emitir una boleta, explícale que debe hacerlo en el portal del SII.
3. **No es asesoría tributaria.** Entrega cifras y hallazgos verificables; recomienda confirmar decisiones con un contador cuando haya dinero en juego.
4. **Reintentos:** reintenta solo si el error dice «Reintentar: ahora mismo» o «más tarde» (o lista «Reintentables más tarde»). Con «Reintentar: no», sigue la acción indicada.
5. **Datos públicos con fuente.** UTM, tablas de impuestos, tasas de cotización o comisiones de AFP no están guardados: usa `fuentes_oficiales` y cita la página oficial del año que corresponda.
6. **Privacidad.** Lo que consultes pasa a la conversación. Muestra solo lo necesario para responder y no repitas RUT ni nombres de terceros si no hacen falta.
7. **Ahorro solo legal.** Explica las oportunidades con su norma y su enlace oficial. Nunca sugieras simular gastos, compras ni contratos: es elusión o fraude. Las estimaciones y simulaciones son eso: dilo.

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
| Régimen, autorización del día 20 y empresas | `perfil_sincronizar` | Hazlo antes de hablar de vencimientos del F29 o de simular régimen. |
| Anotaciones vigentes y cumplimiento en Mi SII | `sii_avisos` | Solo con la sesión propia del RUT; registra cada anotación como aviso. |

Si una sincronización falla o algo no cuadra, `diagnostico` muestra la salud de mi-sii-mcp: sesiones, fallas que la revisión diaria reintentará y cambios detectados del portal del SII (incluidos los nombres de campos que se adaptaron solos). Las respuestas grandes vienen resumidas: pide `detalle: true` solo si necesitas todo.

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

**Estimar el F29 antes de declararlo**
`f29_estimar` (rut, periodo). Sin la UTM de los dos meses el remanente no se reajusta: dilo o pídelas (página de la UTM en `fuentes_oficiales`). Si el F29 está atrasado, el portal del SII calcula los recargos al declarar.

**Estimar la renta o una devolución**
1. `renta_resumen` para los datos de la persona.
2. `fuentes_oficiales` con `regla: true` para la regla de cálculo y las páginas oficiales.
3. Con los datos públicos del año, `renta_estimar`; **marca el resultado como estimación** e indica qué valores son provisionales si el año aún no tiene tablas publicadas.

**Banco y contabilidad**
`banco_importar` (o la página local) → `banco_conciliar` del rango: pregunta qué son los movimientos sin conciliar antes de asignarlos o descartarlos → `cuentas_pendientes` → `contabilidad_libro`, `contabilidad_asientos` y `contabilidad_resultado` (con `exportar` si los quiere en Excel). La receta `cierre_contable` lo encadena.

**Seguimiento y varias cuentas**
`novedades` para los avisos de la revisión diaria (se activa en la página local), `cartera_estado` para ver todas las cuentas y `sii_avisos` para las anotaciones de Mi SII.

**Pagar menos, legalmente**
`ahorro_oportunidades` → para una empresa, `cierre_proyectar` del año y `regimen_simular` con los socios (usa la base del F22 si existe); para una persona, `renta_estimar` con y sin `apv_regimen_b` o `gastos_efectivos`. Ordena por monto y di qué falta para confirmar cada una.

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
| Sincronizador (uno solo) | Trae del SII lo que falte, en tramos, uno tras otro | `sincronizar`, `renta_sincronizar`, `perfil_sincronizar`, `sii_avisos` |
| Analistas (en paralelo) | Analizan datos ya guardados, por mes, año, RUT o tema | `iva_resumen`, `iva_hallazgos`, `f29_historial`, `rcv_documentos`, `renta_resumen`, `plazos_proximos`, `f29_estimar`, `renta_estimar`, `contabilidad_*`, `cuentas_pendientes`, `ahorro_oportunidades`, `consulta_sql` |
| Revisor | Comprueba cifras y conclusiones contra los hallazgos y las fuentes oficiales | `iva_hallazgos`, `consulta_sql`, `fuentes_oficiales` |

Patrones y ejemplos en [references/multiagente.md](references/multiagente.md).

## Cómo presentar las respuestas

Las herramientas ya responden con esta plantilla. Úsala también en tu respuesta, en este orden:

1. **Conclusión con ícono** en la primera línea: ✅ cuadra o al día, ⚠️ revisar, ⛔ urgente, ℹ️ falta un dato.
2. **Tabla corta** con los montos que importan. No copies el JSON de la herramienta.
3. **Hallazgos**, cada uno con su ícono, del más grave al más leve. Si no hay, dilo en una línea.
4. **Siguientes pasos** en una línea, con lo que conviene pedir después.
5. **La fecha de los datos** (cada respuesta trae la fecha de lectura) y qué no se consultó.

Además:

- Montos en pesos chilenos con separador de miles (`$1.234.567`); períodos como `2026-09`; años tributarios como «AT2027 (renta del año 2026)».
- Si un dato falta o el SII respondió vacío, dilo; nunca lo rellenes con supuestos.
- Si la persona quiere verlo en grande, imprimirlo o guardarlo como PDF, ofrece `informe_visual`: arma un HTML con lo guardado y lo abre en su navegador. No consulta el SII y los datos no salen del equipo.

Ejemplo con datos ficticios:

> ⚠️ IVA 2026-09 de 22.222.222-2: el crédito del RCV no coincide con el del F29.
>
> | Concepto | RCV | F29 |
> | --- | --- | --- |
> | Débito | $1.234.567 | $1.234.567 |
> | Crédito | $722.000 | $700.000 |
>
> ⚠️ El F29 declara $22.000 menos de crédito que las compras del RCV: puede ser una factura que llegó tarde o un crédito que no se usó.
>
> Siguientes pasos: rcv_documentos de compras para ubicar la diferencia · plazos_proximos. Datos del RCV y del F29 al 2026-10-21.
>
> Si quieres, lo veo en un informe visual.
