# CHA-33 — Dos lotes en una pasada: `agentes` y `rutinas`, 497 cadenas

Branch `es-ar/corte2`, worktree `/paperclip/workspaces/es-ar-corte2`. Tres
commits: dos de diccionario y uno de documentación.

Son dos lotes disjuntos que se traducen juntos:

- **`agentes`** (95 largas + 160 cortas = 255): el detalle de un agente —sus
  instrucciones, el historial de revisiones, las API keys, el libro de
  ejecuciones y la transcripción—, el alta de un agente nuevo, la lista de
  agentes, la pestaña de skills del agente y el panel de canales.
- **`rutinas`** (95 largas + 147 cortas = 242): la lista de rutinas, el detalle
  de una rutina, sus disparadores (programación, webhook y API), el editor de
  variables, el historial de revisiones y la barra de guardado.

## Los números

| | `agentes` | `rutinas` | total |
| --- | --- | --- | --- |
| Cadenas del lote | 255 | 242 | **497** |
| **Entraron al diccionario** | **234** | **224** | **458** |
| Ya estaban traducidas | 1 | 1 | 2 |
| Afuera por decisión | 13 | 8 | 21 |
| Afuera por no tener sitio marcado | 7 | 9 | 16 |

234 + 1 + 13 + 7 = 255 y 224 + 1 + 8 + 9 = 242.

Al diccionario entran **460** entradas: las 458 del lote más **2 que recuperan
por otra clave** lo que el árbol de entrega sí escribe (abajo, «Las dos
recuperadas»).

### Lo que el plan esperaba de `agents.json`, y qué pasó

El plan avisaba que «`agents.json` ya tiene 90 entradas, así que vas a
encontrar cosas hechas». El área tenía **87** y de las 255 cadenas del lote
**una sola** estaba traducida (`Revoke` → «Revocar», y ni siquiera en
`agents.json`: estaba en `common.json`). Es exactamente lo que
[CHA-32](CHA-32-lote-conectores-proyectos.md) dejó anotado: `measure.mjs`
cuenta las cadenas **pendientes contra el diccionario entero**, así que lo que
el área ya tenía quedó fuera del lote por construcción. En `rutinas` pasó lo
mismo con `Creating...` → «Creando…» (`common.json`).

Conviene no volver a leer «el área ya tiene N entradas» como «parte del lote ya
está hecho». Van tres lotes seguidos con la misma lectura torcida en el plan.

### El diccionario, antes y después, por área

| archivo | antes | después | delta |
| --- | --- | --- | --- |
| **`agents.json`** | 87 | **323** | **+236** |
| `audit.json` | 13 | 13 | 0 |
| `common.json` | 571 | 571 | 0 |
| `connections.json` | 698 | 698 | 0 |
| `errors.json` | 185 | 185 | 0 |
| `issues.json` | 689 | 689 | 0 |
| `navigation.json` | 59 | 59 | 0 |
| `onboarding.json` | 4 | 4 | 0 |
| `projects.json` | 132 | 132 | 0 |
| **`routines.json`** | — | **224** | **+224** |
| `settings.json` | 327 | 327 | 0 |
| `skills.json` | 371 | 371 | 0 |
| `traces.json` | 89 | 89 | 0 |
| **total** (sin `explicit.json`) | **3.225** | **3.685** | **+460** |

`explicit.json` no se tocó: sigue en 18.

**Un área nueva: `routines.json`.** `rutinas` no cae en ninguna área existente
—`common.json` tenía `Routine` y `Routines` y nada más—, así que se abrió
archivo nuevo, igual que `skills.json` en CHA-31. Costó las dos líneas de
siempre y **ninguna edición de upstream**: el `import` y la entrada del arreglo
en `overlay.ts`, y el `import` y la entrada de `ES_AR_AREAS` en
`overlay.test.ts`. Meter 224 entradas en `common.json` habría dejado ilegible
el diff del próximo lote.

## Cómo se decidió qué entra: medir el árbol antes de escribir

Igual que en CHA-30, CHA-31 y CHA-32: **antes de traducir una sola cadena se
corrió `markText` sobre todo `ui/src` de este worktree** y se cruzaron las 497
contra el conjunto de cadenas que los sitios marcados producen de verdad. De
las 497, **481 tienen sitio marcado** y 16 no.

El cruce guarda, por cada cadena, en cuántos archivos marcados aparece. Es lo
que deja decidir el género mirando **todos** los sitios y no la pantalla del
lote (regla 1 de CHA-31). En este lote había **54 cadenas en 3 o más
archivos**, y de ahí salieron las dos exclusiones por sitio de abajo y las
decisiones de forma sin género.

## Esta pantalla es la del nombre que escribe el dueño, y se verificó

`agentes` es donde vive el nombre que el dueño le pone a su agente, así que la
garantía central del corte 2 —un agente llamado `Search` sale `Search`— se
mide acá. Con el diccionario ya crecido a 3.685 entradas, las tres pruebas de
`datos-del-dueno.es-ar.test.tsx` siguen dando **0 traducidas**:

- las entradas de una sola palabra como **nombre de agente**: 0;
- como **título de tarea**: 0;
- como **nombre de proyecto y de archivo**: 0.

No hizo falta hacer nada para que siga siendo cierto, y ese es el punto: el
blindaje lo resuelve por construcción, porque sólo se traduce lo que es literal
en el código fuente. Ninguna entrada de este lote depende del texto en runtime.
La única cadena que aparecía **sólo como dato** era `a Task`, y no entró como
está: entró por el formato que el código escribe (abajo).

## Las 21 que quedaron afuera por decisión

### Dos españoles según el sitio — 2

El ADR 0001 revisión 2 pide resolverlas **por sitio** y ese mecanismo todavía no
existe en esta rama. Las dos de este lote **sí son del tipo que `tEs()`
arregla** —una palabra, dos sentidos—, así que compiten por el presupuesto de
`tEs(`, a diferencia de las dos de CHA-32, que eran de orden:

| Cadena | Sitios | El problema |
| --- | --- | --- |
| `Type` | **Verbo**: `components/RoutineVariablesEditor.tsx:305` (`Type {{variable_name}} anywhere in the title or instructions…` → «Escribí»). **Sustantivo**: `components/RoutineVariablesEditor.tsx:119`, `components/DecisionsToolbar.tsx:184`, `pages/apps/Connections.tsx:402`, `pages/CompanySkills.tsx:453` y seis archivos más → «Tipo» | Los dos sentidos conviven **en el mismo archivo**, con 186 líneas de distancia. «Tipo» en el sitio del verbo deja «Tipo `{{variable_name}}` en cualquier parte del título»; «Escribí» en los otros diez rompe diez encabezados de columna. Es el candidato más barato de todos los acumulados: un solo sitio hay que marcar |
| `Showing the first` | `components/CsvPreview.tsx:23` (sigue `{n} rows and {m} columns` → **filas**, femenino) y `pages/AgentDetail.tsx:4573` + `.production.tsx:4295` (sigue `{n} KB` → masculino) | «Mostrando los primeros 3 filas» o «Mostrando las primeras 64 KB»: el adjetivo va antes del número y el sustantivo viene después, en el trozo siguiente, que no es el mismo en los dos sitios. No hay forma sin género que sirva para los dos |

Con estas dos, los candidatos a `tEs()` por **sentido** acumulados en el corte 2
son nueve: `Open`, `Run`, `Comment`, `Review`, `All`, `Private`, `Installed ·` y
ahora `Type` y `Showing the first`.

### Iguales en los dos idiomas — 12

De `agentes`: `Beta`, `Beta ·`, `ID`, `KB`, `TOOLS.md`, `Prompt`,
`Harness / Runtime`, `Branch:`, `Error:` y `Worktree:`.
De `rutinas`: `Variables` y `Variables (`.

`Prompt`, `harness`, `runtime`, `branch` y `worktree` quedan en inglés por §7
del glosario, y `Error:`, `Beta`, `ID`, `KB` y `Variables` se escriben igual en
castellano. Una entrada que no cambia nada es ruido, suma superficie de
sobretraducción y el test «ninguna traducción es idéntica al inglés» la rebota.

Vale la pena decir que **tres de estas se escribieron primero y el test las
sacó**: `Branch:`, `Error:` y `Worktree:` estaban traducidas a sí mismas en el
borrador. Es la misma clase de error que el `...` de CHA-32: fácil de cometer
al traducir en tanda, imposible de que llegue al commit.

### Nombres propios — 3

`OpenRouter`, `Paperclip Runner` (de `agentes`) y `GitHub` (de `rutinas`). El
nombre del runner sí se tradujo **como descripción** en la cadena que lo
acompaña: `Native app server runner` → «Runner nativo del servidor de la app»,
que es la otra rama del mismo ternario
(`components/new-agent/NewAgentSetup.tsx:688`).

### Identificadores y valores técnicos — 4

`PAPERCLIP_*`, `{{name}}`, `{{variable_name}}` y `⌘S`. No son texto de
interfaz: son el valor que el usuario copia, escribe o teclea (§7). Igual que
los `{{skillName}}` de CHA-31.

2 + 12 + 3 + 4 = 21.

## Las 16 que no tienen sitio marcado

### Llegan por `detail` o por `summary`, que no están en `TEXT_ATTRS` — 7

| Cadena | Lote | Prop | Sitio |
| --- | --- | --- | --- |
| `The weekly schedule is enabled and can create background work.` | agentes | `detail` | `components/BuiltInBundlePanel.tsx:371` |
| `Nothing runs until you enable the weekly schedule — it costs zero tokens by default.` | agentes | `detail` | `components/BuiltInBundlePanel.tsx:372` |
| `A run is active now` | rutinas | `detail` | `components/RoutineOverview.tsx:167` |
| `No active run` | rutinas | `detail` | `components/RoutineOverview.tsx:167` |
| `Scheduled` | rutinas | `detail` | `components/RoutineOverview.tsx:179` |
| `Run manually or wait for a trigger` | rutinas | `detail` | `components/RoutineOverview.tsx:185` |
| `Setup unfinished · Events only test the connection` | rutinas | `summary` | `components/routine-triggers/RoutineTriggers.tsx:239` |

**`detail` va por el cuarto lote seguido.** CHA-30 lo puso sobre la mesa con 9
sitios, CHA-31 lo dejó en 10, CHA-32 en 11 y este lote suma 6 más. En el árbol
de entrega de hoy hay **al menos 17 `detail=` con literal, en 8 archivos**, y
el nombre **ya está en `TEXT_KEYS`** (`text-sites.ts:36`) con una excepción por
archivo para `TaskChatThread.tsx`: lo que falta es el mismo nombre en
`TEXT_ATTRS`. `summary` aparece acá por primera vez y es **un solo sitio**;
vale mucho menos.

Las traducciones no se pierden, van acá:

| Cadena | es-AR |
| --- | --- |
| `The weekly schedule is enabled and can create background work.` | La programación semanal está activada y puede crear trabajo en segundo plano. |
| `Nothing runs until you enable the weekly schedule — it costs zero tokens by default.` | No corre nada hasta que actives la programación semanal: por defecto no gasta ni un token. |
| `A run is active now` | Hay una ejecución activa ahora |
| `No active run` | No hay ninguna ejecución activa |
| `Scheduled` | Programada |
| `Run manually or wait for a trigger` | Ejecutala a mano o esperá un disparador |
| `Setup unfinished · Events only test the connection` | Falta terminar de configurar · Los eventos solo prueban la conexión |

### Ruido técnico: listas de clases de Tailwind — 4

`mx-auto w-full max-w-5xl`, `text-muted-foreground/60`,
`text-xs text-destructive` y `text-xs text-muted-foreground`, las cuatro de
`rutinas`. Es el ~3,2 % de ruido que el extractor declara en su `LEEME.md`, y
son inalcanzables por construcción: el marcado de ADR 0002 no entra a
`className`.

### Upstream las reescribió o las borró — 5

Las cinco son de `agentes`, y es el mismo sesgo de medición que CHA-30 dejó
anotado: los lotes salieron de `/paperclip/workspaces/paperclip-es` (branch
`traduccion-es`), que **no es el árbol de la línea de entrega**.

| Cadena del lote | Qué pasó |
| --- | --- |
| `Connect AgentMail, Slack, GitHub Code Review Bot, Discord, Microsoft Teams, or Telegram from Connectors.` | Hoy `components/chat/AgentChannelsPanel.tsx:60` dice `Connect an agent identity from Connectors.` o `Connect AgentMail from Connectors.` según el caso. **Las dos ramas quedan traducidas**: la segunda estaba en el lote y la primera se recupera (abajo) |
| `Couldn’t load models. You can enter a model ID manually.` | Hoy `components/new-agent/NewAgentSetup.tsx:898` dice `Could not load models. Retry or enter a model ID manually.`, que **también está en el lote** y entró. No se pierde nada |
| `a Task` | Hoy `components/new-agent/NewAgentSetup.tsx:870` lo arma con una plantilla: `` `Assign ${created.name} a Task` ``. Se recupera por la clave de formato (abajo) |
| `Using the connection selected in the Connect step.` | No existe más en el árbol de entrega |
| `Change connection` | No existe más en el árbol de entrega |

Son **5 de 497 (1,0 %)**: entre el 0,45 % de CHA-32 y el 2,4 % de CHA-31.

## Las dos recuperadas

Dos entradas de `agents.json` **no son cadenas del lote**: son la forma de
recuperar, con la clave que el árbol de entrega sí produce, lo que las
reescrituras se habían llevado. Las dos se verificaron corriendo `markText`
sobre el árbol: la primera sale como `jsx-child` y la segunda como `format`.

| Clave | es-AR | Sitio |
| --- | --- | --- |
| `Connect an agent identity from Connectors.` | Conectá una identidad de agente desde Conectores. | `components/chat/AgentChannelsPanel.tsx` |
| `Assign {0} a Task` | Asignarle una tarea a {0} | `components/new-agent/NewAgentSetup.tsx` |

La segunda es la regla 2 de CHA-30 otra vez: **las cadenas que el código arma
con una plantilla van por formato, no por literal**. La medición entregó
`a Task` porque eso es lo que vio en pantalla; el diccionario tiene que entrar
por donde el compilador lo vio escrito.

## Las decisiones de género que decidieron los sitios, no la pantalla

Todas se midieron contra **todos** sus sitios marcados.

| Cadena | Sitios | Por qué la forma elegida |
| --- | --- | --- |
| `Changed:` | `components/DevRestartBanner.tsx:88` (sigue una lista de **archivos**) y `pages/AgentDetail.tsx:1973` + `.production.tsx` (sigue una lista de **claves de configuración**, o el respaldo `no tracked changes`) | «**Cambios:**» es un sustantivo y no tiene que concordar con nada de lo que venga después. «Cambió» —que es lo que `issues.json` ya usa para la cadena `Changed` suelta— obliga a elegir número: con tres archivos hay que decir «Cambiaron» |
| `Revoked` | `pages/AgentDetail.tsx:4825` (una **API key**) y `pages/apps/AppDetail.tsx:555` (una **conexión**) | Los dos sujetos son femeninos, así que «**Revocada**» entra sin conflicto. Se verificó antes de escribirla: la pantalla sola habría mentido |
| `Restored` | `components/RoutineHistoryTab.tsx:470` (una **revisión**) | «Restaurada». Un solo sitio, pero se miró igual |
| `Provider-reported` | `components/transcript/RunTranscriptView.tsx:880` | «**Lo informó el proveedor**»: la regla 1 de CHA-27 (`X by` es verbo en pasado) aplicada a un participio compuesto. Esquiva el género de lo informado |
| `Read-only` | `pages/SkillStudio.tsx`, `pages/agent-skills/AgentSkillRow.tsx`, `pages/tools/PasteConfigTab.tsx` y dos más | «Solo lectura», que ya estaba en `skills.json` para la variante `Read only` (sin guion). Son dos claves distintas y el mismo valor |

Dos más que no son de género pero se decidieron igual mirando los sitios:

- **`Select` → «Seleccionar».** Sus seis sitios son el botón que prende el modo
  de selección múltiple (`pages/CompanySkills.tsx:1352`, `pages/Routines.tsx:966`),
  un paso de asistente (`pages/secrets/ImportFromVaultDialog.tsx:788`) y el
  título de la sección del componente en `pages/DesignGuide.tsx:1055`. Ese
  último queda raro —ahí `Select` es el **nombre del componente**—, pero
  DesignGuide es una página interna de desarrollo y no está en las doce
  pantallas del alcance. Queda dicho por si alguien lo ve.
- **`Effective` / `Requested` → «En uso» / «Pedido».**
  `components/transcript/RunTranscriptView.tsx:883` las usa como par
  (`Requested {modelo} · Effective {modelo}`). «Efectivo» es la traducción
  literal y no dice nada; «En uso» es lo que el par quiere comunicar.

## Tres costuras visibles, dichas a propósito

1. **«Esto va a revertir 3 unsaved cambios de esta sección.»**
   `components/RoutineSaveBar.tsx:171` arma
   `This will revert {dirtyCount} unsaved {change|changes} in this section.`.
   De los cuatro trozos, el lote sólo trae `This will revert` y
   `in this section.`: los trozos `unsaved` y `change`/`changes` **no están en
   ningún lote** y tampoco en el diccionario. Así que la oración queda mezclada
   hasta que entren. No se arregla por este lado: son cadenas de otro lote.
2. **«Type `{{variable_name}}` en cualquier parte del título…»**
   `components/RoutineVariablesEditor.tsx:305`. El verbo `Type` quedó afuera
   (arriba) y el resto de la oración entró, así que el primer trozo se lee en
   inglés. Es la costura que el candidato a `tEs()` cierra.
3. **«Faltan: startDate, owner».** `Missing:` →
   `components/RoutineRunVariablesDialog.tsx:547` lista nombres de variables.
   «Faltan» es plural fijo; con una sola variable se lee «Faltan: startDate».
   Es el caso del §8 del glosario y el conjunto es abierto, así que se dejó
   anotado en vez de enumerado.

## Términos nuevos

Los que salieron de estos dos lotes están en el glosario
([glosario-es-AR.md](glosario-es-AR.md), sección «Agregadas en CHA-33»). Los
cinco que vale la pena nombrar acá:

- **`Trigger` (sustantivo) → «Disparador».** Es el término central de
  `rutinas` y ya estaba decidido a medias: `issues.json` tenía el verbo
  («Last triggered» → «Se disparó por última vez»). Acá se fija el sustantivo y
  se usa parejo en las 23 entradas del área que lo nombran.
- **`Fires` → «disparos»** y **`Catch-up` → «Recuperación»**, que son el
  vocabulario de la política de ejecución de una rutina: «Próximos 5 disparos»,
  «Recuperación».
- **`Built-in` → «Incluido»**, que ya estaba en `common.json` y acá se aplicó a
  las dos cadenas que lo usan: `Built-in agent` → «Agente incluido» y
  `Built-in variables` → «Variables incluidas».
- **`Fold` → «plegado».** Es la acción del audit del sistema que cierra una
  ejecución como falso positivo porque la tarea de origen ya lo resolvió. Se
  mantuvo la metáfora del inglés porque el bloque entero
  (`components/SourceResolvedFoldCallout.tsx`) es de auditoría y no de uso
  diario; «descartado» habría chocado con `Dismiss` (§5).
- **`Preserved edits` → «ediciones conservadas».** Son las ediciones que
  sobreviven a un cambio del archivo de instrucciones; aparecen en seis
  cadenas de `pages/AgentDetail.tsx` y había que decirlas igual en las seis.

## Verificación

Corrida sobre el árbol entregado, con las dos configs a propósito:

```sh
cd /paperclip/workspaces/es-ar-corte2/ui
npx vitest run src/i18n-es-ar src/i18n/locale-validation.test.ts  # 106 pasan, 19 skipped
npx vitest run --config vitest.config.es-ar.ts \
  --no-file-parallelism --testTimeout=20000                       # 20 pasan
npx tsc --noEmit -p tsconfig.json                                 # 0 errores
node src/i18n-es-ar/tools/report-text-sites.ts                    # 3.685 entradas, 7 sin cubrir
```

Los 19 skipped de la config de upstream son los que necesitan el plugin y se
saltean a propósito; los 20 de la config es-AR son esos dos archivos corriendo
de verdad. **Con una sola config el verde miente por omisión.**

El reporte de sitios confirma tres cosas sobre las 460 entradas nuevas:

- **ninguna quedó sin cubrir.** Las 7 sin cubrir siguen siendo las 7 de CHA-30,
  no mías;
- ninguna cae en la lista de «cadenas que la regla de la comparación bloqueó»
  (las 5 del diccionario que sí caen —`File`, `Inbox`, `Paused`, `Revoke`,
  `Tasks`— son de lotes anteriores);
- las 6 que aparecen en «entradas que parecen técnicas» (`(changed)`,
  `(signal:` de `agents.json`; `(read-only)`, `Running...`, `default:`,
  `older…` de `routines.json`) están ahí **sólo porque el heurístico se dispara
  con el punto, el guion o la minúscula inicial**, como el propio reporte
  avisa. Son trozos de oración en minúscula, no identificadores: no son una
  violación de ADR 0001 §7.3.

### El rojo de la primera corrida, que era el reloj y no el diccionario

La primera corrida de la config es-AR **en paralelo** dio 1 test en rojo:
«todas las entradas de una sola palabra como nombre de agente: 0 traducidas»,
con `Test timed out in 5000ms`. Repetida con `--no-file-parallelism
--testTimeout=20000` —que es lo que pide la regla 5 del plan— pasa en 4,7 s y
las tres pruebas de datos del dueño dan 0 traducidas.

No es un defecto de las traducciones, pero **sí es una señal**: ese test
recorre el diccionario entero montando un componente por entrada, y el
diccionario acaba de pasar de 3.225 a 3.685. Con 5.000 ms de techo y la
máquina cargada, el margen ya es de medio segundo. Va abajo, en «Para otros
roles».

### Cero archivos de upstream

| commit | archivos |
| --- | --- |
| `98fd36375` | `dictionary/es-AR/agents.json` |
| `e547d39bb` | `dictionary/es-AR/routines.json`, `overlay.ts`, `overlay.test.ts` |
| este commit | `glosario-es-AR.md`, esta bitácora |

Nada fuera de `ui/src/i18n-es-ar/` y `doc/i18n-es-ar/`. Los dos archivos de
`i18n-es-ar/` que se tocaron son los del área nueva, que son nuestros (misma
operación que CHA-31 con `skills.json`). `pnpm-lock.yaml` intacto. Presupuesto
de ediciones de upstream: **12 archivos y 36 `tEs(`, sin cambio. Gastado: 0.**

### Sobre el worktree compartido

Se corrió `git status` antes de arrancar y antes de cada commit; el árbol
estaba limpio cada vez. Nunca se usó `git add -A` ni `git commit -a`: los tres
commits agregan archivos por ruta, y se verificó con `git show --name-only`.
Los lotes se commitearon en dos tandas (236 y 224) para que cada uno se pueda
leer por separado y para que un corte de ventana no se llevara el trabajo.

**No se pusheó**: el runner sigue sin credencial de GitHub. Los tres commits
quedan locales en `es-ar/corte2`.

## Para otros roles

- **Dev UX/UI (ADR 0002 §8, fase 2): `detail` en `TEXT_ATTRS`.** Cuarto lote
  seguido que lo pide; con este suman 17 sitios acumulados en el corte 2 y al
  menos 17 `detail=` con literal en 8 archivos del árbol de hoy. El nombre ya
  está en `TEXT_KEYS` con una excepción por archivo, así que la decisión de
  producto ya está tomada para la otra mitad del mismo nombre. Con él entran
  las 6 de este lote y las de CHA-30, CHA-31 y CHA-32. `summary` es un solo
  sitio: vale mucho menos.
- **Dev UX/UI: el `testTimeout` de `vitest.config.es-ar.ts`.**
  `datos-del-dueno.es-ar.test.tsx` se pasa de los 5.000 ms por defecto cuando
  corre en paralelo con el diccionario en 3.685 entradas. Pasa bien en serie y
  con 20.000 ms, pero el próximo lote lo va a dejar rojo también en serie. Es
  el mismo tipo de arreglo que CHA-29 hizo con `overlay.dom.test.tsx`. No lo
  toqué porque la config de tests no es un archivo de este rol.
- **Lead: `Type` es el candidato a `tEs()` más barato de todos.** Sus dos
  sentidos conviven en un solo archivo (`RoutineVariablesEditor.tsx`, líneas
  119 y 305) y hay **un solo sitio** que marcar —el verbo— contra diez que se
  quedan como están. Si en algún momento se gasta una edición de upstream del
  presupuesto, esta es la que más pantalla arregla por línea tocada.
- **Quien tome el próximo lote:** los trozos `unsaved`, `change` y `changes` de
  `RoutineSaveBar.tsx:171` no están en ningún lote y dejan una oración
  mezclada en el diálogo de descartar cambios. Está explicado arriba.
