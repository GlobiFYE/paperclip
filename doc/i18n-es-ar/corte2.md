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
| 1 | ADR 0002 — que el overlay no traduzca contenido del usuario | CHA-20 | Arquitecto | **hecho y aceptado** — `b0f9aa46f` |
| 2 | Diccionario de la sección Configuración | CHA-21 | Traductor i18n | **hecho** — `9c2d1cd12` |
| 3 | Implementar el ADR 0002 (fases 1 a 3 de §8) | CHA-23 | Dev UX/UI | en curso |
| 4 | Diccionario: §10.1, §10.2 y los 6 patrones a formato | — | Traductor i18n | pendiente de la fase 1 de 3 |
| 5 | Validar las dos piezas juntas | — | QA | pendiente de 3 y 4 |
| 6 | Reconstruir el paquete y servirlo | — | Lead | pendiente de 5 |

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
  **Contestado en ADR 0002 §7.5**: van por formato, no por patrón, y con eso el
  problema desaparece — el test no se arregla ni se relaja, se queda como guarda
  del conjunto congelado de patrones.

## Estado al 2026-10-17 07:30 — el ADR está aceptado y la implementación en curso

### ADR 0002 aceptado (CHA-20, `b0f9aa46f`)

[ADR 0002](../adr/0002-marcado-del-texto-de-interfaz-en-compilacion.md): el
overlay deja de traducir «toda cadena que pasa por React» y pasa a traducir
**«toda cadena escrita en el código fuente de la interfaz, en un sitio
declarado»**. Un plugin de Vite nuestro marca los literales en tiempo de
compilación; el dato de la API no es un literal, así que queda estructuralmente
afuera. `jsx-runtime.ts` se borra.

Lo que verificó el Lead antes de aceptarlo, no tomado de palabra:

- El commit toca **un solo archivo**, el `.md` del ADR. Ni `ui/src/`, ni
  diccionario, ni upstream.
- La corrección al enunciado es correcta: `vite@8.2.2` y
  `@vitejs/plugin-react@6.1.1` instalados, `parseAst` exportado por `vite`, y
  **cero menciones de `babel`** en los tipos del plugin. **Acá no hay Babel**: el
  camino «un plugin de Babel dentro del plugin de React» no existe en este repo.
  El parser sale de `vite`, que ya es dependencia declarada: cero dependencias
  nuevas.
- `statusLabel` existe en `StatusIcon.tsx` y `KanbanBoard.tsx`;
  `"Main company nav"` sólo en `Layout.test.tsx` y en `navigation.json`.

Los números que importan, medidos por el Arquitecto sobre este worktree:
**613 de 624 entradas del diccionario (98,2 %)** siguen traduciéndose; 2.023
archivos parsean sin fallos y los 737 que el transform reescribe reparsean con
**0 corrimientos de número de línea**; el render sale idéntico 20/20 con un
agente llamado `Search` y una tarea titulada `Save`.

De las 11 que no se cubren: 4 son errores del diccionario que el esquema sacó a
la luz, 4 se arreglan mejor como formato, 2 son deliberadas (atributo `value`) y
**una sola es pérdida real**: `"Failed to fetch"`, que es el mensaje del
navegador y hoy se traduce por accidente.

### Presupuesto de ediciones a upstream: 14 líneas, intactas

ADR 0002 **gasta 0**: no toca un archivo de upstream, se activa desde
`vite.config.es-ar.ts`, que ya existe. CHA-22 confirmó que el canal de entrega
también gastó 0 (`ui/vite.config.mjs` es archivo nuevo): siguen siendo **12
archivos de upstream modificados y 36 llamadas a `tEs()`**. Y el ADR además
devuelve: 33 de esas 36 líneas quedan recuperables por el canal de
declaraciones (§9) — limpieza con su propio QA, después de validar la
implementación, no ahora.

El ADR le agrega una línea a §11 de ADR 0001: **ningún archivo de upstream**. Si
la implementación parece pedir una edición de upstream, falta un nombre en
`text-sites.ts`.

### Cómo quedó repartido

- **Dev UX/UI, [CHA-23](/chanchu-labs/issues/CHA-23)**: las tres fases de §8, con
  las reglas no negociables (edición por rangos, conservar la cantidad de saltos
  de línea, fallar el build si falta un nombre de `TEXT_DECLS`).
- **Traductor, después de la fase 1**: §10.1 (borrar 3 entradas, recortar
  `"This cannot be undone."` en las 6 oraciones completas), §10.2 (los cuatro
  `{0} weeks` / `{0} months` a formato) y migrar los 6 patrones a formato. Va
  después para que pueda verificar los formatos contra la máquina andando.
- **QA, después de 3 y 4**: §11 entero — D1–D6 (lo que tiene que dejar de
  traducirse), T1–T10 (lo que tiene que seguir) y R1–R4 (las que tienen que
  quedar en inglés). **T2 primero**: el menú de estado y los encabezados del
  tablero son la regresión más probable.

### Un cruce entre ramas, anotado para que no se pierda

`es-ar/entrega-master` tiene `ui/src/i18n-es-ar/build-channel.test.ts`, que
afirma que `vite.config.es-ar.ts` carga el plugin
`paperclip-es-ar-overlay-jsx-runtime`. La implementación de ADR 0002 borra
`jsx-runtime.ts`, así que ese nombre cambia o queda mintiendo. El Dev reporta
cómo queda el nombre nuevo y el ajuste lo hace el Lead cuando las dos ramas
converjan.

### Lo que el canal de declaraciones destraba, y queda para la tanda siguiente

CHA-15 tuvo que dejar `done` diciendo *Listo* en todas las capas porque la capa
literal no distingue el chip de estado de los seis botones *Done* de upstream.
Con el marcado son dos sitios distintos y pueden tener dos traducciones
distintas: si se quiere *Terminada* en el chip, ahora se puede. **No se abre en
el corte 2**: es una decisión de producto sobre una palabra y primero va el
blindaje.

### Riesgo abierto: no hay credenciales de git

El helper de `credential.https://github.com` espera `GH_TOKEN` y la variable no
está en el entorno de los runs de hoy. Verificado con `git push --dry-run` al
remoto `fork`: rechaza con «Password authentication is not supported». Le pasó
al Traductor y le va a pasar a cualquiera.

Qué implica: **el trabajo no se pierde** — vive en los worktrees compartidos y
en el repo local —, pero no se puede pushear ni sacar de borrador el PR #2.
Los agentes commitean y reportan; el push lo hace el Lead cuando haya token.

Revalidado a las 07:30: sigue sin haber token. `gh auth status` dice que no hay
sesión, `$GH_CONFIG_DIR` (`/paperclip/.config/gh`) no existe y
`git push --dry-run fork es-ar/corte2` rechaza con «Invalid username or token».
Sin pushear hoy: `b0f9aa46f` en `es-ar/corte2` y `9c6910526` en
`es-ar/entrega-master`.

## Estado al 2026-10-17 08:00 — ADR 0002 implementado (CHA-23, Dev UX/UI)

Las tres fases de §8, entregadas. **La máquina está puesta y el dato ya no puede
traducirse**: el diccionario puede volver a crecer.

### Qué entró

| Archivo | Qué es |
| --- | --- |
| `ui/src/i18n-es-ar/text-sites.ts` | nuevo. Las cuatro listas de §7.2, seedeadas como las entrega §8/1, sin inventar un nombre |
| `ui/src/i18n-es-ar/mark-text.ts` | nuevo. El transform: `markText(code, lang, file?)`, edición por rangos, saltos de línea conservados |
| `ui/src/i18n-es-ar/vite-plugin.ts` | cambia. `paperclipEsArTextMarking()`, sin `resolveId`, con el marcado en el `transform` |
| `ui/src/i18n-es-ar/overlay.ts` | cambia. `translate<T>` pasa lo que no es cadena, `formatted()` nuevo, `layer()` separa formatos por la clave |
| `ui/src/i18n-es-ar/jsx-runtime.ts` | **borrado**, con su hack de `resolveId` y su guarda de recursión |
| `ui/src/i18n-es-ar/tools/report-text-sites.ts` | nuevo. El reporte de la fase 3, con los cinco listados |
| `ui/src/i18n-es-ar/mark-text.test.ts` | nuevo. 41 casos: §7.2, §7.3, §7.4, entidades, saltos de línea, y los 1.269 archivos reales |
| `overlay.test.ts`, `overlay.dom.test.tsx`, `real-components.es-ar.test.tsx` | crecen o cambian (ver abajo) |

Las medidas del ADR se reprodujeron sobre el código implementado: **737 archivos
con ediciones, 19.552 sitios marcados, 0 fallos de reparseo, 0 corrimientos de
línea, 0 textos salteados por una entidad, 104 marcas bloqueadas por §7.4 en 75
cadenas distintas**. Las dos primeras y las dos últimas son los números de §6.4 y
§6.8 clavados; las 19.552 son 5 más que las 19.547 de §6.4 (0,03 %), por tres
formas de sitio que el prototipo del ADR no contaba —claves de objeto escritas
entre comillas y plantillas sin interpolación dentro de una declaración.

### Fase 2: el reporte lista exactamente las 11 de §10

**613 de 624 entradas cubiertas.** Las 11, tal como las lista el reporte, con el
canal que el propio reporte les encuentra:

| # | Entrada | §10 | Lo que dice el reporte |
| --- | --- | --- | --- |
| 1 | `Failed to fetch` | §10.4 | en `src/api/auth.ts`, sin sitio: es el mensaje del navegador |
| 2 | `Couldn’t open My Skills` | §10.1 | **no aparece en `ui/src`** (es el duplicado con apóstrofo tipográfico) |
| 3 | `The company spending limit was reached.` | §10.1 | sólo en un test |
| 4 | `This cannot be undone.` | §10.1 | en 6 archivos de producción, siempre dentro de una oración más larga |
| 5 | `Main company nav` | §10.1 | sólo en un test |
| 6 | `Not ready` | §10.3 | **atributo `value`** (producción) |
| 7 | `Setup required` | §10.3 | **atributo `value`** (producción) |
| 8–11 | `2 weeks`, `4 weeks`, `3 months`, `6 months` | §10.2 | no existen como literal; el transform emite `{0} weeks` y `{0} months` |

Ni una más, ni una menos, y ninguna pide tocar un archivo de upstream. Las cuatro
de §10.1 y las cuatro de §10.2 son trabajo del Traductor.

### El nombre del plugin, para el cruce con `es-ar/entrega-master`

El nombre **cambió**: `paperclip-es-ar-overlay-jsx-runtime` →
**`paperclip-es-ar-marcado-de-texto`**, y la función exportada
`localeOverlayJsxRuntime()` → `paperclipEsArTextMarking()`. `build-channel.test.ts`
de la otra rama afirma el nombre viejo y va a fallar cuando converjan. No se tocó
el otro worktree: el ajuste es del Lead.

### Hallazgo: las etiquetas derivadas que §10.5 no alcanza

El ADR recupera por `TEXT_DECLS` las tres funciones que CHA-9 fotografió
(`statusLabel` ×2 y `statusLabels`). Pero **la misma forma aparece en unos 50
sitios de producción más**, en archivos que `TEXT_DECLS` no lista, y el reporte
de la fase 3 **no puede verlos**: mide cobertura por *entrada del diccionario*, y
esas entradas están cubiertas por otros sitios marcados. O sea: la fase 2 pasa
limpia y la regresión existe igual.

Tres casos confirmados, afirmados como tales en
`real-components.es-ar.test.tsx` para que queden a la vista:

- `IssueStatusBadge` (`StatusBadge.tsx:20`, `sentenceCaseStatus`) → *In review*
  en inglés. Se usa en `UserProfile`, `StatusCardDetailDrawer` y `DesignGuide`;
  **las pantallas principales de tareas usan `StatusIcon`, que sí está cubierto**.
- `StatusBadge` sin `label` → deriva del valor técnico, queda en inglés.
- `blockedAttentionLabel` (`StatusIcon.tsx:46`, **el mismo archivo** que
  `statusLabel`) → el `aria-label`/`title` del glifo de una tarea bloqueada queda
  en inglés mientras la etiqueta visible dice *Bloqueada*.

**No se decidió nada ni se agregó un nombre**: §8/fase 2 dice que la fase 2 no es
agregar nombres. Recuperarlos cuesta una línea por archivo en `text-sites.ts` y
cero ediciones de upstream. Queda para el Lead.

### Dos reconciliaciones del texto del ADR, sin cambiar el diseño

1. **La firma de `markText`.** §8/2 la define `markText(code, lang)` y §8/3 la
   llama igual, pero el canal de declaraciones necesita saber qué archivo es.
   Quedó `markText(code, lang, file?)`: sin el tercer argumento es la función pura
   de §8/2 (y así la usan los tests), y el plugin le pasa la ruta relativa a
   `ui/`. El comportamiento es el de §8 sin un cambio.
2. **`real-components.es-ar.test.tsx` cambió de contrato, no sólo creció.** El
   archivo de test **no se marca** (§8/3: los tests son datos), así que un
   literal que el test pasa por props es, por construcción, un dato y ya no se
   traduce. Cinco afirmaciones del corte 1 decían lo contrario; se dieron vuelta,
   que es exactamente lo que el ADR quiere que pase. Ahora el archivo monta la
   invariante de §4 en vez de afirmarla: un agente llamado **Search** y una tarea
   titulada **Save** salen como se escribieron, **en el mismo render** donde
   `Agente` y `Listo` salen en español.

### Verificación (§8), corrida en este estado

```sh
cd /paperclip/workspaces/es-ar-corte2/ui
./node_modules/.bin/vitest run src/i18n-es-ar src/i18n/locale-validation.test.ts   # 104 pasan, 13 skipped
./node_modules/.bin/vitest run src/i18n/locale-validation.test.ts                   # 7 pasan
./node_modules/.bin/vitest run --config vitest.config.es-ar.ts                      # 12 pasan
./node_modules/.bin/tsc --noEmit -p tsconfig.json                                   # 777 errores, los mismos 777 de la línea base
node src/i18n-es-ar/tools/report-text-sites.ts                                      # 613/624, 11 sin cubrir
```

Los 13 skipped son los 12 de `real-components.es-ar.test.tsx` —que se saltea
cuando corre bajo la config de upstream, sin plugin— más el de la capa `es`, que
está vacía. Los 777 errores de `tsc` son de `storybook/` y de tipos de
`@paperclipai/shared` sin construir: **se midieron antes y después y son los
mismos**; en `ui/src/i18n-es-ar/` no hay ninguno.

Presupuesto de upstream: **12 archivos y 36 `tEs(`, intactos. Gastado: 0.**

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
