# CHA-34 — Los seis lotes chicos: Búsqueda, Panel, Nueva tarea, Bandeja, Auditoría y Artefactos

Branch `es-ar/corte2`, worktree `/paperclip/workspaces/es-ar-corte2`. Dos
commits: uno de diccionario y uno de documentación.

Son los seis lotes que cierran el alcance que pidió el dueño. Entran juntos
porque sueltos no justifican una corrida cada uno:

- **Búsqueda** (17 largas + 24 cortas = 41): la pantalla de búsqueda, su barra
  de filtros, el menú de orden y la recuperación de cero resultados.
- **Panel** (10 + 29 = 39): el panel, sus tarjetas de métricas, sus gráficos, el
  panel de agentes activos, la tarjeta del Smoke Lab y las ejecuciones en vivo.
- **Nueva tarea** (18 + 19 = 37): el diálogo de tarea nueva, el selector de
  worktree del redactor y los dos lugares de secretos de usuario que ese
  diálogo muestra adentro.
- **Bandeja** (11 + 18 = 29): la bandeja de entrada, su pestaña de bloqueadas,
  sus avisos y el diálogo de marcar todo como leído.
- **Auditoría** (7 + 6 = 13): la lista de ejecuciones y la actividad de una
  rutina.
- **Artefactos** (1 + 7 = 8): la pantalla de artefactos, su búsqueda y su
  agrupado.

## Los números

| | Búsqueda | Panel | Nueva tarea | Bandeja | Auditoría | Artefactos | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cadenas del lote | 41 | 39 | 37 | 29 | 13 | 8 | **167** |
| **Entraron al diccionario** | **37** | **39** | **34** | **25** | **12** | **8** | **155** |
| Afuera por decisión | 2 | 0 | 3 | 0 | 0 | 0 | 5 |
| Afuera por no tener sitio marcado | 2 | 0 | 0 | 4 | 1 | 0 | 7 |

37 + 2 + 2 = 41, 34 + 3 = 37, 25 + 4 = 29, 12 + 1 = 13. **Panel y Artefactos
entraron enteros**: son los dos únicos lotes del corte 2 sin una sola
exclusión.

Al diccionario entran **179** entradas: las 155 del lote más **24
recuperaciones** (abajo).

### El diccionario, antes y después, por área

| archivo | antes | después | delta |
| --- | --- | --- | --- |
| `agents.json` | 323 | 323 | 0 |
| **`artifacts.json`** | — | **9** | **+9** |
| **`audit.json`** | 13 | **25** | **+12** |
| **`common.json`** | 571 | **579** | **+8** |
| `connections.json` | 698 | 698 | 0 |
| **`dashboard.json`** | — | **43** | **+43** |
| `errors.json` | 185 | 185 | 0 |
| **`inbox.json`** | — | **26** | **+26** |
| **`issues.json`** | 689 | **708** | **+19** |
| **`navigation.json`** | 59 | **61** | **+2** |
| `onboarding.json` | 4 | 4 | 0 |
| `projects.json` | 132 | 132 | 0 |
| `routines.json` | 224 | 224 | 0 |
| **`search.json`** | — | **41** | **+41** |
| **`secrets.json`** | — | **19** | **+19** |
| `settings.json` | 327 | 327 | 0 |
| `skills.json` | 371 | 371 | 0 |
| `traces.json` | 89 | 89 | 0 |
| **total** (sin `explicit.json`) | **3.685** | **3.864** | **+179** |

`explicit.json` no se tocó: sigue en 18.

**Cinco áreas nuevas**, una por pantalla: `search.json`, `dashboard.json`,
`inbox.json`, `artifacts.json` y `secrets.json`. Es la regla 3 de CHA-31 —
ninguno de esos cinco lotes cae en un área existente, y abrir archivo cuesta
dos líneas (el `import` y la entrada del arreglo en `overlay.ts`, el `import` y
la entrada de `ES_AR_AREAS` en `overlay.test.ts`) y **cero ediciones de
upstream**. Las 139 entradas de esos cinco archivos en `common.json` habrían
dejado ilegible el diff del próximo lote.

Dos repartos que vale explicar:

- **Nueva tarea se partió en dos áreas.** `NewIssueDialog.tsx` y el selector de
  worktree son tareas y van a `issues.json` (19 entradas). Los otros 15 son de
  `pages/secrets/` —el banner de secretos faltantes y el diálogo para poner el
  valor propio, que el diálogo de tarea nueva renderiza adentro— y abren
  `secrets.json`. El Lead dejó el **resto** de Secrets fuera del corte 2
  (412 candidatos crudos); el archivo queda sembrado con lo que la pantalla de
  tarea nueva sí muestra, y etiquetado como lo que es.
- **Auditoría va al `audit.json` que ya existía**, que es su área. Pasó de 13 a
  25 entradas.

## Cómo se decidió qué entra: medir el árbol antes de escribir

Igual que en CHA-30, CHA-31, CHA-32 y CHA-33: **antes de traducir una sola
cadena se corrió `markText` sobre todo `ui/src` de este worktree** y se cruzaron
las 167 contra el conjunto de cadenas que los sitios marcados producen de
verdad. De las 167, **160 tienen sitio marcado** y 7 no.

El cruce guarda, por cada cadena, en qué archivos marcados aparece y con qué
clase de sitio. Es lo que deja decidir el género mirando **todos** los sitios y
no la pantalla del lote (regla 1 de CHA-31): en este lote hubo **10 cadenas en 3
o más archivos**, y de ahí salió la decisión de `Archived` que está más abajo.

## El Panel, que es el que el dueño miró

El enunciado lo dice: en la pasada visual del corte 1 el Panel quedó mezclado
—barra lateral y leyenda en español, tarjetas de métricas en inglés— y es el
lote que más se nota por cadena traducida. [CHA-35](CHA-35-build-en-el-worktree.md)
lo había dejado anotado como **H-3**, con la lista exacta de lo que se veía en
inglés. Esa lista queda cerrada así:

| Lo que CHA-35 vio en inglés | Ahora | De dónde salió |
| --- | --- | --- |
| «Agents Enabled» | Agentes activados | lote |
| «Tasks In Progress» | Tareas en curso | lote |
| «Month Spend» | Gasto del mes | lote |
| «Pending Approvals» | Aprobaciones pendientes | lote |
| «Run Activity» | Actividad de ejecuciones | lote |
| «Tasks by Status» | Tareas por estado | lote |
| «Success Rate» | Tasa de éxito | lote |
| «RECENT TASKS» | Tareas recientes | lote |
| «Last 14 days» | Últimos 14 días | **recuperada** |
| «See all agents» | Ver todos los agentes | **recuperada** |
| «Skip to Main Content» | Saltar al contenido principal | **recuperada** |
| «No recent agent runs.» | — | **no existe en el árbol de entrega** |

Las tarjetas además tienen una línea de descripción abajo del número, y esa
línea **no está en ningún lote**: son las palabras sueltas `running`, `paused`,
`errors`, `open` y `blocked`. Traducir el rótulo y dejar la descripción en
inglés es la misma mezcla que el dueño marcó, un renglón más abajo, así que
entraron como recuperaciones. La tarjeta queda:

> **Agentes activados** · 12 · 3 en curso, 2 en pausa, 1 errores
> **Tareas en curso** · 4 · 9 abiertas, 2 con bloqueo
> **Gasto del mes** · US$ 120 · 45 % de un presupuesto de US$ 260
> **Aprobaciones pendientes** · 3 · 2 excepciones de presupuesto esperando la revisión del directorio

## Las 24 recuperadas, y la regla con la que se eligieron

Una recuperada es una cadena que **no está en ningún lote** pero que cierra una
oración o un control que sí lo está. La medición las dejó afuera porque entrega
el literal que vio en pantalla (CHA-30, regla 2) y porque no cuenta plantillas
con interpolación (`LEEME.md` de la medición). Sin ellas, media oración del
Panel, de la Bandeja y de Búsqueda queda en inglés.

La regla que se usó, dicha para que el próximo lote la pueda aplicar igual:
**se recupera una cadena sólo si (a) es trozo de una oración o de un control
cuyo resto sí es de este lote, y (b) todos sus sitios marcados admiten la misma
forma española.** La condición (b) se verificó corriendo `markText` sobre todo
`ui/src` y mirando los sitios, nunca grepeando.

| Clave | es-AR | Sitios | Por qué |
| --- | --- | --- | --- |
| `{0} results match` | Coinciden {0} resultados | ZeroResultsRecovery | la rama plural de `1 result matches` |
| `{0} active filters hide` | los {0} filtros activos esconden | ZeroResultsRecovery | la rama plural de `active filter hides` |
| `The server returned {0}.` | El servidor respondió {0}. | Search | la otra rama de `The request failed.` |
| `type` | escribí | Search (1) | el trozo entre `Identifier lookup:` y `to jump straight to a task.` |
| `result` / `results` | resultado / resultados | ZeroResultsRecovery, TaskChatProtocolActivityRow | el `+3 results` de cada sugerencia |
| `or` | o | Search, NewIssueDialog, SystemNoticeUxLab | cierra dos oraciones de este lote |
| `has` / `have` / `it` / `them` | no tiene / no tienen / lo / los | MissingUserSecretsBanner (1 cada una) | los cuatro ternarios de **la misma** oración |
| `requested` | lo pidió | Inbox, LegacyInbox | abre la fila cuyo `from IP` y `adapter:` sí son del lote |
| `errors` | errores | Dashboard, Inbox, LegacyInbox | cierra el aviso de la Bandeja y la tarjeta del Panel |
| `running` / `paused` | en curso / en pausa | Dashboard + WorkspaceServiceControlBar / CompanyImport | descripción de la tarjeta de agentes |
| `open` | abiertas | Dashboard (1) | descripción de la tarjeta de tareas |
| `blocked` | con bloqueo | Dashboard, IssuesList, LegacyIssuesList, ImportFromVaultDialog | ídem; ver abajo por qué sin género |
| `Last 14 days` | Últimos 14 días | Dashboard, AgentDetail, UserProfile | subtítulo de los gráficos del Panel |
| `See all agents` | Ver todos los agentes | SidebarAgents ×2 | H-3 de CHA-35 |
| `Skip to Main Content` | Saltar al contenido principal | Layout ×2 | H-3 de CHA-35 |
| `{0}% of {1} budget` | {0} % de un presupuesto de {1} | Dashboard | la otra rama de `Unlimited budget` |
| `{0} budget overrides awaiting board review` | {0} excepciones de presupuesto esperando la revisión del directorio | Dashboard | la otra rama de `Awaiting board review` |
| `{0} imported agent{1} paused and will not run.` | Agentes importados en pausa: {0}. No van a correr. | Dashboard | el título del banner cuyo cuerpo sí es del lote |
| `Group artifacts (currently {0})` | Agrupar los artefactos (ahora: {0}) | Artifacts | el `aria-label` del control cuyo `title` sí es del lote |

## Las 5 que quedaron afuera por decisión

### `Backlog` — decisión del dueño, todavía abierta

La cadena está en `nueva-tarea--cortas.json` y el glosario §3 dice «Reserva»,
así que se escribió. **El test la rebotó**, y tenía razón:
`overlay.dom.test.tsx` fija que `Backlog` se queda en inglés por la **decisión
9.3 del diccionario**, escalada al dueño como pregunta de glosario
([CHA-15](CHA-15-nombres-de-estado.md), H-1). El test existe justamente para que
agregar la entrada obligue a cambiar el documento primero, y el documento no lo
cambia el Traductor.

Así que se sacó. Su sitio en este lote es
`NewIssueDialog.tsx:1338` —el nombre del estado en negrita, dentro de la nota de
tarea asignada en reserva— y queda en inglés, igual que ya quedaba dentro de la
cadena larga de `issues.json`. **Para el Lead**: es una palabra, con un test que
la sostiene, y aparece en 5 archivos; si el dueño contesta «Reserva», es una
línea.

### `Worktrees` y `Worktrees ·` — §7, término de Git

Los dos son del selector de worktree del redactor
(`ComposerWorktreePicker.tsx`). `worktree` queda en inglés por §7 del glosario,
así que la traducción sería idéntica al inglés y el test «ninguna traducción es
idéntica al inglés» la rebota. La oración que los nombra sí entró, y nombra la
sección como la ve el usuario: `Couldn't check the selected worktree. Retry in
Worktrees or choose New worktree.` → «No se pudo revisar el worktree elegido.
Reintentá en Worktrees o elegí uno nuevo».

### `⌘K` y `⌘K:` — teclas

La tecla no es texto de interfaz: es lo que el usuario teclea (§7). Mismo
criterio que `⌘S` en CHA-33. El resto del renglón del tip sí entró, así que se
lee «**⌘K:** vuelve a abrir la paleta de comandos con la consulta que tenés
escrita».

## Las 7 que no tienen sitio marcado

### Listas de clases de Tailwind — 6

Dos de Búsqueda (`line-clamp-1 truncate`, `line-clamp-2 leading-relaxed`, las
dos de `SearchResultRow.tsx:267`) y cuatro de Bandeja
(`pointer-events-none -translate-x-4 scale-(--s-0_98) opacity-0 transition-all
duration-200 ease-out`, `rounded-lg px-3 sm:pl-0 sm:pr-4`, `px-3 sm:px-4`,
`transition-all duration-200 ease-out`). Es el ~3,2 % de ruido que el extractor
declara en su `LEEME.md`, y son inalcanzables por construcción: el marcado de
ADR 0002 no entra a `className`.

### Upstream la borró — 1

`Review what happened, inspect agent runs, and understand the costs and budget
controls behind your organization.` era el subtítulo del encabezado de
Auditoría. Hoy `pages/audit/AuditHub.tsx:84-88` tiene el `<h1>Audit</h1>` y nada
más: el párrafo no existe. En
`/paperclip/workspaces/paperclip-es` —el árbol del que salió la medición— sigue
estando, en `AuditHub.tsx:89`.

Es **1 de 167 (0,6 %)**, el sesgo de medición más bajo de los seis lotes del
corte 2 (CHA-31 2,4 %, CHA-33 1,0 %, CHA-32 0,45 %).

## Las decisiones de género y de forma que decidieron los sitios

Todas se midieron contra **todos** sus sitios marcados, no contra la pantalla
del lote.

| Cadena | Sitios | Por qué la forma elegida |
| --- | --- | --- |
| `Archived` | **9 archivos**: tareas (`IssueProperties.tsx:2948`), rutinas (`RoutineList.tsx:189`), perfiles (`ProfilesIndex.tsx:192`, `ProfilesTab.tsx:1068`), definiciones de secreto (`UserSecretDefinitionsTab.tsx:316`), secretos (`Secrets.tsx:3318`), tarjetas de estado (`status-card-state.ts:106`) y las dos bandejas | «**En archivo**». Los sujetos van de «tarea» y «rutina» (femenino) a «perfil» y «secreto» (masculino), así que ni «Archivada» ni «Archivado» sirven parejo. Es la regla 2 de CHA-27 —cuando hay forma sin género se prefiere esa— y la misma familia que `Parked` → «En reserva» y `Running` → «En curso» |
| `blocked` *(recuperada)* | tareas en `Dashboard.tsx:422` e `IssuesList.tsx:642`; filas de importación en `ImportFromVaultDialog.tsx:1469` | «**con bloqueo**», por lo mismo: «bloqueadas» miente en el tercer sitio. Misma forma que `Unhealthy` → «Con problemas» |
| `Earlier` | `ActivityFeed.tsx`, las dos bandejas y `attention.ts:818` | «**Anteriores**»: encabeza un grupo de ítems de cualquier tipo, y el plural del adjetivo no tiene género |
| `Failed run` | `attention.ts:61` y las dos bandejas | «**Falló la ejecución**». `Failed` suelto ya era «Falló» (§7, CHA-32); con el verbo adelante no hay que concordar nada y el renglón se lee como un aviso: «Falló la ejecución — Lila» |
| `requested by` *(recuperada)* | las dos bandejas, en la fila de una aprobación | «**a pedido de**». La regla 1 de CHA-27 daría «lo pidió», que obliga a elegir a qué se refiere «lo»; «a pedido de Ana» no concuerda con nada |
| `Active / recent` | `DashboardLive.tsx:52` | «**Activas / recientes**»: el único sitio son ejecuciones, y se verificó antes de escribirlo |
| `All statuses` | `AuditRuns.tsx` y `Secrets.tsx` | «Todos los estados»: «estado» es masculino en los dos sitios |

Dos más que no son de género pero se decidieron igual mirando los sitios:

- **`All stacks` → «Todos los stacks».** `stack` es el nombre del montón de
  artefactos de una tarea. Queda en inglés y **masculino**, como `pool` y
  `gateway` (§7), por una razón concreta: las cadenas hermanas de la misma
  pantalla (`No artifact stacks yet.`, `No artifacts in this stack match the
  current filters.`) **no están en ningún lote**, así que «Todas las pilas»
  habría quedado al lado de «No artifact stacks yet».
- **`Integration smoke` → «Smoke de integración».** `Smoke Lab` es nombre de
  producto y no se traduce, así que traducir «smoke» en la tarjeta que manda a
  esa pestaña habría dejado dos palabras distintas para lo mismo.

## Cinco costuras visibles, dichas a propósito

1. **«Esto va a marcar 3 sin leer items como leídos.»**
   `Inbox.tsx:2684` arma `This will mark {n} unread {item|items} as read.`. De
   los cinco trozos, el lote trae `This will mark` y `as read.`; `unread` ya
   decía «sin leer» desde el corte 1 (`navigation.json`), y `item`/`items` no
   están en ningún lote. **Y aun con los tres traducidos la oración no cierra**:
   el español pone el adjetivo detrás del sustantivo («3 elementos sin leer»),
   así que hay que mover el orden. Es un caso de **orden**, como los dos de
   CHA-32 (`connection?`, `’s email address`): no lo arregla `tEs()`, lo arregla
   la clave punteada de §7.5. **No compite por el presupuesto de `tEs(`.**
2. **«No encontramos nada en all scopes.»** `Search.tsx:865`. El ámbito sale de
   `describeScope()`, que devuelve `SCOPE_LABELS[scope]` o el literal
   `"All scopes"`, y **ninguno de los dos se marca**: el mapa está indexado por
   valor técnico y la función no está en `TEXT_DECLS`. Es el hallazgo de las
   etiquetas derivadas de CHA-23 (§10.5), y acá se paga caro porque el **mismo
   mapa rotula las siete pestañas de Búsqueda** (`Search.tsx:484`): All, Tasks,
   Comments, Documents, Artifacts, Agents, Projects. Va abajo, para Dev UX/UI:
   es **una línea** en `text-sites.ts`.
3. **«2 secreto de usuarios a tu cargo…»**
   `MissingUserSecretsBanner.tsx:64`. La oración tiene cuatro ternarios y tres
   se recuperaron (`has`, `have`, `it`, `them`), así que queda entera en español
   **menos la `s` del plural**, que es un literal `"s"` suelto con **31 sitios**
   en la app: tocarlo es imposible y dejarlo pega la ese al final de «usuario».
   La misma `s` aparece en `active budget incident{s}` del Panel («2 incidente
   de presupuesto activos») y en el banner de agentes importados, donde el
   formato sí la pudo esquivar (abajo). En singular —que es el caso normal— la
   oración sale perfecta: «1 secreto de usuario a tu cargo no tiene valor
   todavía. Las ejecuciones que lo necesiten van a fallar hasta que pongas el
   valor.»
4. **«En revisión · a pedido de Ana · updated hace 1 hora.»** `updated` tiene
   **7 sitios** en seis pantallas distintas y no está en ningún lote. No es mío
   y no se recupera: con siete sitios hay que mirarlos todos antes de elegir
   entre «se actualizó» y «actualizada».
5. **«Presupuesto al 92% de uso este mes.»** El glosario pide «92 %» con
   espacio, y acá no se puede: el `%` lo escribe el código entre los dos trozos
   (`Inbox.tsx:3332-3334`), no la traducción. Donde el `%` vive **dentro** de un
   formato sí se arregló: `{0}% of {1} budget` → «{0} % de un presupuesto de
   {1}».

## Dos cosas que salieron de este lote y valen para los que vengan

1. **Un formato puede tirar un hueco, y eso resuelve la morfología inglesa.**
   `{0} imported agent{1} paused and will not run.` trae en `{1}` el
   `" is"`/`"s are"` que el inglés necesita y el español no. `formatted()`
   reemplaza por índice, así que una traducción que **no menciona** `{1}`
   simplemente lo descarta; el test de §7.5 sólo pide que no se use un hueco
   que la clave no tiene y que no se pierdan *todos*. Quedó «Agentes importados
   en pausa: {0}. No van a correr.», que además esquiva el número. Es la salida
   que no tienen las cadenas partidas: ahí los trozos siempre se concatenan.
2. **Una palabra de una sola letra o de una sola sílaba se decide por la cuenta
   de sitios, no por lo que parece.** `has`, `have`, `it` y `them` suenan
   intraducibles y tienen **un solo sitio cada una**, así que entraron sin
   riesgo y arreglaron una oración entera. `s` suena igual de inocente y tiene
   **31**. La diferencia no se ve leyendo la cadena: hay que correr `markText`.

## Términos nuevos

Los que salieron de estos seis lotes están en el glosario
([glosario-es-AR.md](glosario-es-AR.md), sección «Agregadas en CHA-34»).

## Verificación

Corrida sobre el árbol entregado, con las dos configs a propósito:

```sh
cd /paperclip/workspaces/es-ar-corte2/ui
npx vitest run src/i18n-es-ar src/i18n/locale-validation.test.ts  # 106 pasan, 19 skipped
npx vitest run --config vitest.config.es-ar.ts                    # 20 pasan
npx tsc --noEmit -p tsconfig.json                                 # 0 errores
node src/i18n-es-ar/tools/report-text-sites.ts                    # 3.864 entradas, 7 sin cubrir
```

Las dos configs, a propósito: con la de upstream se saltean los 19 que necesitan
el plugin. **Con una sola config el verde miente por omisión.**

Esta vez la config es-AR **pasó en paralelo**: 20 en 16,7 s, sin el timeout que
CHA-33 avisó que venía. Igual sigue siendo el pedido de abajo: el diccionario
pasó de 3.685 a 3.864 y `datos-del-dueno.es-ar.test.tsx` monta un componente
por entrada contra un techo de 5.000 ms.

El reporte de sitios confirma tres cosas sobre las 179 entradas nuevas:

- **ninguna quedó sin cubrir.** Las 7 sin cubrir son las mismas 7 que ya
  reportaba CHA-33, ninguna de este lote;
- de las que aparecen en «entradas que parecen técnicas» —`open`, `adapter:`,
  `requested`, `type`, `has`, `have`, `it`, `them`, `blocked`, `errors`, `or`,
  `paused`, `result`, `results`, `running`— ninguna es un identificador: el
  heurístico del reporte se dispara con la minúscula inicial, y son trozos de
  oración en minúscula, como ya pasaba con `unread`, `days` y `decisions` de
  lotes anteriores;
- **tres entradas nuevas caen en «cadenas que la regla de la comparación
  bloqueó»** (§7.4): `paused`, `result` y `running`. La lista pasó de 5 a 8
  cadenas del diccionario. No es un defecto y conviene entender por qué: la
  regla de §7.4 **no marca** el literal en el sitio donde el código lo compara
  (`state === "running"`), así que el valor técnico nunca pasa por el
  diccionario; la entrada sólo actúa en los sitios de texto, que son los que se
  midieron antes de escribirla.

### Cero archivos de upstream

| commit | archivos |
| --- | --- |
| `eef5c1aea` | los 5 archivos de área nuevos, `audit.json`, `issues.json`, `common.json`, `navigation.json`, `overlay.ts`, `overlay.test.ts` |
| este commit | `glosario-es-AR.md`, `cierre-corte2.md`, esta bitácora |

Nada fuera de `ui/src/i18n-es-ar/` y `doc/i18n-es-ar/`. Los dos archivos de
`i18n-es-ar/` que se tocaron son los del cableado de las áreas nuevas, que son
nuestros (misma operación que CHA-31 con `skills.json` y CHA-33 con
`routines.json`). `pnpm-lock.yaml` intacto, verificado con
`git show --name-only`. Presupuesto de ediciones de upstream: **12 archivos y
36 `tEs()`, sin cambio. Gastado: 0.**

### Sobre el worktree compartido

Se corrió `git status` antes de arrancar y antes de cada commit; el árbol estaba
limpio cada vez. Nunca se usó `git add -A` ni `git commit -a`: los dos commits
agregan archivos por ruta, y se verificó con `git show --name-only`.

**No se pusheó**: el runner sigue sin credencial de GitHub. Los dos commits
quedan locales en `es-ar/corte2`.

## Para otros roles

- **Dev UX/UI: `SCOPE_LABELS` y `describeScope` en `TEXT_DECLS`.** Es **una
  línea** en `text-sites.ts` (`{ file: "src/pages/Search.tsx", names:
  ["SCOPE_LABELS", "describeScope"] }`) y cero ediciones de upstream, y con ella
  entran **las siete pestañas de Búsqueda** más el ámbito que hoy deja «No
  encontramos nada en all scopes». Seis de las siete etiquetas ya están
  traducidas en el diccionario; la séptima es `All`, que es una de las
  candidatas a `tEs()` (ver el cierre). Es el arreglo con mejor relación
  pantalla/línea que encontré en todo el corte 2.
- **Dev UX/UI: `detail` en `TEXT_ATTRS`.** Quinto lote seguido que lo pide.
  Este lote no agrega sitios nuevos; lo que agrega es la cuenta medida sobre el
  árbol de entrega, en [el cierre](cierre-corte2.md) §3.2: con ese nombre entran
  **6 cadenas** de `RoutineOverview.tsx`, `BuiltInBundlePanel.tsx` e
  `IdentitiesSection.tsx`, y es el único nombre de la lista que recupera más de
  una.
- **Dev UX/UI: el `testTimeout` de `vitest.config.es-ar.ts`.** Sigue en 5.000 ms
  con el diccionario en 3.864 entradas. Esta vez pasó en paralelo, pero el
  margen lo fija el tamaño del diccionario y el diccionario sólo crece. Mismo
  arreglo que CHA-29 hizo con `overlay.dom.test.tsx`; no lo toco porque la
  config de tests no es un archivo de este rol.
- **Lead: `Backlog` es una palabra y una decisión.** La pregunta está escalada
  al dueño desde CHA-15 (decisión 9.3). Si contesta «Reserva», es una línea de
  `issues.json` y una línea del test que hoy la fija. Mientras no conteste,
  queda en inglés en 5 archivos, uno de ellos la nota de tarea asignada en
  reserva de este lote.
- **Quien tome un lote de Secrets:** `secrets.json` ya existe con las 19
  entradas que la pantalla de tarea nueva muestra. El resto de Secrets (412
  candidatos crudos) sigue fuera del corte 2 por decisión del Lead.
