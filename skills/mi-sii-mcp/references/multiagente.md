# Trabajo con varios agentes

mi-sii-mcp separa dos tipos de trabajo, y eso define cómo repartirlo:

- **Traer datos del SII** (`sincronizar`, `renta_sincronizar`, `perfil_sincronizar`): lento, limitado por el SII y con sesiones contadas. **Uno a la vez**, por un solo agente.
- **Analizar lo guardado** (todas las demás herramientas): rápido y local. **En paralelo**, sin límite práctico.

## Flujo base

1. **Coordinador**: `perfiles_listar` y `sii_panorama` de cada RUT involucrado. Decide qué falta traer y qué análisis hacer.
2. **Sincronizador**: trae lo que falta, en orden, por tramos de 12 meses (o por año tributario en la renta). Al terminar cada tramo informa al coordinador.
3. **Analistas en paralelo**, cada uno con una parte acotada (un mes, un año, un RUT o un tema).
4. **Revisor**: contrasta las conclusiones con `iva_hallazgos` y, para valores públicos, con `fuentes_oficiales`.
5. **Coordinador**: une los resultados en una sola respuesta, sin repetir datos y diciendo qué no se pudo consultar.

## Ejemplos

**«Revisa todo el 2026 de mi empresa»**
- Sincronizador: `sincronizar` 2026-01 a 2026-12 (un tramo) y `perfil_sincronizar`.
- Analistas: uno por trimestre con `iva_resumen` de cada mes; otro con `iva_hallazgos` del año y `plazos_proximos`.
- Revisor: confirma que los totales del año calcen con `f29_historial`.

**«Compara mis tres empresas»**
- Sincronizador: una empresa tras otra (nunca las tres a la vez).
- Analistas: uno por RUT con `sii_panorama` y `f29_historial`; uno extra con `consulta_sql` para la tabla comparativa.

**«¿Cuánto me devolverán en la renta?» (persona con boletas y sueldo)**
- Sincronizador: `renta_sincronizar` del año tributario siguiente (AT = año actual + 1) y del anterior, para comparar.
- Analista A: `renta_resumen` (boletas, retenciones, pagadores y terceros).
- Analista B: `fuentes_oficiales` con `regla: true` y las páginas oficiales del año.
- Revisor: verifica el cálculo, marca lo provisional y agrega que es una estimación.

## Qué evitar

- Dos agentes sincronizando a la vez, aunque sean RUT distintos: provoca `SII_SESIONES_MAXIMAS` o `SII_LIMITE`.
- Pedir o pasar la clave tributaria entre agentes: ningún agente la necesita.
- Que cada analista vuelva a llamar a `datos_esquema`: el coordinador la llama una vez y comparte las tablas relevantes.
- Consultas SQL sin filtro por RUT o período: tocan el tope de 200 filas y ocultan datos.
