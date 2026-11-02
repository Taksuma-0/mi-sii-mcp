---
type: fixed
expect:
  rut: string
  desde: /^\d{4}-\d{2}$/
---

Sincronización {{input.rut}} desde {{input.desde}} hasta {{input.hasta}}
Cada mes del tramo: documentos RCV de compras y ventas y F29 guardados, sin errores.

{"rut":"{{input.rut}}","desde":"{{input.desde}}","hasta":"{{input.hasta}}","superficies":["rcv","f29"],"errores":[],"abortado":null}
