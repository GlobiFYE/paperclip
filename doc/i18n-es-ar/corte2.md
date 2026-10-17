# Corte 2 es-AR — plan y bitácora

Paraguas: **CHA-19**. Pedido del dueño en **CHA-1** (tarjeta del 2026-10-17):
«Ir al corte 2 — seguir traduciendo pantallas» y «no montar» el paquete por
ahora.

Branch `es-ar/corte2`, worktree `/paperclip/workspaces/es-ar-corte2`, sale de
`es-ar/deploy-2cc79923` — el overlay del corte 1 sobre `2cc79923`, el commit
exacto que corre la instancia del dueño en `office.chanchustudio.com`.

`node_modules` está enlazado desde el clon `/paperclip/workspaces/paperclip-es`
(raíz y `ui/`). **No corras `pnpm install`.**

## Las dos piezas, en orden

El orden no es estético. El overlay traduce toda cadena que pasa por React,
incluido el contenido que escriben las personas y los agentes: medido en el
corte 1, 7 de 26 nombres de agente probados se dieron vuelta
([CHA-9](CHA-9-pasada-visual.md)). El diccionario de Configuración agrega
decenas de palabras sueltas más, así que **traducir antes de blindar es
empeorarlo a propósito**. Por eso el paquete no se reconstruye hasta que las
dos piezas estén: lo que el dueño está usando hoy no se toca mientras tanto.

| # | Pieza | Tarea | Rol | Estado |
| --- | --- | --- | --- | --- |
| 1 | ADR 0002 — que el overlay no traduzca contenido del usuario | CHA-20 | Arquitecto | en curso |
| 2 | Diccionario de la sección Configuración | CHA-21 | Traductor i18n | en curso |
| 3 | Implementar el ADR 0002 | — | Dev UX/UI | pendiente de 1 |
| 4 | Validar las dos piezas juntas | — | QA | pendiente de 2 y 3 |
| 5 | Reconstruir el paquete y servirlo | — | Lead | pendiente de 4 |

1 y 2 van en paralelo: no comparten archivos. El Arquitecto escribe sólo
`doc/adr/0002-*.md`; el Traductor sólo `ui/src/i18n-es-ar/dictionary/**`,
`patterns.ts` y `doc/i18n-es-ar/glosario-es-AR.md`.

## Línea base verificada antes de delegar (2026-10-17)

```sh
cd /paperclip/workspaces/es-ar-corte2/ui
./node_modules/.bin/vitest run src/i18n-es-ar src/i18n/locale-validation.test.ts   # 54 pasan, 8 skipped
./node_modules/.bin/vitest run --config vitest.config.es-ar.ts                      # 7 pasan
```

La primera corrida de la segunda línea puede dar timeout por caché fría del
transform: volvé a correrla antes de reportar una falla.

## Lo que sigue vigente del corte 1

- [ADR 0001](../adr/0001-traduccion-es-ar-por-overlay-en-jsx.md) entero, y en
  particular **§11, lo que no se toca nunca**.
- El presupuesto de ediciones a archivos de upstream: tope ~50, gastadas 36
  líneas sobre 12 archivos. Cada edición nuestra es un conflicto en cada
  `git pull` de upstream, para siempre.
- El paquete en vivo vive en la capa del contenedor (`/app/ui/dist`), sin
  montaje: sobrevive un `restart` y se pierde al recrear el contenedor. Es la
  decisión del dueño, no un olvido. Respaldo en inglés y script de
  reconstrucción en `/paperclip/ui-es-ar/`.
- `rebuild.sh` lista los commits del overlay a mano (`OVERLAY_COMMITS`).
  **Cuando el corte 2 entre, hay que actualizar esa lista**, o el script va a
  reconstruir el corte 1.
