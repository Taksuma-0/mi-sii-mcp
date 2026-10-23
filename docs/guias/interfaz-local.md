# Usar impuestocl en tu navegador

Haz doble clic en **Abrir impuestocl.cmd**, en la raíz del proyecto. Se abrirá el navegador predeterminado con una dirección local `http://127.0.0.1:…`. Requiere la instalación existente de Node y las dependencias del proyecto; esta interfaz no agrega dependencias ni publica un servicio.

1. Ingresa el RUT del contribuyente, con o sin puntos, y su clave tributaria.
2. Elige un mes ya declarado que conozcas. El mes sugerido es el anterior al actual en Santiago.
3. Pulsa **Conectar y verificar** y espera. Cada envío inicia sesión una sola vez; no se repite automáticamente.
4. Revisa la sincronización, el resumen de IVA y los plazos. **Resultado parcial** indica que faltaron datos o se interrumpió la consulta; revisa esos avisos antes de interpretar montos. Puedes desplegar **Códigos del F29**.
5. Al terminar, pulsa **Cerrar aplicación**. Puedes cerrar después la pestaña. La aplicación también se cierra tras 30 minutos de inactividad, sin cortar una consulta en curso.

La clave se envía al SII para iniciar sesión. El formulario la borra al enviar y esta interfaz no la guarda ni consulta el llavero. Los datos tributarios y las cookies de sesión pueden persistir en el almacenamiento local habitual de impuestocl; cerrar la aplicación no los elimina. El navegador puede ofrecer sus propias funciones de contraseñas.

Si aparece un error, revisa los datos y decide cuándo volver a enviarlos. Si se perdió la conexión local, vuelve a abrir **Abrir impuestocl.cmd**. Si ya estaba abierta, el lanzador reutiliza esa instancia. La consulta puede tardar varios minutos por el ritmo de acceso al SII.

La interfaz fue probada con datos ficticios. La calibración real sigue pendiente del ingreso manual del usuario; sus resultados no constituyen una validación fiscal.

Para mantenimiento está disponible `npm run local`; el uso habitual es mediante doble clic.
