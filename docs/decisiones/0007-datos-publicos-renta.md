# 0007 — Datos públicos de la renta: fuentes oficiales

Fecha: 27 de octubre de 2026. Estado: decidido; las URL de la tabla se abrieron y revisaron el 27/10/2026.

## Decisión

impuestocl **no guarda parámetros públicos de la renta** (UTM/UTA, tramos y tasas, IMM, porcentajes de retención o de cobertura, comisiones, tasa del SIS, topes). Las herramientas que estimen el F22 los reciben **como argumentos**. En su descripción dicen de qué página oficial sale cada uno, para que quien las llame (la persona o el asistente vía MCP) los consulte allí y los pase.

Razones: los valores cambian cada año, y a veces dentro del año, por ley, licitación o reajuste. Si quedan copiados en el código, se desactualizan sin que nadie lo note. Además, las fuentes no siempre coinciden entre sí. Por ejemplo, la tasa del SIS que se usa en la Operación Renta no es la vigente en el mes en que se paga. Es mejor que la cifra venga siempre de la fuente oficial del año que se calcula.

## Dónde consultar cada parámetro

Solo se incluyen URL abiertas y verificadas el 27/10/2026.

| Parámetro | URL oficial | Qué buscar en esa página |
|---|---|---|
| UTM y UTA por mes | https://www.sii.cl/valores_y_fechas/utm/utm2025.htm (cambiar el año en la URL, p. ej. `utm2026.htm`) | Fila de **diciembre** del año comercial (UTM y UTA = 12 × UTM). Los montos del F22 se expresan en la UTA de diciembre. Si diciembre aún no está publicado, la fila queda vacía. |
| Tabla del Impuesto Global Complementario por año tributario | https://www.sii.cl/valores_y_fechas/renta/2026/personas_naturales.html (cambiar el año tributario en la ruta) | Tabla del art. 52 (no la del 52 bis): tramos «desde/hasta» en pesos, factor y cantidad a rebajar. También trae la UTA de diciembre que se usó. |
| Tabla del IGC (confirmación con ejemplo) | https://www.sii.cl/servicios_online/renta/guia_practica_renta_2026.pdf | Sección «Determinación del Impuesto Global Complementario» y sus casos prácticos (impuesto en el código [157] del F22). |
| Tabla del Impuesto Único de Segunda Categoría (mensual) | https://www.sii.cl/valores_y_fechas/impuesto_2da_categoria/impuesto2025.htm (cambiar el año en la URL) | Tabla «mensual» de cada mes: tramos en pesos, factor, cantidad a rebajar. El primer tramo exento equivale a 13,5 UTM del mes. |
| Factores de actualización (reajuste IPC) del F22 | https://www.sii.cl/valores_y_fechas/renta/2026/personas_naturales.html | Bloque «Factores de actualización» del año comercial: un factor por mes, con diciembre = 1. Se usa para actualizar honorarios, sueldos y retenciones de cada mes al 31 de diciembre. |
| Gastos presuntos de honorarios (30 % con tope 15 UTA) | https://www.sii.cl/valores_y_fechas/renta/2026/personas_naturales.html y https://www.sii.cl/servicios_online/renta/guia_practica_renta_2026.pdf | En la primera, «Gastos presuntos (art. 50)», con el tope de 15 UTA en pesos por año tributario. En la guía, el caso práctico del IGC, que aplica el 30 % con ese tope. |
| Tasa de retención de honorarios por año | https://previsionsocial.gob.cl/wp-content/uploads/2026/05/Independientes-Consideraciones-Generales-VF.pdf y https://www.chileatiende.gob.cl/fichas/12016-prorroga-de-la-cotizacion-previsional-obligatoria-para-independientes-que-perciben-honorarios | En el PDF, «Cuadro 1: Porcentaje de retenciones…», por año comercial y año tributario. En ChileAtiende, las tasas de los años en curso y siguientes. La guía práctica del SII trae la del año («Tasa de Retención y de PPM de Honorarios»). |
| Umbral de exención de cotizar (5 IMM) y otras exenciones | https://www.sii.cl/servicios_online/renta/guia_practica_renta_2026.pdf y https://www.sii.cl/preguntas_frecuentes/declaracion_renta/001_140_7292.htm | En la guía, «Contribuyentes no obligados a cotizar»: el monto en pesos de los honorarios anuales bajo el cual no se cotiza y el límite máximo imponible anual. En la pregunta frecuente, la lista de exceptuados (renta imponible menor a 4 IMM; dependientes que ya llegaron al tope imponible anual, con su monto). **Ojo:** ChileAtiende muestra un monto de 5 IMM que no coincide con el de la guía del SII para el mismo año. Para el F22, manda el SII. |
| Cobertura parcial o total de la cotización de honorarios | https://previsionsocial.gob.cl/wp-content/uploads/2026/05/Independientes-Consideraciones-Generales-VF.pdf y https://www.sii.cl/servicios_online/renta/guia_practica_renta_2026.pdf | En el PDF, «Cuadro 2» (cobertura total) y «Cuadro 3» (cobertura parcial): porcentaje de la renta imponible que cotiza para salud y pensiones, por Operación Renta. En la guía, «Cobertura parcial de cotizaciones para salud y pensiones», el orden de descuento y el caso práctico. |
| Tasas de ATEP, SANNA y salud de independientes | https://www.sii.cl/servicios_online/renta/guia_practica_renta_2026.pdf y https://previsionsocial.gob.cl/wp-content/uploads/2026/05/Independientes-Consideraciones-Generales-VF.pdf | En la guía, las fichas «Seguro contra Accidentes Laborales (ATEP)», «SANNA» y «Salud». En el PDF, la lámina final con las tasas de pago. La tasa adicional diferenciada de ATEP depende de la actividad y no sale en ninguna de las dos. |
| Comisiones de las AFP | https://www.spensiones.cl/portal/institucional/594/w3-propertyvalue-9897.html | Tabla «comisiones» por AFP (porcentaje de la renta imponible) y la AFP adjudicataria para quien no esté afiliado. |
| Tasa del SIS para independientes vía Operación Renta | https://www.spensiones.cl/portal/institucional/594/w3-propertyvalue-9917.html | El párrafo de independientes que cotizan con la retención de impuestos: «la tasa SIS a considerar para el año tributario N». **No** usar la tasa general vigente del mes, que esa misma página da aparte. La guía del SII da otra cifra, redondeada en su ejemplo. Gana la de la Superintendencia de Pensiones. |

Sin fuente verificada en esta revisión (no poner la URL hasta abrirla):
- El texto legal en bcn.cl de las leyes de retención, cotización de honorarios y reforma de pensiones. No se abrió ninguna página de bcn.cl.
- La tabla del IGC y los factores del año tributario siguiente. El SII los publica recién a fines de diciembre o en enero, en la ruta `valores_y_fechas/renta/<AT>/personas_naturales.html`. Hasta entonces, quien llame debe usar las cifras del último año publicado y marcar el resultado como provisional.
- El PDF del formulario F22 en `sii.cl/formularios/imagen/f22.pdf` corresponde a un año tributario antiguo (AT2019). No sirve como fuente de códigos vigentes.

## Regla de cálculo (sin cifras)

Para estimar el F22 de una persona con sueldo (dependiente) y boletas de honorarios de un año comercial:

1. **Actualizar.** Llevar a pesos del 31 de diciembre cada sueldo mensual, su impuesto único retenido, cada honorario bruto y su retención. Para eso se multiplica cada monto por el factor de actualización del mes en que se percibió. Si los montos vienen de las declaraciones juradas de los pagadores o de la propuesta del SII, normalmente ya vienen actualizados. No actualizarlos dos veces.
2. **Honorarios netos.** Al total de honorarios brutos actualizados se le resta lo mayor entre los gastos efectivos acreditados y los gastos presuntos: el porcentaje legal de los honorarios brutos, con el tope en UTA de diciembre.
3. **Base del IGC.** Se suman los sueldos imponibles actualizados (ya sin las cotizaciones obligatorias, como los informa el empleador), los honorarios netos y las demás rentas afectas. Se restan las rebajas que procedan (p. ej., intereses hipotecarios o APV con su régimen).
4. **Impuesto según tabla.** Se ubica la base en la tabla del IGC del año tributario. El impuesto es la base por el factor del tramo, menos la cantidad a rebajar, y nunca es negativo. Va en el código [157] de la guía.
5. **Créditos contra ese impuesto.** Se restan el crédito por impuesto único retenido a los sueldos (código [162]) y los demás créditos que correspondan (p. ej., gastos en educación). Si con eso el impuesto queda bajo cero, solo se devuelve la parte que corresponde al impuesto único retenido. Lo demás no genera devolución, salvo que la norma del crédito lo diga.
6. **Retenciones y PPM de honorarios.** Se suman las retenciones actualizadas de las boletas y los PPM. Ese monto se destina **primero a las cotizaciones de honorarios** y lo que sobre queda como crédito contra el impuesto del paso 5.
7. **Cotizaciones de honorarios.** Antes, se ve si la persona está obligada: no lo está si sus honorarios brutos anuales no llegan al umbral de exención, si tiene edad o régimen exceptuado, o si como dependiente ya cotizó por el tope imponible anual. Si está obligada:
   - La renta imponible es el porcentaje legal de los honorarios brutos. No puede ser menor al mínimo legal ni mayor al tope imponible anual, descontado lo ya cotizado como dependiente ese año.
   - Se calcula, en este orden, SIS, ATEP (tasa básica más la adicional si hay), SANNA, salud y pensiones (cotización obligatoria más la comisión de la AFP).
   - Con **cobertura parcial**, salud y pensiones se calculan sobre la renta imponible multiplicada por el porcentaje de cobertura parcial de esa Operación Renta. SIS, ATEP y SANNA, sobre la renta imponible completa.
   - Con **cobertura total**, pensiones recibe todo lo que queda de las retenciones después de SIS, ATEP, SANNA y salud. Por eso no hay devolución de retenciones.
   - Si las retenciones no alcanzan, se cubren los conceptos en ese orden hasta agotarlas. Lo que falta queda impago y se arrastra como «saldos insolutos de cotizaciones», el último concepto de la lista en Operaciones Renta siguientes.
   - El total de cotizaciones se traslada al código [900] del F22. El SII se lo informa a la TGR, que paga a cada institución.
8. **Resultado.** Se toma el impuesto del paso 5 y se le restan las retenciones y PPM que quedaron después del paso 7. Si el resultado es positivo, hay impuesto a pagar. Si es negativo, hay saldo a devolver, sujeto a la regla del paso 5 sobre créditos que no se devuelven.
9. **Provisionalidad.** Si el año tributario aún no tiene publicados la tabla del IGC, la UTA de diciembre, los factores o la tasa del SIS para la Operación Renta, el resultado se marca como **estimación provisional** e indica qué valores se tomaron del último año publicado.
