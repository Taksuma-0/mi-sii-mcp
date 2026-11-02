# Evals del asistente

Casos para `claude plugin eval`: comprueban cómo usa el asistente las herramientas de mi-sii-mcp (que nunca pida la clave, que sincronice por tramos, que no invente cifras, que cite la fuente oficial, que presente con la plantilla y que ofrezca el informe visual).

- `mocks/mi-sii-mcp/`: el servidor simulado, con datos ficticios. `_tools.json` se regenera con `npm run evals:herramientas` y una prueba avisa si queda desfasado.
- Cada carpeta es un caso: `prompt.md` (lo que escribe la persona) y `graders/` (cómo se juzga). Un caso puede traer sus propias simulaciones en `mocks/`.

Para correrlas: `npm run evals`, o un caso con `claude plugin eval . --no-publish --case <nombre> --runs 1 --ablation none`. Cada corrida usa tu plan de Claude, así que no van en CI. Los resultados quedan en `evals/results/` (ignorado por git).
