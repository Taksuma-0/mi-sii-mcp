# mi-sii-mcp · Kit de identidad visual

Marca de proyecto comunitario independiente. **No está afiliado, respaldado ni representado por el Servicio de Impuestos Internos (SII) de Chile.**

## Archivos recomendados

- **Logo horizontal:** `01_SVG/mi-sii-mcp_horizontal_vector.svg` (100 % vectorial; texto convertido a trazados).
- **Logo horizontal modificable:** `01_SVG/mi-sii-mcp_horizontal_editable.svg` (texto como texto; requiere fuente Inter Display Black o equivalente).
- **Ícono sin fondo:** `01_SVG/mi-sii-mcp_icono.svg` (SVG escalable, canvas transparente).
- **Ícono sobre fondo oscuro:** `01_SVG/mi-sii-mcp_icono_oscuro.svg`.
- **Favicon SVG:** `02_Favicons/favicon.svg`.
- **Favicon para navegadores:** `02_Favicons/favicon.ico` y PNG de tamaños 16/32/48/64/192/512.
- **GitHub avatar:** `04_GitHub/github_avatar_transparente_512.png`.
- **GitHub README:** `04_GitHub/README_logo_transparente.png`.
- **GitHub social preview:** `04_GitHub/github_social_preview_1280x640.png` (1280 × 640 px).
- **Logo apilado:** `01_SVG/mi-sii-mcp_apilado_vector.svg`.

## Colores

| Uso | Hex |
|:--|:--|
| Azul marino | `#0f2a44` |
| Turquesa | `#3dd6c3` |
| Azul suave | `#7cb6fb` |
| Blanco | `#ffffff` |

## Añadir favicon a una web

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

## Usar en GitHub

Sube `README_logo_transparente.png` a la carpeta `assets/` del repositorio y en `README.md` inserta:

```md
<p align="center">
  <img src="assets/README_logo_transparente.png" alt="mi-sii-mcp" width="520" />
</p>
```

Para un avatar de organización o repositorio, usa `github_avatar_transparente_512.png`. Para la imagen social del repositorio, en GitHub abre **Settings → General → Social preview** y carga `github_social_preview_1280x640.png`.

## Notas

- Los SVG no contienen un rectángulo de fondo: el lienzo es **transparente**. Los detalles blancos de la cara y boleta sí forman parte del dibujo.
- Para íconos muy pequeños, `favicon.svg` utiliza un recorte óptico ajustado; verifica legibilidad a 16 px.
- Las capturas compartidas se usaron como referencia visual; los SVG incluidos se reconstruyeron con geometría vectorial editable, no son una vectorización píxel-perfect del original.
- El SVG `horizontal_vector` convierte las letras a formas para evitar sustituciones de tipografía.
