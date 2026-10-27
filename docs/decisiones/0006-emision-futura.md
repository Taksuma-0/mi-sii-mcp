# 0006 — Emisión de documentos tributarios (decisión futura)

Fecha: 27 de octubre de 2026. Estado: **propuesta, no implementada**. Este documento solo registra requisitos; no hay código, herramienta ni comando de emisión, y no se agregan ahora.

## Contexto

mi-sii-mcp hoy solo lee el SII: ninguna herramienta presenta, emite ni modifica nada en el portal. Es una decisión de diseño: las herramientas que van al SII solo hacen consultas y escriben únicamente en la base local.

Una posible ampliación es emitir documentos tributarios electrónicos desde el facturador gratuito del SII (por ejemplo, boletas de honorarios o facturas). Lo que se sabe hasta ahora:

- El SII exige identidad del emisor para emitir en el facturador gratuito: la sesión debe corresponder al contribuyente emisor o a alguien autorizado a actuar por él.
- La prueba de lectura de áreas nuevas (`0003-spike-areas.md`) fue solo de lectura y no investigó el facturador ni las operaciones de emisión.
- La identidad con la que se entra (clave tributaria o ClaveÚnica, representación de una empresa) queda para el Grupo 3 del plan el plan de trabajo (T21 a T23). La ClaveÚnica es personal: mi-sii-mcp nunca la ve ni la guarda.

## Decisión

No se implementa emisión ahora. Si algún día se hace, debe cumplir todos estos requisitos; si no se pueden cumplir, no se hace.

1. **Escritura desactivada por defecto.** La capacidad de emitir no existe a menos que la persona la active. Una instalación nueva, o una actualización de mi-sii-mcp, nunca la enciende sola.
2. **Bandera explícita.** Se activa con una bandera de configuración clara y separada de las de lectura (por ejemplo, una variable de entorno o un valor en la configuración local con un nombre inequívoco). Nunca se activa por inferencia ni por una instrucción del asistente.
3. **Confirmación de un solo uso por operación, mostrando el documento.** Antes de emitir, la persona ve el documento completo que se emitiría (emisor, receptor, glosas, montos, impuestos y retenciones) y lo confirma. La confirmación vale para esa operación y no se reutiliza: ni para otra emisión, ni para el mismo documento modificado, ni para un reintento. Cambiar cualquier dato invalida la confirmación. La confirmación la da la persona en su interfaz local o terminal; el asistente no puede darla por ella.
4. **Bitácora.** Cada intento de emisión (confirmado, rechazado, fallido o exitoso) queda registrado localmente con fecha y hora, identidad usada, tipo de documento, receptor, monto, resultado y folio devuelto. La bitácora no guarda claves, cookies ni tokens, y no se borra automáticamente.
5. **Identidad del emisor vía login asistido.** La sesión con la que se emite debe pertenecer al emisor, verificada por la identidad que devuelve el SII (el login asistido de T22), y nunca con una clave que el asistente haya recibido. Si la sesión es de otro RUT, o no se puede verificar quién es el emisor, no se emite.
6. **Sin reintentos automáticos de una escritura.** Una emisión que falla o queda en duda (por ejemplo, un corte de red tras enviar) no se repite sola: se consulta primero si el documento quedó emitido, para no duplicarlo, y la persona decide.
7. **Superficie separada.** La emisión vive en comandos y herramientas distintos de los de lectura, con anotaciones que no las presenten como de solo lectura ni idempotentes, de modo que un cliente MCP pueda pedir aprobación por llamada.
8. **Solo datos propios y datos sintéticos en pruebas.** Las pruebas usan un SII falso. Cualquier prueba real de emisión requiere una autorización explícita de la persona, con el contribuyente y el documento que ella indique, y se hace con el SII en un ambiente de pruebas si existe.

## Consecuencias

- Los requisitos 1 a 4 se cumplen antes de escribir la primera línea de emisión; la bandera, la confirmación y la bitácora son parte del diseño y no un agregado posterior.
- Depende de que el login asistido y la identidad del contribuyente (T22 y T23) estén resueltos. Hasta entonces, no hay base para emitir.
- Antes de implementar hay que hacer una prueba de reconocimiento del facturador gratuito (como la de `0003`), con la persona presente y sin emitir nada real, y un diseño propio (spec y plan).
- No se promete emisión en la guía ni en las instrucciones del MCP; la cobertura sigue declarando que mi-sii-mcp solo lee.
