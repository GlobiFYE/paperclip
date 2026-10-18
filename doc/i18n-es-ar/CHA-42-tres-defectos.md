# CHA-42 · Los tres defectos visibles de CHA-36

Corte 2, después del veredicto «cierra» de `CHA-36-validacion-cierre-corte2.md`.
**Cinco archivos tocados, los cinco dentro de `ui/src/i18n-es-ar/`: cero
ediciones de upstream, cero `pnpm-lock.yaml`, cero `package.json`, cero
presupuesto nuevo de `tEs()`.**

Entraron los tres defectos que pedía la tarea. **D-1 quedó afuera**, que es lo
que la tarea pedía para el cuarto punto: investigarlo y no forzarlo. Está medido
abajo, con el número que al Lead le faltaba.

| # | Qué | Estado |
| --- | --- | --- |
| 1 | **D-4** · el encabezado de la pantalla Skills | entró, los tres ternarios |
| 2 | **La paleta de comandos**, 14/14 pantallas | entró, **sin tocar el mecanismo** |
| 3 | **D-3** · el recorte de «Desactivado» en Rutinas | entró, con una forma menos de las tres que eligió el Lead |
| 4 | **D-1** · `New Task` en el botón de Tareas | **afuera**, medido |

---

## 1. D-4 · el encabezado de Skills

```ts
{ file: "src/pages/CompanySkills.tsx", names: ["viewTitle", "viewDescription", "searchLabel"] },
```

Los tres de una, como pedía la tarea. La salida del marcado, con los seis
literales del ternario:

```
decl "Installed skills"
decl "Discover skills"
decl "Skills available to this organization."
decl "Browse skills from every available source."
decl "Search installed skills"
decl "Search discoverable skills"
```

Los seis son literales, así que **el contador de posiciones no literales no se
movió**: sigue en 3 (gate 4).

Las cinco entradas que faltaban, en `skills.json` (`Discover skills` →
«Descubrir skills» ya estaba):

| Inglés | es-AR |
| --- | --- |
| `Installed skills` | Skills instaladas |
| `Skills available to this organization.` | Skills disponibles para esta empresa. |
| `Browse skills from every available source.` | Ver skills de todos los orígenes disponibles. |
| `Search installed skills` | Buscar skills instaladas |
| `Search discoverable skills` | Buscar skills para descubrir |

Del glosario y no inventadas: `organization` → «empresa» (§2), `Browse` → «Ver»
en la familia de skills (`Browse by category` → «Ver por categoría»,
`Browse skills.sh` → «Ver skills.sh`»), `Source` → «Origen» (§2), y
«Skills instaladas» es la forma que ya usaba `Installed skills from {0}`.

Visto en el navegador (`/CHA/skills`, 1440 px):

```
[skills es] h1="Skills instaladas"  p="Skills disponibles para esta empresa."
            aria-label="Buscar skills instaladas"  placeholder="Buscar skills instaladas…"
[skills en] h1="Installed skills"   p="Skills available to this organization."
            aria-label="Search installed skills"   placeholder="Search installed skills…"
```

El control de `?lang=en` es la mitad que importa: el mismo bundle, los mismos
datos, y en inglés sale intacto.

### Una corrección a §9 de CHA-36: `CompanySkills.production.tsx` no va

QA pidió la misma entrada «y lo mismo en `CompanySkills.production.tsx:1138`».
**En este árbol ese archivo no tiene ninguna de las tres declaraciones**: la
única aparición de la cadena es un comentario en la línea 666. Si la entrada se
agregaba igual, `declPlan` **falla el build** a propósito (`text-sites.ts`, el
`throw` de «falta la declaración»), así que no es un detalle de prolijidad.

Y hay una explicación, que es la misma que hace que D-4 se vea: `App.tsx:278`
rutea `streamlinedUiEnabled ? <CompanySkills /> : <ProductionCompanySkills />`.
La pantalla que el dueño ve —y la que midió QA— es `CompanySkills.tsx`. La
variante de producción tiene otra estructura de encabezado (`h1.text-2xl` con
`detail.name`), no el trío.

---

## 2. La paleta de comandos · **el mecanismo ya la cubría; faltaba el diccionario**

Este punto salió mucho más barato de lo que decía el plan, y el motivo vale más
que el arreglo.

La tarea y §6.3 de CHA-36 dicen que `command.tsx:34-35` es un **valor por
defecto de parámetro** y que «hoy el canal de declaraciones no los alcanza».
Medido sobre el árbol, eso no es así: **las dos cadenas ya se marcan hoy**, y no
por el canal de declaraciones sino por el de claves de objeto.

```
$ markTextWithReport("src/components/ui/command.tsx")
object-key "Command Palette"
object-key "Search for a command to run..."
jsx-text   "Close"
```

`title = "Command Palette"` dentro de la desestructuración de props es un
`Property` de un `ObjectPattern` cuyo valor es un `AssignmentPattern`, y
`mark-text.ts:568` ya desenvuelve ese caso —la línea que entró por `FoldCurtain`
(§10)— y lo manda a `TEXT_KEYS`, donde `title` y `description` están desde el
corte 1.

O sea: **las catorce pantallas se leían en inglés porque las dos cadenas no
estaban en el diccionario, no porque el transform no las alcanzara.** El arreglo
son dos líneas de JSON en `navigation.json`:

| Inglés | es-AR |
| --- | --- |
| `Command Palette` | Paleta de comandos |
| `Search for a command to run...` | Buscá un comando para ejecutar… |

«la paleta de comandos» ya era el término del producto: lo usa `search.json`
(«vuelve a abrir la paleta de comandos con la consulta que tenés escrita»).

**No hubo que ampliar el canal, así que no hubo que tocar la pieza central del
transform** — que es lo que la tarea mandaba parar y reportar. `mark-text.ts` no
tiene una línea de diferencia.

Visto con `⌘K` sobre tres pantallas (`/dashboard`, `/skills`, `/routines`),
leyendo el árbol de accesibilidad, que es donde vive este texto (`sr-only`):

```
es-AR   aria-labelledby → "Paleta de comandos"
        aria-describedby → "Buscá un comando para ejecutar…"
?lang=en aria-labelledby → "Command Palette"
        aria-describedby → "Search for a command to run..."
```

### Y `AgentContextualSidebar.tsx:54`, que la tarea invitaba a mirar

Ésta **sí** es un valor por defecto de parámetro de los que el canal de
declaraciones resuelve, y el canal **ya cubría la posición**: `declPlan` tiene
la rama `AssignmentPattern` desde que se escribió (`mark-text.ts:295-302`). Lo
único que faltaba era el nombre:

```ts
{ file: "src/components/AgentContextualSidebar.tsx", names: ["labels"] },
```

Una línea, cero cambios al transform, y la traducción ya estaba en `agents.json`.
`labels = { secrets: "Secrets & variables" }` es un literal, así que tampoco
mueve el gate 4.

```
[agente es] "Secretos y variables"
[agente en] "Secrets & variables"
```

**La clave `secrets` no entró a `TEXT_KEYS`**, y es a propósito: es técnica en
casi todos los demás sitios del árbol. El canal por archivo paga lo mismo sin el
riesgo.

`pages/Inbox.tsx:825` (`surfaceLabel = "Inbox"`) es la tercera de la familia que
nombra §6.3 y **no entró**: no estaba en el alcance de esta tarea y es una
entrada más de `TEXT_DECLS` para quien la tome. La posición ya está cubierta.

---

## 3. D-3 · la columna de 48 px de la lista de Rutinas

### La tabla de anchos medidos

El arnés: el `<span className="w-12 text-xs text-muted-foreground">` **real** de
`/CHA/routines` sobre el build es-AR, con la tipografía del build (12 px /
16 px InterVariable), reemplazando el texto y midiendo `scrollWidth` y el rango.
Reproduce el número de QA: «Desactivado» = **75 px**, igual que §6.1.

Script: `/paperclip/workspaces/.cha42/recorte.mjs`. **Caja = 48 px.**

| Forma | px | ¿entra? | Líneas | Qué se lee si se corta | Quién la propuso |
| --- | ---: | --- | ---: | --- | --- |
| **«Activa»** (`On`) | **36** | **sí** | 1 | — | Lead y CHA-41, coinciden |
| **«Archivo»** (`Archived`) | **44** | **sí** | 1 | — | Lead |
| «Inactiva» (`Off`) | 45 | sí | 1 | — | CHA-41 |
| «Borrador» (`Draft`) | 51 | **no** | 1 | «Borrado» | CHA-41 |
| «Apagada» (`Off`) | 53 | **no** | 1 | «Apagad» | Lead |
| «Archivada» (`Archived`) | 58 | **no** | 1 | «Archiva» | CHA-41 |
| «Desactivado» (`Off`, global de hoy) | 75 | **no** | 1 | «Desacti» | — (es el defecto) |
| «En archivo» (`Archived`, global) | 43 | sí | **2** | — | — |
| `On` | 17 | sí | 1 | — | inglés |
| `Off` | 20 | sí | 1 | — | inglés |
| `Draft` | 29 | sí | 1 | — | inglés |
| `Archived` | **52** | **no** | 1 | «Archive» | inglés |

Tres cosas que la tabla dice y que no estaban en ningún lado:

1. **`Archived` ya se corta en inglés**, 52 px en una caja de 48. Es un recorte
   de upstream, no nuestro —por eso el barrido de CHA-36 no lo reporta, que
   compara contra el inglés—, pero significa que traducirlo a «Archivo» (44 px)
   **arregla** un recorte que ya existía.
2. **«En archivo», el español global, no se corta: se parte en dos renglones** y
   le cambia el alto a la fila. Es la otra razón para no dejar que el global
   llegue a este sitio.
3. **«Borrador» se corta exactamente como temía CHA-41**: queda «Borrado», que
   dice algo falso. Confirmado con el número, no con la intuición.

### Lo que entró

```json
"components/RoutineList.tsx": { "Archived": "Archivo", "Off": "Off", "On": "Activa" }
```

Tres entradas en el mapa por sitio, **cero en el global**: sacar `Off` del
global lo dejaría en inglés acá y lo perdería en el resto de la app, que es el
razonamiento de §14.2 y el que pedía la tarea.

**`Off` queda en inglés en este sitio, y es el gate el que lo decide, no yo.**
«Apagada», la forma que eligió el Lead, mide **53 px**: pasa de 48 y se lee
«Apagad». La tarea lo dice con todas las letras —«La que pase de 48 px no entra:
se deja en inglés para ese sitio y lo reportás en la bitácora con el número»—,
así que la entrada es de identidad (`"Off": "Off"`), que es la forma que tiene
el mapa de decir «acá, inglés».

`Draft` no tiene entrada en ningún lado y sale en inglés (29 px, entra).

Medido en pantalla, después del cambio:

```
[routines es] [{"texto":"Off","caja":48,"contenido":48,"recorte":0},
               {"texto":"Activa","caja":48,"contenido":48,"recorte":0}]
[routines en] [{"texto":"Off","caja":48,"contenido":48,"recorte":0},
               {"texto":"On","caja":48,"contenido":48,"recorte":0}]
```

**Recorte 0 en los dos idiomas.** Antes eran 27 px sin puntos suspensivos.

### El choque con CHA-41, con los números que faltaban

Mientras esto se implementaba, el Traductor commiteó el glosario v3
(`507a08a0b`) y **revisó esta misma entrada** antes de que estuviera
commiteada. Pide **«Activa / Inactiva / Archivada / Borrador», las cuatro o
ninguna**, con dos objeciones: que `"Off": "Off"` deja la columna a medio
traducir, y que «Archivo» es un sustantivo donde va un adjetivo. Y lo deja
escrito como «es para que el Lead reconcilie».

**No lo reconcilio yo —es glosario—, pero ahora hay números y cambian el
planteo:**

- **«las cuatro» no se puede implementar.** «Archivada» mide 58 px y «Borrador»
  51: dos de las cuatro se cortan. El paquete completo no pasa el gate, y la
  salida que el propio CHA-41 declara para ese caso es «las cuatro en inglés».
- **«Inactiva» entra: 45 px.** Es la única forma propuesta para `Off` que pasa
  el gate **y** tiene respaldo del glosario, y cierra la objeción de la columna
  a medio traducir para el par del interruptor, que son los dos estados que el
  dueño ve casi siempre. **Es una línea** y la decisión es del Lead: no la tomo
  yo porque la tarea dice «La decisión de formas la tomé yo» y CHA-41 dice «es
  para que el Lead reconcilie». Las dos cosas apuntan al mismo lado.
- **«Archivo» (44 px) se queda** porque es la forma que eligió el Lead y el
  único veto que la tarea me da sobre su elección es el ancho, que lo pasa. La
  objeción de CHA-41 es semántica y su alternativa no entra en la caja.

O sea, el Lead tiene tres salidas, las tres medidas: lo que está hoy
(Activa / `Off` / Archivo), cambiar una línea a «Inactiva», o las cuatro en
inglés.

---

## 4. D-1 · afuera, y por qué — con una corrección de archivo

**No entró.** La tarea pone dos condiciones y una de las dos no se cumple.

Lo medido, agregando las declaraciones de prueba y volviendo atrás:

```ts
const createActionLabel = createIssueLabel ? __tEsFmt(["Create ", ""], [createIssueLabel]) : __tEs("Create Task");
const createButtonLabel = createIssueLabel ? __tEsFmt(["New ", ""], [createIssueLabel]) : __tEs("New Task");
```

| Condición de la tarea | Medido |
| --- | --- |
| Cero ediciones de upstream | **se cumple** |
| El contador de posiciones no literales sigue en 3 | **se cumple**: `__tEs` con argumento no literal = **0** en los dos archivos. El gate 4 cuenta `__tEs`, y la rama del template sale como `__tEsFmt`, que es otro nombre de llamada |
| «Si declarar ese local hace que el canal marque el template literal, no va» | **no se cumple**: el canal **sí** marca el template, como `__tEsFmt(["New ", ""], [createIssueLabel])` |

Las dos primeras pasan; la tercera no. Y la razón que la tarea le da a la
tercera —«es la cuarta posición y el gate 4 la rebota»— **no es lo que pasa**:
el gate 4 no la cuenta. Así que la condición que rebota a D-1 es la regla
escrita, no la medición, y eso es una decisión y no un número. La tarea dice
«investigar, no forzar» y «si no se cumplen lo dejás afuera y lo reportás», así
que queda afuera.

Lo que el Lead necesita para decidir, que es lo que no estaba:

- **`__tEsFmt` es estructuralmente seguro para el dato.** `formatted()` busca en
  el diccionario **la forma estática** (`"New {0}"`) y los valores interpolados
  «nunca pasan por el diccionario» (`overlay.ts:267-292`). No hay entrada para
  `"New {0}"` ni la hace falta, así que esa rama saldría **byte a byte igual que
  hoy**.
- **La rama del template se rinde de verdad**: `IssueDetail.tsx:4637` y `:7813`
  pasan `createIssueLabel="Sub-task"`, y `plugins/bridge-init.ts:340` lo deja
  pasar desde un plugin. No es código muerto.

### Y la corrección: el par está en **dos** archivos, no en uno

CHA-36 §6.3 y la tarea apuntan a `LegacyIssuesList.tsx:1642-1643`. El mismo par
está también en `IssuesList.tsx:1737-1738`, dentro de `StreamlinedIssuesList`, y
`IssuesList.tsx:717-718` elige entre las dos con
`useStreamlinedUiEnabled()` — **el mismo interruptor** que en `App.tsx:278` hace
que la pantalla de Skills sea `CompanySkills.tsx` y no la variante de
producción. Con el arnés de QA ese interruptor está encendido (D-4 se vio en
`CompanySkills.tsx`), así que el `New Task` que midió QA sale de
`IssuesList.tsx`, no de `LegacyIssuesList.tsx`.

**Quien tome D-1 tiene que declarar los dos archivos.** Declarar sólo el que
nombra CHA-36 no cambia nada en pantalla.

Confirmado en el navegador, que D-1 sigue vivo y sigue siendo una costura:

```
[issues es] botones: ["Nueva tarea", "Tareas", "New Task"]
```

---

## Los gates

Todos sobre el árbol de trabajo de esta entrega, con `unset NODE_PATH` antes de
cada comando de node.

| # | Gate | Invocación | Resultado | Umbral |
| --- | --- | --- | --- | --- |
| 1 | Tipos | `pnpm --filter @paperclipai/ui typecheck` | **0 errores** (salida 0) | 0 ✅ |
| 2 | Suite, config de upstream | `pnpm exec vitest run src/i18n-es-ar` | **179 pasan / 19 salteados**, 15,33 s | sin regresiones sobre 174/19 ✅ |
| 3 | Suite, config es-AR | `pnpm exec vitest run --config vitest.config.es-ar.ts` | **20 / 20**, 16,45 s | 20/20 ✅ |
| 4 | Posiciones no literales | el test `el marcado corre sobre todo el árbol sin tirar`, que corre en las dos configs | **3**: `KanbanBoard.tsx`, `StatusIcon.tsx`, `CompanyEnvironments.tsx` | exactamente 3 ✅ |
| 5 | `tEs()` fuera de `i18n-es-ar/` | `grep -rn 'tEs(' src --include=*.tsx --include=*.ts \| grep -v 'i18n-es-ar/' \| grep -vE '__tEs' \| wc -l` | **36** | 36 ✅ |
| 6 | Archivos de upstream en el diff | `git status --porcelain` | **0**: los 5 archivos están en `ui/src/i18n-es-ar/` | 0 ✅ |
| 7 | Cobertura del diccionario | `node --experimental-strip-types src/i18n-es-ar/tools/report-text-sites.ts` | **3.880 entradas · 3.876 cubiertas · 4 sin cubrir** | ≤ 4 ✅ |
| — | `pnpm-lock.yaml` y `package.json` | `git diff --stat 2cc799236 -- pnpm-lock.yaml ui/package.json package.json` | **sin una línea** | intacto ✅ |
| — | Shim de `jsx-runtime` | `git ls-files \| grep -i jsx-runtime` | **ausente** | ausente ✅ |

**Las dos configs, sí o sí**: el gate 2 saltea `real-components.es-ar.test.tsx`
a propósito y el gate 3 es el que lo corre.

Las **+5 pruebas** del gate 2 (174 → 179) son de `por-sitio.test.ts`: tres de la
columna de Rutinas, una del control de que el global de `Off` y de `Archived`
sigue intacto, y una que genera sola el describe «cada entrada del mapa pega en
un sitio que el marcado produce» al aparecer `RoutineList.tsx` en el mapa.

Las **+7 entradas** del gate 7 (3.873 → 3.880) son las 7 del diccionario: 5 de
`skills.json` y 2 de `navigation.json`. **Las 7 quedaron cubiertas**: las 4 sin
cubrir son las mismas cuatro de CHA-36.

### La pasada visual

Receta de CHA-36, las tres variables obligatorias, sobre `ui/dist-es-ar`
reconstruido (`pnpm exec vite build --config vite.config.es-ar.ts --outDir
dist-es-ar`, «✓ built in 14.72s`) y servido con `serve.mjs` en 5373.

Los tres sitios, con los ojos: el encabezado de Skills
(`.cha42/shots/skills-{es,en}.png`), la columna de Rutinas
(`routines-{es,en}.png`) y la paleta con `⌘K` (`paleta-{es,en}.png`, aunque lo
que hay que leer de la paleta es el árbol de accesibilidad, no el píxel).

Y el barrido completo de desbordes, el mismo `barrido.mjs` de QA:

| | CHA-36 (`e4dae68e3`) | esta entrega |
| --- | ---: | ---: |
| Candidatos crudos | 32 | **78** |
| El enlace «Saltar al contenido principal» (`sr-only`) | 24 | 24 |
| Mismo texto en los dos idiomas (dato de la fixture) | 6 | 6 |
| Encabezado de la paleta (`sr-only`, **nuevo**) | 0 | **48** |
| **Desbordes visibles atribuibles a la traducción** | **2** (D-3, el mismo caso en dos anchos) | **0** |

**Los 48 nuevos son la misma clase que los 24 que CHA-36 ya descontaba**, y está
medido, no supuesto: el `h2` y el `p` de la paleta viven dentro de
`<div class="… sr-only">`, con `clip-path: inset(50%)`, `overflow: hidden` y
caja de **1 × 1 px**. Su `clientWidth` es 1 px **en los dos idiomas** —en inglés
«desbordan» 86 y 200 px, en es-AR 89 y 227—, así que lo que el barrido mide es
el ancho del rectángulo de recorte de un texto invisible, no texto en pantalla.

Una nota para quien mantenga el arnés: `barrido.mjs` clasifica mirando el
`className` **del propio elemento**, y acá el `sr-only` está en el padre. Por eso
estos 48 no se auto-descuentan como los 24 del enlace de salto. No es un
defecto del barrido, es dónde upstream pone la clase.

Las dos pantallas que el barrido descarta (`/routines/rt-1` y `/agents/ag-qa`)
**son exactamente las mismas que descartaba CHA-36 §3**, y por el mismo hueco de
fixture. Escrituras bloqueadas: **ninguna**.

---

## Lo que **no** entró

- **D-1** (`New Task`), por la tercera condición de la tarea. Está todo en §4,
  con la corrección del archivo.
- **`pages/Inbox.tsx:825`** (`surfaceLabel = "Inbox"`), la tercera de la familia
  de §6.3. Fuera del alcance de esta tarea; es una entrada de `TEXT_DECLS` y la
  posición ya la cubre el canal.
- **`secrets` en `TEXT_KEYS`**: se resolvió por archivo, que cuesta lo mismo sin
  el riesgo de arrastrar claves técnicas.
- **Las 41 cadenas de §6.3** en general: son cola medida, no defecto del corte, y
  van al glosario y al Traductor.

## Para otros roles

- **Lead / glosario** · la reconciliación de D-3 con CHA-41, con los tres
  caminos medidos (§3). Si la respuesta es «Inactiva», es una línea en
  `por-sitio/es-AR.json` y dos renglones de `por-sitio.test.ts`.
- **Lead** · D-1: la condición que lo rebota es la regla escrita, no el gate 4.
  El número está en §4 y el arreglo son dos entradas de `TEXT_DECLS`, no una.
- **Arquitecto** · §6.3 de CHA-36 dice que el canal no alcanza los valores por
  defecto de parámetro. Los alcanza por dos caminos distintos (§2), y conviene
  que quede escrito antes de que alguien amplíe el transform para resolver algo
  que ya está resuelto.
- **QA / quien retome el arnés** · los 48 candidatos nuevos del barrido y por qué
  no son desbordes, al final de los gates.
