# 0009 — Exploración de los avisos de Mi SII

Fecha: 1 de noviembre de 2026. Sesión: las guardadas de las cuentas del usuario (clave tributaria). Solo consultas de lectura, con ritmo de al menos 1 s entre consultas y unas 20 en total. Aquí solo hay estructura: sin RUT, nombres, montos ni direcciones.

**Compuerta:** ninguna consulta pidió captcha ni un paso interactivo. Todas respondieron con la sesión guardada.

## Qué se buscó

El plan (T5.1) pedía tres cosas: las anotaciones vigentes, la situación tributaria propia y las notificaciones. Mi SII ya se lee para el perfil (`siihome.cgi`, `DatosCntrNow`). Su raíz trae `alertas[]`, pero vino vacía en las dos cuentas. La portada arma sus avisos con llamadas AJAX desde `/misii/js/misii.min.js`.

## Servicio de la portada: `POST https://misiir.sii.cl/cgi_misii/CViewCarta.cgi`

Cuerpo `opc=<n>&VIEW=1` (form-urlencoded) y respuesta JSON. Entrega los datos de **quien inició sesión**, sin un parámetro de RUT. Por eso, antes de leer, se confirma que la sesión es del RUT pedido.

| Opción | Qué es | Forma de la respuesta |
|---|---|---|
| `28` | Anotaciones vigentes: restricciones en trámites hasta regularizar (p. ej. timbrar facturas o emitir documentos) | `{codigo, descripcion, objSalida[]}`. `codigo` 0 trae la lista y 97 significa que no hay anotaciones («Contribuyente no posee observaciones/alertas vigentes.»). Cada elemento: `taltCodigo`, `cantTaltCodigo`, `fechaActivacion` (DD-MM-AAAA), `glosaSubstr` (descripción y efectos, con HTML) y `accionStr` (cómo regularizar). |
| `118` | Estado de cumplimiento de las obligaciones tributarias (semestral) | `{semestreActual, estado, mostrarObligacionTributaria, historicos, atributos[]}`. Cada atributo: `atrCodigo` (NDIR, DQDT, ATPJ…), `condicion` (B, C, D…), `titulo`, `descripcion` y `cumple` («SI»/«NO»). |
| `33` | Mensajes informativos de la portada | `{codigoError, descripcionError, mensajes[]}`; cada mensaje: `glosaTitulo`, `glosaDescripcion`, `glosaSolucion`. Vino `mensajes: null` («No se encontraron resultados»). |

Ejemplos de anotaciones vistas (son textos públicos del SII): **4310**, F29 no presentado estando obligado, que puede impedir emitir documentos; **1014**, domicilio por acreditar, que impide pedir folios de facturas.

Detalle de las glosas: traen HTML (`</p>`) y la ligadura «ti» de un documento de Word escapada como `󰆟` (U+10019F). Al leerlas se quita el HTML y se restaura «ti».

## Lo que quedó fuera

- **Otras opciones del mismo servicio** que usa el JavaScript: `112` (datos del contribuyente: personales, no se usan), `114` (correos), `119` (carpeta tributaria: abonos y transferencias que informan los bancos), `29` y `27`. No se consultaron.
- **Notificaciones formales y cartas:** viven en aplicaciones aparte (`www4.sii.cl/corenoti1Internet`, `www4.sii.cl/validanotifInternet`, `/cgi_misii/cartas.cgi` con PDF en `www3.sii.cl/Coreca1Internet/MuestraPdf`). Pueden traer contenido personal; quedan para una exploración propia.
- **Giros y deudas:** `www2.sii.cl/pagogiro-ui` (giros del SII) y la Tesorería (T5.2) necesitan que la persona entre a la TGR. No se exploraron.

## Decisión

- Herramienta `sii_avisos` (rut): anotaciones vigentes (28), estado de cumplimiento (118) y mensajes (33). Solo lectura, al momento y sin guardar la respuesta cruda.
- Cada anotación se registra como aviso con clave `A:<código>:<fecha de activación>`: se avisa una vez y otra vez si se reactiva. Cada requisito incumplido, con clave `C:<código>:<semestre>`. Ambos son del tipo nuevo `anotacion` (migración 16) y de severidad «advertencia».
- La revisión diaria (`vigilar`) consulta lo mismo en cada cuenta. Si Mi SII no responde, la revisión sigue con lo demás.
- Una empresa que entra con la sesión de quien la representa no puede leerlo: Mi SII solo muestra al titular de la sesión.
- `deuda_estado` no se implementa hasta explorar la TGR con el usuario.
