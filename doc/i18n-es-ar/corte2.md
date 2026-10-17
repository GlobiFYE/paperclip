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
| 2 | Diccionario de la sección Configuración | CHA-21 | Traductor i18n | **hecho** — `9c2d1cd12` |
| 3 | Implementar el ADR 0002 | — | Dev UX/UI | pendiente de 1 |
| 4 | Validar las dos piezas juntas | — | QA | pendiente de 2 y 3 |
| 5 | Reconstruir el paquete y servirlo | — | Lead | pendiente de 4 |

1 y 2 van en paralelo: no comparten archivos. El Arquitecto escribe sólo
`doc/adr/0002-*.md`; el Traductor, `ui/src/i18n-es-ar/dictionary/**`,
`patterns.ts`, `doc/i18n-es-ar/glosario-es-AR.md` y su bitácora
`doc/i18n-es-ar/CHA-21-configuracion.md` (esta última faltaba en la lista
original; la bitácora por tarea sigue el patrón de CHA-9 y CHA-15 y se queda
ahí).

## Estado al 2026-10-17 07:00 — relevo de Lead

El Lead anterior se terminó por error y la cadena de reporte quedó rota un
rato: CHA-20 y CHA-22 tienen un comentario del sistema de 06:39 diciendo que no
podía seguir la recuperación automática. La cadena ya está reparada y las dos
corridas se relanzaron a las 07:00.

- **CHA-21, hecho y aceptado.** 386 entradas nuevas en seis pantallas de
  Configuración (navegación, General, Profile, Members/Access, Connections,
  Environments), glosario copiado al repo como original en
  `glosario-es-AR.md`, y 3 patrones nuevos. Línea base revalidada con el commit
  encima: 54 pasan / 8 skipped y 7 pasan con `vitest.config.es-ar.ts`.
- **CHA-20, en curso.** El Arquitecto está escribiendo
  `doc/adr/0002-marcado-del-texto-de-interfaz-en-compilacion.md`. Le pasé los
  dos hallazgos de CHA-21: que el blindaje tiene que cubrir la capa de patrones
  con captura libre y no sólo los literales, y la pregunta de los contados
  abiertos (ver abajo).
- **CHA-22, en curso** (canal de entrega, worktree `es-ar-entrega-master`). El
  Dev resolvió el hueco del build por defecto con un `ui/vite.config.mjs` nuevo
  que reexporta la config es-AR, sin tocar archivos de upstream.

### Decisiones de alcance del Lead

- **El resto de Configuración no entra al corte 2**: Secrets (412 candidatos
  crudos), Experimental (164), Import (87), Plugins (81), Adapters (77) y
  Export (41). Va a un corte propio, con Secrets como tarea separada por tamaño
  y por lo partidas que están sus oraciones. Mismo criterio que ordena este
  corte: cada palabra suelta agregada antes del blindaje empeora la
  sobretraducción a propósito.
- **Las cinco líneas de `.tsx` para §7.5 que ofreció CHA-21 esperan al ADR
  0002.** Son ediciones sobre upstream y el saldo del presupuesto depende de lo
  que gaste el blindaje. Las entradas de `explicit.json` se agregan recién
  cuando haya línea, para no dejar claves muertas.
- **Pendiente de respuesta del Arquitecto**: `overlay.test.ts:247` deriva el
  literal singular de un patrón cambiando `(\d+)` por `1` sin despluralizar, así
  que ningún patrón con número pasa el test — ni el ejemplo de ADR 0001 §7.4.
  Los contados abiertos (`{n} agents`, `{n} places`, …) no tienen salida por
  diccionario hasta que se decida si se corrige la derivación o pasan a §7.5.

### Riesgo abierto: no hay credenciales de git

El helper de `credential.https://github.com` espera `GH_TOKEN` y la variable no
está en el entorno de los runs de hoy. Verificado con `git push --dry-run` al
remoto `fork`: rechaza con «Password authentication is not supported». Le pasó
al Traductor y le va a pasar a cualquiera.

Qué implica: **el trabajo no se pierde** — vive en los worktrees compartidos y
en el repo local —, pero no se puede pushear ni sacar de borrador el PR #2.
Sin pushear hoy: `9c2d1cd12` en `es-ar/corte2` y `9c6910526` en
`es-ar/entrega-master`. Los agentes commitean y reportan; el push lo hace el
Lead cuando haya token.

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
