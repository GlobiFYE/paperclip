# CHA-32 — Dos lotes en una pasada: `conectores` y `proyectos`, 440 cadenas

Branch `es-ar/corte2`, worktree `/paperclip/workspaces/es-ar-corte2`. Cinco
commits: tres de diccionario, uno de las dos recuperadas y uno de
documentación.

Son dos lotes disjuntos que se traducen juntos:

- **`conectores`** (130 largas + 167 cortas = 297): Conectores, el detalle de
  una app conectada, el flujo de conexión, los gateways, los pools de
  conexiones de IA y el alta de email con AgentMail.
- **`proyectos`** (46 largas + 97 cortas = 143): las propiedades de un
  proyecto, su base de código, los espacios de trabajo de ejecución, el panel
  de presupuesto y el resumen generado por el Summarizer.

## Los números

| | `conectores` | `proyectos` | total |
| --- | --- | --- | --- |
| Cadenas del lote | 297 | 143 | **440** |
| **Entraron al diccionario** | **279** | **128** | **407** |
| Ya estaban traducidas | 1 | 3 | 4 |
| Afuera por decisión | 8 | 9 | 17 |
| Afuera por no tener sitio marcado | 9 | 3 | 12 |

279 + 1 + 8 + 9 = 297 y 128 + 3 + 9 + 3 = 143.

Al diccionario entran **409** entradas: las 407 del lote más **2 que recuperan
por otra clave** lo que el árbol de entrega sí escribe (abajo, «Las dos
recuperadas»).

### Una expectativa del plan que no se cumplió, y por qué

El plan avisaba que `conectores` «ya tiene 422 entradas del corte 2 anterior
(`connections.json`), así que vas a encontrar bastante ya traducido». No pasó:
de las 297 cadenas, **una sola** estaba traducida. No es una contradicción, es
cómo se armó la medición: `measure.mjs` cuenta las cadenas **pendientes contra
el diccionario**, así que las 419 que `connections.json` ya tenía quedaron
fuera del lote por construcción. Las 4 que sí aparecen como «ya estaban» son
entradas que crecieron en **otras áreas** después de que se midiera el lote:

| Cadena | Ya estaba en | Lote |
| --- | --- | --- |
| `Connections` → «Conexiones» | `settings.json` | conectores |
| `Archiving...` → «Archivando…» | `settings.json` | proyectos |
| `Danger Zone` → «Zona de riesgo» | `settings.json` | proyectos |
| `Saved` → «Guardado» | `common.json` | proyectos |

Conviene no volver a leer «el área ya tiene N entradas» como «parte del lote ya
está hecho»: el solapamiento real se mide contra el diccionario entero, no
contra el área.

### El diccionario, antes y después, por área

| archivo | antes | después | delta |
| --- | --- | --- | --- |
| `agents.json` | 87 | 87 | 0 |
| `audit.json` | 13 | 13 | 0 |
| `common.json` | 571 | 571 | 0 |
| **`connections.json`** | 419 | **698** | **+279** |
| `errors.json` | 185 | 185 | 0 |
| `issues.json` | 689 | 689 | 0 |
| `navigation.json` | 59 | 59 | 0 |
| `onboarding.json` | 4 | 4 | 0 |
| **`projects.json`** | 2 | **132** | **+130** |
| `settings.json` | 327 | 327 | 0 |
| `skills.json` | 371 | 371 | 0 |
| `traces.json` | 89 | 89 | 0 |
| **total** (sin `explicit.json`) | **2.816** | **3.225** | **+409** |

`explicit.json` no se tocó: sigue en 18.

**Ningún archivo de área nuevo.** Los dos lotes caen en áreas que ya existen,
así que —a diferencia de CHA-31, que tuvo que abrir `skills.json`— acá no hubo
que tocar ni `overlay.ts` ni `overlay.test.ts`. `projects.json` existía con dos
entradas de adorno; ahora es un área de verdad.

## Cómo se decidió qué entra: medir el árbol antes de escribir

Igual que en [CHA-30](CHA-30-lote-tareas.md) y
[CHA-31](CHA-31-lote-skills.md): **antes de traducir una sola cadena se corrió
`markText` sobre todo `ui/src` de este worktree** y se cruzaron las 440 contra
el conjunto de cadenas que los sitios marcados producen de verdad. De las 440,
**428 tienen sitio marcado** y 12 no.

El cruce guarda, por cada cadena, en cuántos archivos marcados aparece. Eso es
lo que deja decidir el género mirando **todos** los sitios y no la pantalla del
lote, que es la regla 1 de CHA-31. En este lote había **31 cadenas en 3 o más
archivos**, y de ahí salieron las tres decisiones de forma sin género de abajo.

## Las 17 que quedaron afuera por decisión

### Dos españoles según el sitio — 2

El ADR 0001 revisión 2 pide resolverlas **por sitio** y ese mecanismo todavía no
existe en esta rama (el marcado de ADR 0002 emite `__tEs(texto)` sin identidad
del sitio). Las dos de este lote **no son de género**: son de orden de palabras,
que `tEs()` tampoco arregla. Van igual con archivo y línea, porque son las que
pedirían mecanismo por sitio:

| Cadena | Sitios | El problema |
| --- | --- | --- |
| `connection?` | `pages/apps/Browse.tsx:1022` y `pages/apps/Connections.tsx:548` | `Remove {accountName ?? "this"} connection?` llega como tres trozos: `"Remove"`, el nombre, `"connection?"`. El español necesita «¿Quitar la conexión {nombre}?», o sea el nombre **después** del sustantivo y el `¿` en el primer trozo. El overlay no puede cambiar el orden de los trozos (glosario §8). Y hay una vuelta de tuerca: el otro sitio dice **`Delete`**, no `Remove`, así que el mismo trozo final cuelga de dos verbos distintos |
| `’s email address` | `pages/apps/chat/EmailEndpointSetup.tsx:365` y `:637` | `{chosen?.name}’s email address` → «La dirección de email de {agente}»: el posesivo inglés va antes del sustantivo y el español después. Mismo problema de orden |

### Iguales en los dos idiomas — 5

`Personal`, `Asc`, `Desc`, `HTTPS` y `Webhook`. Los cuatro primeros se escriben
igual en castellano (`Asc`/`Desc` son la abreviatura de
«ascendente»/«descendente» también acá) y `Webhook` es término técnico que en
es-AR se usa en inglés. Una entrada que no cambia nada es ruido, suma
superficie de sobretraducción y el test «ninguna traducción es idéntica al
inglés» la rebota (glosario §7).

### Nombres propios — 3

`Arcade`, `Composio` y `Browser Use Cloud`: nombres de producto (§7). El
`Summarizer` corrió la misma suerte **dentro** de las oraciones que sí
entraron: «Summarizer está en pausa», «Configurar el Summarizer».

### Identificadores y valores técnicos — 7

`.paperclip/worktrees`, `origin/main`, `{{issue.identifier}}-{{slug}}`,
`bash ./scripts/provision-worktree.sh`,
`bash ./scripts/provision-worktree-runtime.sh`,
`bash ./scripts/teardown-worktree.sh` y
`ssh.railway.com ssh-ed25519 …`. No son texto de interfaz: son el valor que el
usuario copia o escribe (§7). Igual que los `{{skillName}}` de CHA-31.

2 + 5 + 3 + 7 = 17.

## Las 12 que no tienen sitio marcado

### Ruido técnico: listas de clases de Tailwind — 7

`rounded-xl border border-border bg-card p-4`,
`rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground`,
`py-5 text-sm text-muted-foreground`, `size-4 animate-spin`,
`truncate text-xs text-destructive`, `truncate text-xs text-muted-foreground`,
`group text-foreground/55`. Es el ~3,2 % de ruido que el extractor declara en
su `LEEME.md`, y son inalcanzables por construcción: el marcado de ADR 0002 no
entra a `className`.

### Llegan por un nombre que no está en la lista blanca — 3

| Cadena | Prop | Sitio | Qué haría falta |
| --- | --- | --- | --- |
| `Dedicated to one agent` | `detail` | `pages/apps/app-detail/IdentitiesSection.tsx:191`, `detail={dedicatedAgent ? (…) : "Dedicated to one agent"}` | el nombre `detail` en `TEXT_ATTRS` |
| `Choose people` | `triggerLabel` | `pages/apps/app-detail/IdentitiesSection.tsx:548` | el nombre `triggerLabel` en `TEXT_ATTRS` |
| `Shell Git and gh use this account for the run and are not constrained by per-tool Ask-first controls.` | `permissionChangeWarning` | `pages/apps/AppDetail.tsx:706` | el nombre `permissionChangeWarning` en `TEXT_ATTRS` |

**`detail` ya va por el tercer lote seguido.** CHA-30 lo puso sobre la mesa con
9 sitios, CHA-31 lo dejó en 10, y con este suma **11**. Y hay un detalle que
vale la pena para quien lo implemente: `detail` **ya está en `TEXT_KEYS`**
(`text-sites.ts:36`) y además tiene una excepción por archivo para
`TaskChatThread.tsx` (`:86`); lo que falta es el mismo nombre en `TEXT_ATTRS`,
que es la lista de los atributos de JSX. O sea que no es una decisión nueva de
producto: es la misma que ya se tomó para la variante «clave de propiedad»,
aplicada a la variante «atributo».

Las traducciones no se pierden: «Dedicada a un solo agente», «Elegir personas»
y «Shell, Git y gh usan esta cuenta para la ejecución y no quedan limitados por
los controles de Preguntar primero de cada herramienta».

### Upstream las reescribió — 2

Las dos de `BudgetPolicyCard.tsx`, y las dos se recuperan (abajo).

| Cadena del lote | Qué dice hoy el árbol de entrega |
| --- | --- |
| `Execution is paused for this project until the budget is raised or the incident is dismissed.` | `…until the budget block is resolved.` |
| `Heartbeats are paused for this scope until the budget is raised or the incident is dismissed.` | `…until the budget block is resolved.` |

Es el sesgo de la medición que CHA-30 dejó anotado y CHA-31 confirmó: los lotes
salieron de `/paperclip/workspaces/paperclip-es` (branch `traduccion-es`), que
**no es el árbol de la línea de entrega**. Acá son **2 de 440 (0,45 %)**, mucho
menos que el 2,4 % de CHA-31.

## Las dos recuperadas

Dos entradas de `projects.json` **no son cadenas del lote**: son la forma en
que las dos reescritas se recuperan igual, con la clave que el árbol de entrega
sí produce (`jsx-child` en `BudgetPolicyCard.tsx`). Mismo movimiento que las
dos recuperadas de CHA-31.

| Clave | es-AR |
| --- | --- |
| `Execution is paused for this project until the budget block is resolved.` | La ejecución de este proyecto está en pausa hasta que se resuelva el bloqueo de presupuesto. |
| `Heartbeats are paused for this scope until the budget block is resolved.` | Los ciclos de actividad de este alcance están en pausa hasta que se resuelva el bloqueo de presupuesto. |

## Las tres decisiones de género que decidieron los sitios, no la pantalla

Las tres se midieron contra **todos** sus sitios marcados, y las tres entraron
en una forma que esquiva el género. Es la regla 2 de CHA-31 aplicada antes de
que doliera: ninguna de las tres necesitó `tEs()`.

| Cadena | Sitios | Por qué la forma elegida |
| --- | --- | --- |
| `Failed` | **14 archivos**: `ActivityCharts.tsx:136` (leyenda del gráfico de ejecuciones), `ArtifactsPanel.tsx:81`, `IssueRunLedger.tsx:120`, `IssueThreadInteractionCard.tsx:191/495`, `WorkspaceServiceControlBar.tsx:78` y ocho más | «**Falló**» es un verbo: sirve para «la ejecución» y «el servicio» sin elegir género. «Fallido/Fallida» obligaba a elegir en una etiqueta que rotula ejecución, artefacto, interacción y servicio |
| `Make default` | `ai-connections/AiConnectionAccountControls.tsx:40` y `pages/Secrets.tsx` | Los dos sitios tienen géneros distintos: una **cuenta** de IA (femenino) y un **secreto** (masculino). «Poner por defecto» es infinitivo y sin género; «Hacer predeterminada» habría roto el segundo sitio |
| `Managed by` | `pages/ProjectDetail.tsx:787` (`Managed by {pluginDisplayName}`, sujeto: el **proyecto**) y `pages/apps/Browse.tsx:1248` (sujeto: la **conexión**) | «**A cargo de**» no tiene género. «Administrado por» lo tiene, y la regla 1 de CHA-27 (`X by` → verbo en pasado) no sirve acá: «Administra {proveedor}» se lee como si el proveedor fuera el objeto |

Dos más que no eran conflicto pero se verificaron igual, porque la pantalla sola
habría mentido:

- **`Latest` → «Última».** Sus cuatro sitios son todos femeninos:
  `SummarySlotCard.tsx:237/278` (revisión), `CompanySkills.tsx:2333` y
  `AgentsUsingSkillDialog.tsx:357` (versión). Conviene anotar que esa última
  está **dentro del archivo cuyo `behind latest` CHA-31 dejó afuera**: la
  cadena entera no se podía, el `Latest` suelto sí.
- **`Shared` → «Compartida».** Sus tres sitios son cuenta
  (`SubscriptionCostCard.tsx:100`), conexión
  (`AiConnectionPoolConnector.tsx:180`) y credencial
  (`BrowserUseSettingsPanel.tsx:176`): los tres femeninos. Deja una costura, y
  va abajo.

## Dos costuras visibles, dichas a propósito

Igual que el «Empresa / Private / Pública» que CHA-31 prefirió antes que
escribir un género equivocado:

1. **`Shared credential 1`.** `BrowserUseSettingsPanel.tsx:176` arma
   `{g.kind === "user" ? "Personal" : "Shared"} credential {i + 1}`. «Shared»
   entró como «Compartida» (bien, el sujeto es la credencial) pero el orden del
   español pide «Credencial compartida 1», y el overlay no puede reordenar los
   trozos. Así que ese `<option>` se lee «Compartida credential 1»: el
   adjetivo adelante y el sustantivo en inglés, porque el trozo `" credential "`
   —en minúscula, dentro de la oración— **no está en ningún lote**. Entrada
   sugerida para quien tome el próximo: `credential` → «credencial» no alcanza;
   esta necesita la clave punteada de §7.5 o quedarse como está.
2. **`Soft alert at {n}%`.** Entró como «Aviso en», que preserva el orden y se
   lee «Aviso en 80 %». Es más corto que el inglés y pierde el matiz de
   «soft» (que el aviso no bloquea), pero ese matiz ya lo da el contexto: al
   lado está el corte duro, que entró como «En pausa por el corte duro de
   presupuesto».

## Un hueco que no es de este lote, y conviene anotar

El `Git status` del panel de proyecto entró como «Estado de Git», y los
encabezados que lo acompañan también («Archivos con cambios sin commitear»,
«Archivos sin seguimiento», «Adelante / atrás»). Pero el panel escribe también
`{n} ahead` y `{n} behind` como trozos contados, y esos **no están en el
lote**: es el caso del §8 del glosario, donde el número y la palabra son dos
hijos distintos del JSX. Mientras no entren, esa línea queda mezclada.

## Términos nuevos

Los que salieron de estos dos lotes están en el glosario
([glosario-es-AR.md](glosario-es-AR.md), sección «Agregadas en CHA-32»). Los
cinco que vale la pena nombrar acá:

- **`connection manager` → «quien administra las conexiones».** Es un rol, y en
  castellano un rol en singular obliga a elegir género («el encargado»). La
  forma con «quien» lo esquiva y además se lee natural en las cinco oraciones
  del lote que lo usan. El mismo movimiento resolvió `credential owner` y
  `authorization owner`.
- **`pool` → «pool».** Ya venía de las 419 entradas que `connections.json`
  tenía: queda en inglés y es masculino («este pool», «los pools de
  conexiones»). Se respetó en las seis cadenas nuevas que lo nombran.
- **`checkout` → «checkout».** Término de Git (§7), igual que `worktree`,
  `branch` y `commit`. Es el término central del lote `proyectos`: «los
  checkouts aislados por tarea», «el checkout principal del proyecto».
- **`Codebase` → «Base de código»**, que es la sección de un proyecto donde se
  define el repo y la carpeta local. «Código base» dice otra cosa.
- **`Teardown` → «desmontaje»** y **`Provision` → «aprovisionamiento»**, el par
  de comandos del worktree derivado.

## Verificación

Corrida sobre el árbol entregado, con las dos configs a propósito:

```sh
cd /paperclip/workspaces/es-ar-corte2/ui
npx vitest run src/i18n-es-ar src/i18n/locale-validation.test.ts  # 106 pasan, 19 skipped
npx vitest run --config vitest.config.es-ar.ts                    # 20 pasan
npx tsc --noEmit -p tsconfig.json                                 # 0 errores
node src/i18n-es-ar/tools/report-text-sites.ts                    # 3.225 entradas, 7 sin cubrir
```

Los 19 skipped de la config de upstream son los que necesitan el plugin y se
saltean a propósito; los 20 de la config es-AR son esos dos archivos corriendo
de verdad. **Con una sola config el verde miente por omisión**, así que las dos
se corrieron en cada tanda.

El reporte de sitios confirma tres cosas sobre las 409 entradas nuevas:

- **ninguna quedó sin cubrir.** Las 7 sin cubrir siguen siendo las 7 de CHA-30,
  no mías;
- ninguna cae en la lista de «cadenas que la regla de la comparación bloqueó»
  (las 5 del diccionario que sí caen —`File`, `Inbox`, `Paused`, `Revoke`,
  `Tasks`— son de lotes anteriores);
- las 4 que aparecen en «entradas que parecen técnicas» (`Checking...`,
  `Generating...`, `Resuming...`, `Unarchiving...`) están ahí **sólo porque el
  heurístico se dispara con el `.` de los tres puntos**, como el propio reporte
  avisa. Tienen la misma forma que las que ya estaban (`Sending...`,
  `Archiving...`): no son una violación de ADR 0001 §7.3.

### Una invariante que me rebotó, y está bien que lo haga

La primera corrida del lote `conectores` 2/2 dio **1 test en rojo**: «los
puntos suspensivos son siempre el carácter … y nunca tres puntos». Había
traducido `Checking...` → «Revisando...», copiando los tres puntos del inglés.
La regla fina es que **la clave copia el código** (`...` y `…` son dos claves
distintas para el overlay, glosario §6) pero **el valor traducido usa siempre
`…`**. Las cuatro entradas de este lote con `...` en la clave
(`Checking...`, `Generating...`, `Resuming...`, `Unarchiving...`) quedaron con
`…` en el valor, igual que las que ya estaban en `common.json` y
`settings.json`. No fue un defecto del test: fue el test haciendo su trabajo
sobre una distinción que es fácil de leer al revés.

### Cero archivos de upstream

| commit | archivos |
| --- | --- |
| `963883728` | `dictionary/es-AR/connections.json` |
| `391335dc0` | `dictionary/es-AR/connections.json` |
| `c1273f455` | `dictionary/es-AR/projects.json` |
| `037a8a8ba` | `dictionary/es-AR/projects.json` |
| este commit | `glosario-es-AR.md`, esta bitácora |

Nada fuera de `ui/src/i18n-es-ar/dictionary/` y `doc/i18n-es-ar/`. Este lote
**no tocó ni `overlay.ts` ni `overlay.test.ts`**, porque no abrió área nueva.
`pnpm-lock.yaml` intacto. Presupuesto de ediciones de upstream: **12 archivos y
36 `tEs(`, sin cambio. Gastado: 0.**

### Sobre el worktree compartido

Se corrió `git status` antes de arrancar y antes de cada commit; el árbol estaba
limpio cada vez. Nunca se usó `git add -A` ni `git commit -a`: los cinco commits
agregan archivos por ruta. Los commits se hicieron en tandas (126 / 153 / 128 /
2 / docs) para que un corte de ventana no se llevara el trabajo, y cada lote
cierra con su propio commit para que se puedan leer por separado.

**No se pusheó**: el runner sigue sin credencial de GitHub. Los cinco commits
quedan locales en `es-ar/corte2`.

## Para otros roles

- **Dev UX/UI o Lead (ADR 0002 §8, fase 2):** `detail` en `TEXT_ATTRS`. Van
  **11 sitios** acumulados entre CHA-30, CHA-31 y este lote, y el nombre ya
  está en `TEXT_KEYS` con una excepción por archivo, así que la decisión de
  producto ya está tomada para la otra mitad del mismo nombre. Con él entran
  `Dedicated to one agent` y las nueve de CHA-30. `triggerLabel` y
  `permissionChangeWarning` son un sitio cada uno: valen mucho menos.
- **Quien tome el próximo lote:** el trozo `" credential "` en minúscula
  (`BrowserUseSettingsPanel.tsx:176`) y los contados `ahead` / `behind` del
  panel de Git no están en ningún lote y dejan dos líneas mezcladas. Están
  explicados arriba.
