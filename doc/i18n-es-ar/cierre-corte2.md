# Cierre del corte 2 — cobertura real

Escrito al terminar [CHA-34](CHA-34-lote-seis-pantallas.md), que es el último
lote del alcance. Es la cuenta de qué quedó traducido, qué no y por qué, juntando
los ocho lotes del corte: CHA-21 (Configuración), CHA-25 y CHA-27 (compartidos),
CHA-30 (tareas), CHA-31 (skills), CHA-32 (conectores y proyectos), CHA-33
(agentes y rutinas) y CHA-34 (las seis pantallas chicas).

Todo lo de acá se midió sobre el árbol de entrega —worktree
`/paperclip/workspaces/es-ar-corte2`, branch `es-ar/corte2`— corriendo
`markText` sobre todo `ui/src` y cruzando los 26 archivos de lote de
`/paperclip/workspaces/.i18n-medicion/lotes/` contra el diccionario. No sale de
sumar los números de las bitácoras.

## 1. El diccionario, por área

| archivo | entradas | de qué pantalla es |
| --- | --- | --- |
| `issues.json` | 708 | tareas: detalle, chat, visor de archivos, libro de ejecuciones |
| `connections.json` | 698 | conectores, apps conectadas, gateways, pools de IA |
| `common.json` | 579 | lo que alcanza dos o más pantallas |
| `skills.json` | 371 | biblioteca de skills, Skill Studio, orígenes |
| `settings.json` | 327 | Configuración (las seis pantallas de CHA-21) |
| `agents.json` | 323 | detalle y alta de un agente, canales, transcripción |
| `routines.json` | 224 | rutinas, disparadores, variables, revisiones |
| `errors.json` | 185 | mensajes de error |
| `projects.json` | 132 | proyectos, base de código, presupuesto |
| `traces.json` | 89 | inspector del runner, frames |
| `navigation.json` | 61 | navegación, barra lateral |
| `dashboard.json` | 43 | Panel y ejecuciones en vivo |
| `search.json` | 41 | Búsqueda |
| `inbox.json` | 26 | Bandeja |
| `audit.json` | 25 | Auditoría |
| `secrets.json` | 19 | los secretos de usuario que muestra Nueva tarea |
| `artifacts.json` | 9 | Artefactos |
| `onboarding.json` | 4 | alta inicial |
| **total** | **3.864** | |
| `explicit.json` | 18 | el escape de §7.5, aparte |

El reporte de la fase 3 de ADR 0002 dice: **3.864 entradas, 3.857 cubiertas por
un sitio marcado, 7 sin cubrir**. Las 7 están clasificadas una por una en §10 del
ADR y en [CHA-30](CHA-30-lote-tareas.md); ninguna es un hueco de traducción.

## 2. La cobertura contra lo medido

La medición del corte 2 encontró **3.549 cadenas pendientes** en el alcance que
pidió el dueño (las doce pantallas, Configuración excluida), repartidas en 26
archivos de lote sin repetir ninguna entre lotes.

| Lote | Cadenas | Traducidas | Afuera | Tarea |
| --- | --- | --- | --- | --- |
| Compartidos | 1.489 | 1.391 | 98 | CHA-25 + CHA-27 |
| Tareas | 540 | 492 | 48 | CHA-30 |
| Skills | 416 | 373 | 43 | CHA-31 |
| Conectores | 297 | 280 | 17 | CHA-32 |
| Agentes | 255 | 235 | 20 | CHA-33 |
| Rutinas | 242 | 225 | 17 | CHA-33 |
| Proyectos | 143 | 131 | 12 | CHA-32 |
| Búsqueda | 41 | 37 | 4 | CHA-34 |
| Panel | 39 | **39** | **0** | CHA-34 |
| Nueva tarea | 37 | 34 | 3 | CHA-34 |
| Bandeja | 29 | 25 | 4 | CHA-34 |
| Auditoría | 13 | 12 | 1 | CHA-34 |
| Artefactos | 8 | **8** | **0** | CHA-34 |
| **total** | **3.549** | **3.282** | **267** | |

**3.282 de 3.549 = 92,5 %.**

Dos cosas que ese número no dice y conviene decir:

- **El diccionario tiene 3.864 entradas y las cadenas traducidas del alcance son
  3.282.** Las otras **582 no vienen de ningún lote**, y es la cuenta exacta:
  son las del corte 1, las 386 de Configuración (CHA-21, anterior a la
  medición) y las **recuperaciones** de cada lote —cadenas que la medición no
  entregó, porque da el literal que vio en pantalla y no cuenta plantillas con
  interpolación, pero que cierran una oración o un control que sí entregó—.
- **Panel y Artefactos son los dos únicos lotes que entraron enteros.** Panel es
  el que el dueño marcó en la pasada visual del corte 1.

## 3. Las 267 que quedaron afuera, por motivo

El reparto de abajo se midió, no se estimó: por cada una de las 267 se preguntó
si tiene sitio marcado en el árbol de entrega, si aparece en el código y si el
archivo donde aparece es de producción o de test.

| Motivo | Cadenas | Qué haría falta para que entren |
| --- | --- | --- |
| **Quedaron afuera por decisión** (tienen sitio marcado) | **147** | ver §3.1 |
| **Listas de clases de Tailwind** | **58** | nada: son inalcanzables por construcción |
| **No existen en el árbol de entrega** | **36** | nada: upstream las reescribió o las borró |
| **Texto de producción sin sitio declarado** | **21** | un nombre en `text-sites.ts` |
| **Sólo aparecen en archivos de test** | **5** | nada: los tests son datos (ADR 0002 §8/3) |
| **total** | **267** | |

### 3.1 Las 147 que quedaron afuera por decisión

Están repartidas así, y el reparto se verificó: las siete listas particionan el
conjunto, sin repetidas y sin huérfanas.

| Motivo | Cadenas |
| --- | --- |
| Iguales en los dos idiomas, o términos que quedan en inglés (§7) | 51 |
| Identificadores, rutas, comandos, teclas y plantillas de ejemplo | 39 |
| Fragmentos de una oración partida que el español reordena (§8) | 27 |
| Nombres propios | 19 |
| Homografía: dos españoles según el sitio (candidatas a `tEs()`) | 8 |
| Orden de la oración: sólo se arregla con clave punteada (§7.5) | 2 |
| Decisión del dueño, todavía abierta | 1 |
| **total** | **147** |

**Iguales en los dos idiomas, o en inglés por §7 — 51.** `ALIAS`, `Asc`, `Beta`,
`Beta ·`, `Branch`, `Branch:`, `CSV ·`, `Cc:`, `Chat`, `Color`, `Commit`,
`Compatible`, `Desc`, `Diff —`, `Editable`, `Error`, `Error:`, `Experimental`,
`Frontmatter`, `HTTPS`, `Harness / Runtime`, `Hash`, `ID`, `ID:`, `KB`,
`Markdown`, `No`, `OK`, `PLAN`, `Personal`, `Plan`, `Prompt`, `Pull request`,
`Repo:`, `Roles`, `Roles:`, `Runner`, `Skill`, `Skills`, `Slug`, `Tokens`,
`Variables`, `Video`, `Visible`, `Webhook`, `Worktree:`, `Worktrees`,
`Worktrees ·`, `YAML`, `code:`, `frames ·`. Una entrada que no cambia nada es
ruido, suma superficie de sobretraducción y el test «ninguna traducción es
idéntica al inglés» la rebota.

**Identificadores, rutas, comandos, teclas y plantillas — 39.**
`.paperclip/worktrees`, `<timestamp>`, `Arcade-User-ID`, `OPENAI_API_KEY`,
`PAPERCLIP_*`, `Option`, `Shift`, `TOOLS.md`, `bash
./scripts/provision-worktree.sh` y sus dos hermanas, `dev/github`,
`e.g. --verbose, --foo=bar`, `e.g. node, python`, `e.g. script.js, --flag`,
`gemini --acp`, `onboarding/happy-path`, `origin/main`, `references/examples`,
`references/examples.md`, `service/my-connector or scl_…`,
`ssh.railway.com ssh-ed25519 …`, `status, id, updated`,
`~/.openclaw/workspace/paperclip-claimed-api-key.json`,
`{"x-custom-header": "value"}`, `{{issue.identifier}}-{{slug}}`, `{{issueId}}`,
`{{name}}`, `{{outputDocumentKey}}`, `{{runId}}`, `{{skillInvocation}}`,
`{{skillKey}}`, `{{skillName}}`, `{{skillVersion}}`, `{{variable_name}}`,
`You are agent {{ agent.name }}…`, `⌘K`, `⌘K:`, `⌘S`. No son texto de interfaz:
son lo que el usuario copia, escribe o teclea (§7).

**Fragmentos de una oración partida — 27.** `1 item was`, `Diff v`, `Get an`,
`Group these`, `Hold`, `Reuse this saved`, `Set up the`, `The`, `Use "`,
`Use an existing`, `Use your own`, `Variables (`, `access to “`,
`another organization`, `behind latest`, `ctx (`, `is off for`, `it is`,
`live below`, `message is`, `messages are`, `saved API`, `skills installed.`,
`they are`, `waiting for recovery.`, `will be on`, `→ v`. Son trozos de una
oración cortada por un `<code>`, un nombre o un `<kbd>` (glosario §8): el
español necesitaría otro orden, o un artículo cuyo género depende del trozo
siguiente, y el overlay no puede cambiar el orden de los trozos.

**Nombres propios — 19.** `ACP`, `AWS AgentCore`, `Arcade`,
`Browser Use Cloud`, `Claude CLI`, `Claude Managed`, `Codex`, `Codex CLI`,
`Composio`, `Gemini CLI`, `GitHub`, `Grok Build`, `OpenCode`,
`OpenCode 1.18.34`, `OpenRouter`, `Paperclip`, `Paperclip Runner`,
`Windows (File Explorer)`, `macOS (Finder)`.

**Homografía — 8, y es la lista que importa.** `All`, `Comment`, `Installed ·`,
`Open`, `Private`, `Run`, `Showing the first`, `Type`. Cada una necesita **dos
españoles distintos según el sitio**, y el único canal que distingue por sitio
—`tEs(clave, inglés)`— cuesta una edición de un archivo de upstream. Son las
candidatas al presupuesto de `tEs(`, ordenadas por lo que arreglan por línea
tocada:

| Cadena | Sitios | Lo que cuesta y lo que arregla |
| --- | --- | --- |
| `Type` | 11 (10 sustantivo, 1 verbo) | **Un solo sitio que marcar** —el verbo, `RoutineVariablesEditor.tsx:305`— contra diez que se quedan. El más barato de todos (CHA-33) |
| `All` | 13 | «Todas» las tareas vs. «Todos» los agentes. Además es una de las siete pestañas de Búsqueda, que hoy están todas en inglés por otro motivo (abajo) |
| `Open` | 14 | «Abrir» *(acción)* vs. «Abierto» *(estado)* (CHA-27) |
| `Run` | 7 | «Ejecutar» *(acción)* vs. «Ejecución» *(sustantivo)* (CHA-27) |
| `Comment` | 6 | «Comentar» *(acción)* vs. «Comentario» *(sustantivo)* (CHA-27) |
| `Private` | 5 | género según lo que rotula (CHA-31) |
| `Installed ·` | 3 | ídem (CHA-31) |
| `Showing the first` | 3 | «los primeros» *(KB)* vs. «las primeras» *(filas)*: el sustantivo viene en el trozo siguiente (CHA-33) |

A esta lista hay que sumarle `Review`, que **sí entró** como sustantivo
(«Revisión») y que CHA-30 encontró usado como verbo en
`IssueRunLedger.tsx:750`: es un cuarto candidato que ya está traducido, no una
cadena afuera.

**Orden de la oración — 2 (y una tercera que no se cuenta acá).**
`connection?` y `’s email address` (CHA-32) necesitan mover el nombre dentro de
la oración, no elegir entre dos sentidos, así que **no compiten por el
presupuesto de `tEs(`**: se arreglan con la clave punteada de §7.5. La tercera
de la misma familia la encontró CHA-34 y no está entre las 267 porque sus trozos
no están en ningún lote: `This will mark {n} unread {item|items} as read.` de
`Inbox.tsx:2684`, donde el español pone el adjetivo detrás del sustantivo.

**Decisión del dueño — 1.** `Backlog`. El glosario §3 dice «Reserva», pero la
**decisión 9.3** del diccionario está escalada al dueño como pregunta de
glosario, y hay un test que fija que se queda en inglés hasta que conteste
([CHA-15](CHA-15-nombres-de-estado.md), H-1). Son 5 archivos y, si el dueño
contesta «Reserva», una línea de diccionario y una del test.

### 3.2 Las 21 de texto de producción sin sitio declarado

Estas son las que **sí** se pueden recuperar, y cada una cuesta un nombre en
`text-sites.ts` y **cero ediciones de upstream**. Se revisó el sitio de las 21
una por una, y no todas valen lo mismo:

| Por qué nombre entrarían | Cadenas | Dónde |
| --- | --- | --- |
| **`detail` en `TEXT_ATTRS`** | **6** | `RoutineOverview.tsx:167` ×2 y `:185`, `BuiltInBundlePanel.tsx:369` ×2, `IdentitiesSection.tsx:184`. El nombre **ya está en `TEXT_KEYS`** con una excepción por archivo, así que la decisión de producto está tomada para la otra mitad del mismo nombre |
| `summary` en `TEXT_ATTRS` | 1 | `RoutineTriggers.tsx:239` (CHA-33) |
| `composerDisabledReason` | 1 | `IssueDetail.tsx:8225` |
| `triggerLabel` | 1 | `IdentitiesSection.tsx:547` |
| `permissionChangeWarning` | 1 | `AppDetail.tsx:706` |
| atributo `value` | 1 | `TrustPresetSection.tsx:243`. **No entra nunca**: `value` está excluido a propósito (ADR 0002 §7.3), igual que `Not ready` y `Setup required` de §10.3 |
| `aria-keyshortcuts` | 1 | `ComposerAddMenu.tsx:57`. Son teclas, no texto |
| `fileName` | 1 | `companySkills.ts` (`SKILL.md`, que igual no se traduce) |
| ya recuperada por otra clave | 1 | `a Task`, que CHA-33 cerró con el formato `Assign {0} a Task` |
| **recortes de otra cadena o de un comentario** | **7** | `Installed skills`, `Last attempt`, `Scheduled`, `sign-in…`, `ad-hoc paste`, `saved input`, `skill has`. En este árbol **no existen como cadena propia**: son un trozo de una cadena más larga que sí está marcada («Preparing sign-in…», «Last attempt failed:», «Scheduled heartbeat») o texto de un comentario del código. Es el mismo sesgo de medición de §3.3, en su versión fina |

O sea: **un solo nombre, `detail`, recupera 6 de las 21**, y el resto son una
cadena cada uno o no son texto. Las traducciones de las de `detail` no se
perdieron: están escritas en las bitácoras de CHA-30, CHA-31, CHA-32 y CHA-33,
listas para pegar el día que el nombre entre.

Aparte de estas 21 —y por eso no está en la tabla— va el caso de **las etiquetas
derivadas**, que no es una cadena sin traducir sino un diccionario que no se
aplica:

| Lo que falta | Lo que arregla |
| --- | --- |
| `SCOPE_LABELS` y `describeScope` en `TEXT_DECLS` (`Search.tsx:60-77`) | **las siete pestañas de Búsqueda** —All, Tasks, Comments, Documents, Artifacts, Agents, Projects— y el ámbito de «No encontramos nada en all scopes». Es un mapa indexado por valor técnico, el caso de §10.5 del ADR: **seis de las siete etiquetas ya están traducidas** y no se aplican porque el sitio no está declarado. Una línea, cero ediciones de upstream, y es el arreglo con mejor relación pantalla/línea de todo el corte 2 |

### 3.3 Las 36 que no existen en el árbol de entrega

Los lotes se midieron sobre `/paperclip/workspaces/paperclip-es` (branch
`traduccion-es`), que **no es el árbol de la línea de entrega**. 36 de las 3.549
—**el 1,0 %**— fueron reescritas o borradas por upstream entre un árbol y el
otro. Por lote: tareas 11, compartidos 9, skills 9, agentes 4, proyectos 2,
Auditoría 1.

En varios casos la cadena nueva **también estaba en el lote** y entró, así que
no se perdió nada (CHA-33 documenta dos de esos). En otros se recuperó con la
clave que el árbol de entrega sí produce. El resto simplemente no existe más.

Lo que vale para la próxima medición: **medir sobre el árbol de entrega**, o
aceptar y declarar ese 1 %.

### 3.4 Las 58 de Tailwind y las 5 de test

Las 58 son listas de clases que el extractor levanta como texto
(`mx-auto w-full max-w-5xl`, `text-xs text-muted-foreground`…). Es el ~3,2 % de
ruido que el propio extractor declara en su `LEEME.md`, y son inalcanzables por
construcción: el marcado de ADR 0002 no entra a `className`.

Las 5 aparecen sólo en archivos `.test.tsx`, que el plugin no marca a propósito
(ADR 0002 §8/3: los tests son datos). Cuatro son del visor de archivos de
tareas y una del prompt de setup de GitHub.

## 4. Lo que el corte 2 dejó andando, además del diccionario

- **El dato del usuario ya no se traduce.** Es ADR 0002, implementado en CHA-23:
  se traduce «toda cadena escrita en el código fuente de la interfaz, en un
  sitio declarado», así que un agente llamado `Search` sale `Search`. Se
  verifica en cada lote con `datos-del-dueno.es-ar.test.tsx`, y con el
  diccionario en 3.864 entradas las tres pruebas siguen dando **0 traducidas**.
- **Nueve áreas nuevas de diccionario**: `audit` y `traces` (CHA-27), `skills`
  (CHA-31), `routines` (CHA-33) y `search`, `dashboard`, `inbox`, `artifacts` y
  `secrets` (CHA-34). Cada una lleva su `import` en `overlay.ts` y su entrada en
  `ES_AR_AREAS` de `overlay.test.ts`, que es lo que hace que las reglas de
  glosario —que corren por archivo— también las cubran. Abrir un área cuesta esas
  dos líneas y ninguna edición de upstream.
- **El presupuesto de ediciones de upstream está intacto**: 12 archivos y 36
  `tEs()`, los mismos del corte 1. **Los ocho lotes gastaron 0.** Y ADR 0002 §9
  deja 33 de esas 36 líneas recuperables por el canal de declaraciones.

## 5. Lo que queda abierto

1. **`Backlog`**: una palabra, una pregunta al dueño, un test que la sostiene.
2. **El presupuesto de `tEs(`**: 8 candidatas por homografía, ordenadas en §3.1.
   `Type` es la más barata (un sitio) y `All` la que más pantalla arregla.
3. **Los nombres que faltan en `text-sites.ts`**: `SCOPE_LABELS` (7 etiquetas
   en una línea, y seis ya traducidas) y `detail` (6 cadenas medidas, cinco
   lotes seguidos pidiéndolo).
4. **El `testTimeout` de `vitest.config.es-ar.ts`**: sigue en 5.000 ms con el
   diccionario en 3.864 entradas.
5. **Las dos piezas que el corte 2 no cierra**, que son del plan y no del
   diccionario: la validación conjunta de QA (§11 del ADR 0002) y reconstruir el
   paquete, que además pide actualizar `OVERLAY_COMMITS` en
   `/paperclip/ui-es-ar/rebuild.sh` o el script va a reconstruir el corte 1.
6. **El push**: el runner no tiene credencial de GitHub. Todo el corte 2 está
   commiteado y local en `es-ar/corte2`.
