# 0004 — Vencimientos oficiales del F29

Fecha: 27 de octubre de 2026. Estado: verificado contra fuentes del SII; pendiente de implementación (Tarea T17 del plan el plan de trabajo).

## Fuente principal

SII, Preguntas frecuentes, «¿Cuáles son los plazos para presentar el Formulario 29 de Declaración Mensual y Pago Simultáneo?», https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_1060.htm (última actualización 17/06/2025; consultada el 27/10/2026). Resumen fiel:

- **Plazo general:** hasta el día 12 del mes siguiente al período tributario.
- **Día 20:** presentación por Internet con pago a través de sii.cl, para contribuyentes de Primera Categoría que sean facturadores electrónicos, o de Segunda Categoría que emitan boletas de honorarios electrónicas. El requisito de facturar electrónicamente no se exige a quienes, por su actividad, no están obligados a emitir documentos tributarios.
- **Feriados, sábados o 31 de diciembre:** si el impuesto vence en uno de esos días, el plazo se traslada al primer día hábil siguiente.
- **Día 28:** declaraciones «sin pago» presentadas por Internet; coincide con el vencimiento de las declaraciones «sin movimiento».

Fuentes de apoyo:
- Portal MIPYME, «Declaración y pago del F29 hasta el día 20 de cada mes», https://www.sii.cl/portales/mipyme/f29/ (requisitos del día 20; la Cartola Tributaria muestra la anotación del beneficio).
- Calendario tributario del SII, https://misiir.sii.cl/cgi_calendario/calendario.cgi?OPT=3&VIEW=2&YEAR=2026&MONTH=10&DAY=1&TYPE=F29.
- Circular 69 de 2008 (anexo), citada por una búsqueda: el día 28 no se traslada aunque caiga en sábado o festivo. No se abrió el documento; tratarlo como indicio, no como regla verificada.

## Reglas a implementar

1. `conPago`: día 20 si el contribuyente está autorizado (Mi SII `DatosCntrNow.autorizadoDeclararDia20 = "S"`, a confirmar en la prueba de lectura), o día 12 si no; si cae en sábado, domingo, feriado o 31 de diciembre, primer día hábil siguiente.
2. `sinPago`: día 28 por Internet, sin traslado (indicio de la circular 2008; si la prueba o el calendario oficial de un mes concreto muestran traslado, se corrige).
3. Si se desconoce si habrá pago (sin propuesta ni F29): después de `sinPago` → crítico; entre `conPago` y `sinPago` → advertencia «posiblemente vencido»; antes → pendiente.
4. Si se desconoce la autorización del día 20, se mantiene el día 20 (comportamiento actual de `docs/decisiones/0002-plazos.md`).
