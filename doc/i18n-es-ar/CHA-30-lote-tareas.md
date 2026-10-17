# CHA-30 — El lote `tareas`: 540 cadenas, sobre la línea de entrega

Branch `es-ar/corte2`, worktree `/paperclip/workspaces/es-ar-corte2`. Tres
commits del lote más uno de la limpieza de H-2.

## Los números

| | |
| --- | --- |
| Cadenas del lote | 540 (154 largas + 386 cortas) |
| **Entraron al diccionario** | **494** (489 literales + 5 de formato) |
| Ya estaban traducidas | 3 |
| Quedaron afuera | 48, cada una con motivo (abajo) |

489 + 48 + 3 = 540. Las 5 de formato no son cadenas del lote: son la forma en
que **cinco de las 48 excluidas se recuperan igual** (ver «Las cuatro del visor
de Markdown»).

### El diccionario, antes y después, por área

| archivo | antes | después | delta |
| --- | --- | --- | --- |
| `agents.json` | 90 | 87 | −3 |
| `audit.json` | 13 | 13 | 0 |
| `common.json` | 542 | 571 | +29 |
| `connections.json` | 422 | 419 | −3 |
| `errors.json` | 154 | 185 | +31 |
| `issues.json` | 264 | **689** | +425 |
| `navigation.json` | 60 | 59 | −1 |
| `onboarding.json` | 4 | 4 | 0 |
| `projects.json` | 1 | 2 | +1 |
| `settings.json` | 331 | 327 | −4 |
| `traces.json` | 87 | 89 | +2 |
| **total** (sin `explicit.json`) | **1.968** | **2.445** | **+477** |

Los deltas negativos son la limpieza de H-2, que se explica más abajo: +496 del
lote y −19 de entradas muertas.

`explicit.json` no se tocó: sigue en 18 y es otra capa, por clave.

## Cómo se decidió qué entra: medir el árbol antes de escribir

**Antes de traducir una sola cadena se corrió `markText` sobre todo `ui/src` de
este worktree** y se cruzó cada una de las 540 contra el conjunto de cadenas que
los sitios marcados producen de verdad. Es el paso que evita el defecto H-2 de
CHA-28 en origen: una entrada que ningún sitio puede producir no se agrega, no
se descubre después en el reporte.

Rindió: de las 540, **33 no tienen sitio marcado** en el árbol de entrega, y
**ninguna de las 494 que entraron quedó sin cubrir**. El reporte de sitios lo
confirma: pasó de 26 sin cubrir a 7, y las 7 son las de antes, no mías.

### Un hallazgo que vale para todos los lotes que faltan

Los lotes se midieron sobre `/paperclip/workspaces/paperclip-es`
(branch `traduccion-es`), **y ese árbol no es el de la línea de entrega**:

```
$ git merge-base --is-ancestor 2cc799236 HEAD   # en paperclip-es
NO es ancestro
$ git rev-list --count HEAD..2cc799236
501
```

O sea: el commit que corre la instancia del dueño está **501 commits adelante**
de la base de upstream sobre la que se extrajeron los lotes. CHA-27 ya había
anotado que las dos ramas salen de commits distintos (`22a3ea341` vs
`2cc799236`), pero la consecuencia para la medición no estaba dicha: **los lotes
incluyen cadenas que en el árbol de entrega ya no existen**.

En este lote son **11 de 540 (2,0 %)**, y casi todas del mismo lugar: upstream
renombró la recuperación de exportaciones. `WorkspaceExportRecovery.tsx` existe
en `paperclip-es` y en el árbol de entrega es `WorkspaceFileRecovery.tsx`, con
otras oraciones («can record verified file recovery here» en lugar de «can retry
this export after repair»). Traducir las del lote habría dejado 11 entradas
muertas viajando en los dos bundles.

Lo que implica, y es decisión del Lead:

1. **Los lotes que faltan tienen el mismo sesgo**, en los dos sentidos: traen
   cadenas que ya no existen y **no traen** las que el árbol de entrega agregó.
   El número de las que faltan no se midió acá.
2. Volver a correr `measure.mjs`/`lotes.mjs` **desde este worktree** lo arregla
   de raíz. El `LEEME.md` de la medición dice correrlo desde `paperclip-es`.
3. Mientras eso no pase, el cruce contra los sitios marcados alcanza para no
   escribir entradas muertas, y cuesta un script.

## Las 48 que quedaron afuera, por motivo

### Ruido técnico: listas de clases de Tailwind — 17

`flex min-h-0 flex-1 flex-col`, `max-w-3xl space-y-6`,
`text-(--status-task-icon-done)`, `w-full justify-start gap-1`,
`aspect-video group-data-[size=sm]/attachment:w-20`,
`task-chat-loading-shell mx-auto flex …`, y 11 más. Es el ~3,2 % de ruido que el
propio extractor declara en su `LEEME.md`; CHA-25 y CHA-27 dejaron afuera 21 por
lo mismo. Ninguna llega a marcarse: el marcado de ADR 0002 **no entra a
`className`**, así que además son inalcanzables por construcción.

### No existen en el árbol de entrega — 11

Todas del renombre de upstream explicado arriba:

| Cadena | Dónde estaba |
| --- | --- |
| `Workspace export needs repair` | `WorkspaceExportRecovery.tsx` (sólo en `paperclip-es`) |
| `Retry workspace export` | idem |
| `Workspace export repair` | idem |
| `Repair performed` | idem |
| `Queueing export…` | idem |
| `A board member with runtime access can retry this export after repair.` | idem; el árbol de entrega dice otra oración |
| `Automatic workspace export retries stopped. …` | idem |
| `Could not queue export. Refresh the task and inspect its run.` | idem |
| `Describe the repair and how the saved workspace files were preserved.` | idem |
| `Export is queued for the saved result. The agent will not repeat its work.` | idem |
| `Raw Markdown` | ver abajo |

### Sin sitio marcado, aunque la cadena sí está en el código — 6

| Cadena | Por qué no se marca | Qué haría falta |
| --- | --- | --- |
| `Agent Chat is disabled in Experimental settings.` | `IssueDetail.tsx:8225`, prop `composerDisabledReason` | el nombre en `TEXT_ATTRS` (Dev/Lead, ADR 0002 §8/fase 2) |
| `Markdown preview mode` | en el árbol de entrega sólo aparece en `FileViewerSheet.test.tsx` | se recupera por formato (abajo) |
| `Rendered Markdown` | `FileViewerSheet.tsx:408` escribe `` `Rendered ${previewLabel}` `` | idem |
| `Show rendered Markdown` | `FileViewerSheet.tsx:407`, `` `Show rendered ${previewLabel}` `` | idem |
| `Show raw Markdown` | `FileViewerSheet.tsx`, `` `Show raw ${previewLabel}` `` | idem |
| `Raw Markdown` | no existe como literal; es la misma plantilla | idem |

#### Las cuatro del visor de Markdown: se recuperan por formato

El lote pedía cadenas que el árbol de entrega **no escribe como literal**: las
arma con plantillas donde `previewLabel` es `"Markdown"` o `"CSV"`. La respuesta
correcta no es la entrada literal del lote sino la **clave de formato** de
ADR 0002 §7.5, que sí está marcada. Entraron las cinco a `issues.json`:

| Clave de formato | es-AR |
| --- | --- |
| `Show rendered {0}` | Ver el {0} renderizado |
| `Show raw {0}` | Ver el {0} crudo |
| `Rendered {0}` | {0} renderizado |
| `Raw {0}` | {0} crudo |
| `{0} preview mode` | Modo de vista previa de {0} |

El hueco es siempre `Markdown` o `CSV`, los dos masculinos, así que la
concordancia cierra sin elegir género. Y cubre más que el lote: el día que
upstream agregue un tercer tipo de vista previa, ya está traducido.

### Iguales en los dos idiomas — 7

`Chat`, `Error`, `Video`, `Markdown`, `PLAN`, `Tokens`, `CSV ·`. Una entrada que
no cambia nada es ruido, suma superficie de sobretraducción y encima el test
«ninguna traducción es idéntica al inglés» la rebota (glosario §7).

### Términos de Git — 3

`Branch`, `Commit`, `Pull request`, y `Diff —` cuenta acá: traducir sólo la
mayúscula inicial de `diff` es ruido. Glosario §7.

### Fragmentos de oración partida que el español no puede ordenar — 3

`message is`, `messages are`, `waiting for recovery.` — los tres son de la misma
oración, `ExecutionBlockerNotice.tsx:70`:

```tsx
<p>{count} saved {count === 1 ? "message is" : "messages are"} waiting for recovery.</p>
```

Llega en cuatro trozos: `{count}`, `" saved "`, el condicional, y el final. El
español necesita «1 mensaje guardado está esperando la recuperación.», o sea el
sustantivo **antes** de «guardado», y el overlay no puede cambiar el orden de
los trozos (glosario §8). El trozo pivote, `saved`, **no está en ningún lote de
pantalla** —aparece sólo en ese archivo—, así que ni siquiera se podía intentar
la traducción parcial. Traducir únicamente el final habría dejado
«1 saved message is esperando la recuperación.»: peor que el inglés entero.

### Ruido técnico suelto — 1

`ctx (` — abreviatura de *context window* con el paréntesis de apertura
(`TaskChatUsageReadout.tsx:21`).

## Lo que pediría mecanismo por sitio

**Ninguna cadena de este lote**: se miraron los sitios de las 9 cortas que
aparecen en 3 o más archivos (`Removing…`, `New`, `Branch`, `Properties`, `Old`,
`Inspect run`, `Content`, `Connection`, `Add subtask`) y de las que tienen
forma de homógrafo aunque estén en un archivo solo (`Monitor`, `Override`,
`Revise`, `Queued`, `Completed`, `Step`, `Start`, `Schedule`, `Service`,
`Triage`, `First`, `Raw`, `Rendered`, `Changed`, `Runtime`, `Watchdog`…), y en
todos los casos un solo español sirve.

Los dos que podrían haber hecho falta se esquivaron eligiendo una forma que
sirve en los dos sitios, que es lo que pide el glosario:

- **`New`** es botón en `IssueDocumentsSection.tsx:900` («Nuevo documento» en
  mobile) y badge de diff en cuatro archivos más. «Nuevo» sirve en los dos;
  «Nueva» sólo en el badge de una revisión. Con **`Old` → «Anterior»** el par
  del diff queda «Anterior / Nuevo», que es como se lee un diff en castellano.
- **`Completed`** aparece en 8 archivos, como etiqueta de filtro y como
  `Completed {hace cuánto}`. «Completado» funciona de las dos formas
  («Completado hace 2 h») y esquiva el género del sujeto.

### Pero sí hay uno, y es de otra tarea: `Review`

`navigation.json` tiene `"Review"` → «Revisión», decidido en CHA-27 después de
mirar **tres** sitios, los tres sustantivo. Midiendo el árbol de entrega
completo, **`Review` tiene 17 archivos con sitio marcado**, y en al menos uno es
**verbo**:

```tsx
// IssueRunLedger.tsx:750 — dentro de la sección de silencio de salida
Review <Link …>{identificador}</Link> for recovery context.
```

Ahí se lee «Revisión CHA-30 para ver el contexto de la recuperación.», que está
mal: tendría que ser «Revisá». **No se tocó la entrada**: cambiarla rompe los
tres sitios donde sí es sustantivo, y el mecanismo por sitio no existe en esta
rama. Queda anotado como el cuarto candidato a `tEs()`, al lado de `Open`, `Run`
y `Comment` de CHA-27. La parte que sí se pudo hacer se hizo: el fragmento
`for recovery context.` entró como «para ver el contexto de la recuperación.»,
así que cuando `Review` se resuelva por sitio la oración queda entera.

## El pedido de QA: H-2 de CHA-28, de 26 sin cubrir a 7

Las 26 entradas que ningún sitio marcado produce se revisaron una por una.
**Salieron 19 y quedaron 7.** El criterio: sale la que está muerta por un motivo
**durable** —no existe en el código, vive sólo en un test, o entra por un nombre
que la lista blanca no va a aceptar nunca—; queda la que es texto visible de
producción y sólo espera un nombre en `text-sites.ts`.

### Las 19 que salieron

| Cadena | Archivo | Motivo |
| --- | --- | --- |
| `Setup prompt copied. Ready to paste into your agent.` | `agents.json` | no aparece en `ui/src` |
| `Hide routine runs` | `common.json` | no aparece en `ui/src` |
| `? This replaces the agent’s existing authentication with the responsible person’s` | `connections.json` | no aparece en `ui/src` |
| `connection. The model stays the same.` | `connections.json` | no aparece en `ui/src` |
| `Use Connections for` | `connections.json` | no aparece en `ui/src` |
| `Couldn’t open My Skills` | `errors.json` | duplicado con apóstrofo tipográfico; la versión recta ya está y sí se cubre (ADR 0002 §10.1) |
| `Ready to paste into your agent.` | `agents.json` | sólo en test/fixture |
| `The company spending limit was reached.` | `errors.json` | sólo en test (§10.1) |
| `Main company nav` | `navigation.json` | sólo en test (§10.1) |
| `sign-in…` | `connections.json` | fragmento que ningún sitio produce: producción escribe `Preparing sign-in…` y `Waiting for sign-in…` completas, y la primera ya está en el diccionario |
| `This cannot be undone.` | `errors.json` | fragmento: en producción siempre está dentro de una oración completa, y cuatro de esas oraciones ya son entradas (§10.1) |
| `2 weeks` · `4 weeks` · `3 months` · `6 months` | `settings.json` | no existen como literal; reemplazadas por dos formatos (§10.2) |
| `Not ready` · `Setup required` | `settings.json` | llegan por un atributo `value`, que **no entra a la lista blanca por nada** (§10.3) |
| `Custom advanced policy fields preserved` | `agents.json` | mismo caso: prop `value` de `PolicyRow` (`TrustPresetSection.tsx:243`) |
| `Failed to fetch` | `errors.json` | es el mensaje del navegador, no una cadena nuestra, y el ADR decide no recuperarla (§10.4) |

Las traducciones no se pierden: las de estado están en el glosario §3
(`Not ready` → «No está listo», `Setup required` → «Falta configurar») y las
demás quedan en esta tabla. Si el PM decide que las dos del `value` importan, el
camino es `tEs()` y cuesta 2 líneas de presupuesto de upstream.

### Lo que entró en su lugar: los dos formatos de §10.2

| Clave | es-AR |
| --- | --- |
| `{0} weeks` | {0} semanas |
| `{0} months` | {0} meses |

Reemplazan a las cuatro expandidas y **tapan un agujero**: antes sólo estaban
los tres presets de retención; ahora queda cubierto cualquier valor, incluso los
que upstream agregue. Los singulares `1 week` y `1 month` siguen como literales,
que es lo que el transform emite.

### Las 7 que quedaron, y el nombre que les falta

Las siete son texto visible de producción. No se marcan porque el literal está
en una prop que no está en `TEXT_ATTRS`, y **agregar nombres no es trabajo del
Traductor** (ADR 0002 §8/fase 2: «la fase 2 no es agregar nombres»). Van con el
nombre exacto para que el Lead decida:

| Cadena | Prop | Sitio |
| --- | --- | --- |
| `Loading permissions…` | `summary` | `apps/app-detail/SetupPanel.tsx:43` |
| `Choose a saved API key or enter a new one` | `instruction` | `OnboardingWizard.tsx:2840`, `new-agent/AgentProviderConnection.tsx:323` |
| `This authorization request expired` | `headline` | `IssueThreadInteractionCard.tsx:2528` |
| `Choose agents` | `triggerLabel` | `apps/app-detail/PermissionsPanel.tsx:170` |
| `capture was off` | `detail` | `RunnerInspector.tsx:1090` |
| `no exact bytes` | `detail` | `RunnerInspector.tsx:1091` |
| `Raw capture off` | `detail` | `RunnerInspector.tsx:1095` |

Cuánto cuesta y cuánto rinde, contado sobre el árbol: `summary` 6 sitios con
literal directo, `detail` 9, `triggerLabel` 6, `instruction` 2, `headline` 1.
Son nombres de componentes propios, no atributos del DOM, así que el riesgo de
marcar un dato es bajo —al revés de `value`, que es exactamente el caso que el
ADR existe para no marcar—.

**De paso, el que más rinde y no está en la lista: `emptyMessage`, con 55 sitios
con literal directo.** No es de estas 7 (ninguna entrada del diccionario cae
ahí hoy), pero es la cola más gorda que vi mirando el reporte, y es texto de
estado vacío, o sea exactamente lo que se quiere traducir.

## Términos nuevos

Los 30 que salieron de este lote están en el glosario
([glosario-es-AR.md](glosario-es-AR.md), sección «Agregadas en CHA-30»), con los
dos que valen la pena nombrar acá:

- **`Watchdog` → «Centinela».** Es una tarea que vigila otra; «perro guardián»
  no entra en una etiqueta y «watchdog» no se usa en castellano fuera de la
  jerga de sistemas. «Tarea centinela», «agente centinela».
- **`objective` → «consigna»**, para no escribir «Objetivo del objetivo».
  `Goal` sigue siendo «objetivo» (glosario §2), así que `Goal objective` quedó
  «Consigna del objetivo» y las dos oraciones de `RunnerGoalWidget` usan
  «consigna» para el texto y «objetivo» para la entidad.

## Verificación

Corrida sobre el árbol entregado, con las dos configs a propósito:

```sh
cd /paperclip/workspaces/es-ar-corte2/ui
npx vitest run src/i18n-es-ar src/i18n/locale-validation.test.ts  # 106 pasan, 19 skipped
npx vitest run --config vitest.config.es-ar.ts                    # 20 pasan
npx tsc --noEmit -p tsconfig.json                                 # 0 errores
node src/i18n-es-ar/tools/report-text-sites.ts                    # 2.445 entradas, 7 sin cubrir
```

Los 19 skipped con la config de upstream son los que necesitan el plugin y se
saltean a propósito: 12 de `real-components.es-ar.test.tsx`, 6 de
`datos-del-dueno.es-ar.test.tsx` y 1 de la capa `es`, que está vacía. Los 20 de
la config es-AR son esos dos archivos corriendo de verdad. Ninguna corrida
necesitó `--no-file-parallelism`.

**`tsc` da 0 errores, no los 777 de la línea base de CHA-27.** No es nuestro
mérito ni nuestro cambio: en este worktree ahora existe `packages/shared/dist` y
`ui/node_modules` se tocó a las 21:09 de hoy, o sea que alguien construyó los
paquetes del workspace. Lo anoto porque **la nota de los «777 errores» quedó
vieja** y porque un `tsc` limpio hace más fácil medir el próximo cambio.

### Cero archivos de upstream

```sh
$ git diff --name-only 2a50d3489..HEAD
doc/i18n-es-ar/CHA-30-lote-tareas.md
doc/i18n-es-ar/glosario-es-AR.md
ui/src/i18n-es-ar/dictionary/es-AR/*.json
```

`pnpm-lock.yaml` intacto. Presupuesto de ediciones de upstream: **12 archivos y
36 `tEs(`, sin cambio. Gastado: 0.**

### Sobre el worktree compartido

Se corrió `git status` antes de arrancar y antes de cada commit; el árbol estaba
limpio cada vez. Nunca se usó `git add -A` ni `git commit -a`: los cuatro
commits agregan archivos por ruta. Los commits se hicieron en tandas (250 / 239
/ limpieza / docs) para que un corte de ventana no se llevara el trabajo.

**No se pusheó**: el runner sigue sin credencial de GitHub. Los cuatro commits
quedan locales en `es-ar/corte2`.
