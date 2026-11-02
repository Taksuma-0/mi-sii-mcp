# 0008 — Ahorro tributario: solo oportunidades legales, con su norma

Fecha: 1 de noviembre de 2026. Estado: decidido. Las fuentes se revisaron en sii.cl el 30/10/2026 y el 01/11/2026.

## Decisión

`ahorro_oportunidades` muestra solo lo que **la ley ya permite** y que **los datos guardados sostienen**. Cada oportunidad trae:

- su norma y la página oficial donde se revisó;
- el monto involucrado, o `null` si faltan datos;
- qué datos faltan para confirmarla;
- qué hacer;
- la advertencia antielusión: «Solo con operaciones reales, necesarias para tu actividad y con respaldo. Simular gastos, compras o contratos para pagar menos no es ahorro: es elusión o fraude.»

Nunca es una recomendación cerrada: el texto dice «No es asesoría: confírmalas con un contador». Si una regla no se pudo confirmar en una fuente oficial, no se programa.

La herramienta solo lee la base local. No presenta, no paga y no cambia nada en el SII.

## Reglas programadas

| Id | Oportunidad | Cuándo aparece | Norma | Fuente revisada |
|---|---|---|---|---|
| OPO-IVA-01 | Crédito de IVA de compras pendientes que aún se puede usar | Hay compras del RCV en estado PENDIENTE o NO_INCLUIR con IVA, de los últimos dos períodos | DL 825, art. 24, inciso final: el IVA de facturas recibidas o registradas con atraso, por un hecho no imputable al contribuyente, se puede usar hasta dos períodos después de su emisión | https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_0693.htm |
| OPO-IVA-02 | Remanente de crédito fiscal sin usar | Los últimos 6 F29 presentados dejan remanente (código 77) | DL 825, art. 26 (el remanente se acumula al período siguiente), art. 27 (se reajusta en UTM) y art. 27 bis (devolución del remanente originado en activo fijo tras dos períodos seguidos, según la Circular 26 de 2021) | https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_1926.htm y https://www.sii.cl/normativa_legislacion/circulares/2021/circu26.pdf |
| OPO-IVA-03 | Postergar el pago del IVA dos meses | Hubo IVA a pagar (código 89) en los últimos 12 meses y nunca se postergó (código 755 en cero) | Postergación del pago del IVA para pymes: ingresos promedio de hasta 100.000 UF en los últimos tres años, F29 por Internet dentro de plazo, sin adeudar IVA de tres períodos en doce meses. Se marca el código 756 y el IVA pasa al 755; no rebaja el impuesto, solo mejora la caja | https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_6631.htm |
| OPO-HON-01 | Gastos efectivos en vez de presuntos | Persona con boletas de honorarios emitidas en el año | Ley sobre Impuesto a la Renta, art. 50: gastos presuntos de 30 % con tope de 15 UTA | https://www.sii.cl/valores_y_fechas/renta/2026/personas_naturales.html (ver decisión 0007) |
| OPO-APV-01 | APV régimen B | Persona con honorarios, sueldo o un F22 presentado | Ley sobre Impuesto a la Renta, art. 42 bis, inciso 1°: rebaja la base del Global Complementario con tope de 600 UF al año (UF al 31 de diciembre), único para dependientes e independientes | https://www.sii.cl/servicios_online/renta/2025/archivos/l23_instruccion.pdf |

Notas sobre la verificación:

- **Postergación del IVA:** las páginas del SII que la describen son de 2014 a 2016 y hablan de los regímenes de entonces (14 ter y régimen general). Que siga vigente lo muestran los F29 reales de 2026 revisados en la prueba en vivo, que traen el código 755. Por eso el texto lista los requisitos como datos que faltan confirmar.
- **El umbral de 6 meses de OPO-IVA-02** es un criterio de mi-sii-mcp para no avisar de cualquier remanente pasajero. No es un plazo legal.
- **El reajuste del remanente** usa la UTM del mes en que se presenta el F29 (preguntas frecuentes del SII). `f29_estimar` lo recibe como parámetro, según la decisión 0007.

## Reglas del plan que no se programaron

| Id del plan | Motivo |
|---|---|
| OPO-PPM-01 (suspender PPM ante pérdida) | Necesita una base anual proyectada. Queda para `cierre_proyectar`, que remite a la norma en vez de calcular la suspensión. |
| OPO-PYME-01 (activo fijo en Pro Pyme) | No se confirmó en una fuente oficial vigente el tratamiento del activo fijo para cada régimen. Hasta confirmarlo, no se programa. |
| OPO-REN-01 (retenciones de más) | Ya lo cubre `renta_estimar`, que compara la estimación con el F22 presentado y muestra la devolución. |

## Datos de los simuladores (para la Task 29)

Revisados el 01/11/2026 en sii.cl:

- **Pro Pyme General (art. 14 letra D N°3):** tasa del Impuesto de Primera Categoría de 12,5 % en los años comerciales 2025, 2026 y 2027 y de 15 % en 2028 (Ley 21.755); la tasa permanente es 25 %. La rebaja exige un porcentaje de cotización al cierre de cada año (Ley 21.735) y reduce los PPM a la mitad. Fuentes: https://www.sii.cl/preguntas_frecuentes/declaracion_renta/001_140_4708.htm y https://www.sii.cl/normativa_legislacion/circulares/2025/circu53.pdf.
- **Pro Pyme Transparente (art. 14 letra D N°8):** la empresa no paga Impuesto de Primera Categoría y sus dueños tributan con el Global Complementario (o el Adicional) sobre la base que determina la empresa. Requisitos: ingresos promedio de hasta 75.000 UF en los últimos tres años (una vez se puede pasar, sin superar 85.000 UF en un año) y capital efectivo inicial de hasta 85.000 UF. Fuentes: https://www.sii.cl/preguntas_frecuentes/declaracion_renta/001_140_7530.htm y https://www.sii.cl/destacados/modernizacion/tipos_regimenes_mt.html.
- Las tasas y la tabla del Global Complementario entran como parámetros con su URL oficial (decisión 0007). El simulador las informa como supuestos.
- **Régimen inscrito:** los simuladores lo leen del perfil tributario guardado (`perfil_sincronizar`): el atributo `14TT` es el Pro Pyme Transparente; los demás se reconocen por su descripción. En el Transparente, `cierre_proyectar` no estima Primera Categoría, porque la empresa no la paga.
- **Base de un año ya declarado:** si el F22 del año siguiente trae el código 1630 (base que el Transparente asigna a sus dueños, visto en un F22 real del AT2026), esa base manda sobre la proyección. La proyección solo ve los documentos del SII: no ve sueldos ni depreciación, y en la prueba en vivo daba utilidad donde el F22 declaró pérdida.
