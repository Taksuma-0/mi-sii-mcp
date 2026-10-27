# 0002 — Reglas de plazos v1

- **F29:** vence el día 20 del mes siguiente para contribuyentes que facturan electrónicamente
  y declaran por internet. Si cae sábado, domingo o festivo, pasa al siguiente día hábil.
  Estado: **asumida**. Antes de publicar v1, la validación manual de T23 debe contrastar con
  el calendario tributario del SII (sii.cl → Calendario) para al menos tres meses que caigan
  en fin de semana o festivo, y corregir `vencimientoF29` si difiere. T6 implementa la regla
  del plan; no verifica el calendario del SII ni ejecuta esa validación.
- **Reclamo de facturas recibidas:** regla del plan de 8 días corridos siguientes a la recepción
  en el SII (Ley 19.983, art. 3). Pasado el plazo, la factura se entiende aceptada.
- **Feriados:** tabla estática 2025–2027 del plan en `src/calendar/feriados.ts`. Fuentes previstas
  para actualización y contraste: api.boostr.cl y date.nager.at; no se consultaron durante T6.
  Fuera de ese intervalo la tabla no cubre festivos: los cálculos solo excluyen fines de semana.
  Para un año nuevo: `node scripts/actualizar-feriados.mjs <año>` y revisar la salida antes de
  incorporarla a la tabla y ampliar `ANIOS_CUBIERTOS`.

## Actualización del 27 de octubre de 2026 (T17)

La regla del F29 de esta decisión quedó **superada por `docs/decisiones/0004-plazos-f29.md`**, verificada contra las fuentes del SII. `vencimientosF29(periodo, { autorizadoDia20 })` en `src/calendar/plazos.ts` entrega dos fechas: `conPago` (día 20 si Mi SII dice que el contribuyente está autorizado, o si se desconoce; día 12 si no) y `sinPago` (día 28, sin traslado). El traslado al primer día hábil siguiente ahora incluye el 31 de diciembre. IVA-04 y `plazos_proximos` se gradúan con ambas fechas cuando no hay F29 ni dato de pago. Los reclamos de facturas y los feriados no cambian.
