# Usar impuestocl en tu navegador

Haz doble clic en **Abrir impuestocl.cmd**, en la raíz del proyecto. Se abrirá el navegador predeterminado en una dirección local `http://127.0.0.1:…`. Requiere la instalación existente de Node y las dependencias del proyecto; la interfaz no agrega dependencias ni publica un servicio.

1. Ingresa el RUT del contribuyente, con o sin puntos, y su clave tributaria. Pulsa **Conectar**. No necesitas elegir un mes y no se inicia un análisis ni una descarga de historial al entrar. El envío es explícito y no se reintenta automáticamente.
2. **Vista general** reúne todos los meses guardados localmente para ese contribuyente, sus totales y la cobertura separada de RCV ventas, RCV compras y F29. Actualmente esas son las fuentes disponibles; la vista no representa todos los datos del portal del SII. **Sin datos** es un importe desconocido; **$0** es un cero conocido. Los totales indican cuántos meses tienen importe y cuántos no. F29 distingue **Sin consultar**, **Sin presentación** y la declaración vigente guardada. **Total declarado en F29** no confirma una deuda ni un pago. La fecha RCV no certifica igual actualización de ambos registros.
3. Si aparece **Aún no has cargado datos**, usa **Cargar historial**. Después de entrar puedes elegir un rango y consultar RCV y F29 juntos o una sola fuente. Se sugieren enero del año del mes anterior en Santiago y ese mes anterior como fin; puedes cambiarlos. Cada envío admite hasta 120 meses. No necesitas volver a ingresar la clave. La descarga puede tardar varios minutos. **Carga parcial** indica datos faltantes, interrupciones o avisos: revisa el detalle y la cobertura antes de interpretar montos.
4. En **Cruzar RCV con F29**, elige un rango para comparar los datos locales, su disponibilidad, su actualización y los hallazgos de cada mes. Los resultados indican el rango consultado; editar el filtro no cambia los resultados hasta enviar otra consulta. Los importes desconocidos siguen siendo **Sin datos**.
5. En **Explorar documentos**, elige mes, registro y estado. Se muestran razón social, RUT, folio, fecha e importes de los documentos guardados, de 50 en 50. Usa **Anterior** y **Siguiente** para recorrerlos. Cambiar los filtros limpia el resultado y la siguiente búsqueda vuelve a la página 1. Una búsqueda vacía no demuestra que no existan movimientos en el SII.
6. **Cambiar contribuyente** borra inmediatamente la identidad, los resultados y los filtros de esta pestaña, desconecta su contexto y vuelve al acceso. Cada pestaña tiene su propio contexto. Desconectar la interfaz no borra los datos tributarios ni las cookies locales de sesión. Al refrescar o volver a abrir la página se requiere **Conectar** otra vez; no se recupera el contexto del navegador.
7. Al terminar, pulsa **Cerrar aplicación** y después cierra la pestaña. Esto detiene el servidor local para todas sus pestañas; no borra los datos ni las cookies guardadas. La aplicación también se cierra tras 30 minutos de inactividad, sin cortar una consulta en curso.

La clave se envía al SII para iniciar sesión. El formulario la borra al enviar y al finalizar; esta interfaz no la guarda en el navegador ni consulta el llavero. Los datos tributarios y las cookies de sesión pueden persistir en el almacenamiento local habitual de impuestocl. El navegador puede ofrecer sus propias funciones de contraseñas.

Si aparece un error, revisa los datos y decide cuándo volver a enviarlos. Si se perdió la conexión local, vuelve a abrir **Abrir impuestocl.cmd**. Si ya estaba abierta, el lanzador reutiliza esa instancia. No hay reintentos automáticos.

## Consultas libres con un asistente MCP

Para pedir cruces e históricos en lenguaje natural, usa un cliente MCP conectado al servidor que inicia `impuestocl mcp`. La configuración depende de ese cliente. Esta página no incorpora un chat y una conversación con un asistente no queda conectada automáticamente por abrir la interfaz.

Con un cliente conectado puedes pedir, por ejemplo:

- «Muéstrame todos los meses locales y la cobertura de RCV y F29 del contribuyente».
- «Trae RCV y F29 de enero a septiembre de 2026 y explica qué fuentes quedaron incompletas».
- «Compara los débitos y créditos RCV con F29 durante ese rango».
- «Busca documentos de compras pendientes de septiembre de 2026».

El asistente utiliza las herramientas MCP disponibles y los datos locales. Si necesita sesión, conéctate desde **Abrir impuestocl.cmd** o mediante `impuestocl login <rut>` en la terminal. Nunca entregues la clave tributaria al chat ni como argumento de una herramienta MCP.

La interfaz se verifica con datos ficticios. La calibración real sigue pendiente del ingreso manual del usuario; sus resultados no constituyen una validación fiscal.

Para mantenimiento está disponible `npm run local`; el uso habitual es mediante doble clic.
