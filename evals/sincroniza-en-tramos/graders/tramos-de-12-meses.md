---
type: llm
focus: mock_calls
---

PASS si cada llamada a sincronizar cubre como máximo 12 meses (de `desde` a `hasta`, ambos incluidos) y entre todas cubren de 2023-10 a 2026-09 sin dejar meses fuera.
FAIL si alguna llamada pide más de 12 meses o si queda un tramo sin sincronizar.
