# Política de seguridad

mi-sii-mcp maneja información tributaria y, si la persona lo elige, la clave tributaria guardada en el almacén de credenciales del sistema. Nos tomamos en serio cualquier falla que pueda exponerlas.

*English: please report vulnerabilities privately through GitHub's «Report a vulnerability» button in the Security tab, never in a public issue. We answer within 7 days.*

## Versiones con soporte

| Versión | Soporte |
| --- | --- |
| La última publicada en [npm](https://www.npmjs.com/package/mi-sii-mcp) | ✅ Recibe correcciones de seguridad |
| Anteriores | ❌ Actualiza a la última (`npx -y mi-sii-mcp@latest`) |

## Cómo reportar una vulnerabilidad

1. En el repositorio, abre la pestaña **Security** y pulsa **Report a vulnerability**. El reporte llega en privado al mantenedor.
2. **No abras un issue público** ni publiques el detalle antes de que haya una corrección.
3. Incluye:
   - la versión de mi-sii-mcp y tu sistema operativo;
   - los pasos para reproducirla y qué podría lograr alguien que la aproveche.
4. **Nunca incluyas datos reales:** ni RUT, ni claves, ni cookies de sesión, ni montos. Usa datos ficticios como `11.111.111-1`.

## Qué esperar

- Respuesta en un plazo de **7 días** confirmando que recibimos el reporte.
- Una evaluación del impacto y, si corresponde, una corrección publicada en una versión nueva.
- Crédito en las notas de la versión, si lo quieres.

## Qué cubre

- Exposición de la clave tributaria, de la ClaveÚnica o de las sesiones del SII.
- Acceso a la página local (127.0.0.1) desde otro sitio o aplicación.
- Lectura o escritura de archivos fuera de la carpeta de datos de mi-sii-mcp.
- Cualquier forma de que una herramienta MCP modifique algo en el SII, que debe ser de solo lectura.

Cómo está protegido cada punto: [docs/seguridad.md](docs/seguridad.md).
