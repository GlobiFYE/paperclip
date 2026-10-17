# CHA-31 — El lote `skills`: 416 cadenas, sobre la línea de entrega

Branch `es-ar/corte2`, worktree `/paperclip/workspaces/es-ar-corte2`. Tres
commits: dos del lote y uno de documentación.

Son tres pantallas: la biblioteca de skills de la empresa (`CompanySkills`),
Skill Studio y los orígenes de skills (`SkillSources`, con el diálogo de
importar desde un proyecto y el árbol del repositorio).

## Los números

| | |
| --- | --- |
| Cadenas del lote | 416 (135 largas + 281 cortas) |
| **Entraron al diccionario** | **369** |
| Ya estaban traducidas | 4 |
| Quedaron afuera por decisión | 25, cada una con motivo (abajo) |
| Quedaron afuera por no tener sitio marcado | 18, cada una con motivo (abajo) |

369 + 4 + 25 + 18 = 416. El archivo nuevo tiene **371** entradas: las 369 del
lote más dos que **recuperan por otra clave** lo que el árbol de entrega sí
escribe (abajo, «Las dos recuperadas»).

### El diccionario, antes y después, por área

| archivo | antes | después | delta |
| --- | --- | --- | --- |
| `agents.json` | 87 | 87 | 0 |
| `audit.json` | 13 | 13 | 0 |
| `common.json` | 571 | 571 | 0 |
| `connections.json` | 419 | 419 | 0 |
| `errors.json` | 185 | 185 | 0 |
| `issues.json` | 689 | 689 | 0 |
| `navigation.json` | 59 | 59 | 0 |
| `onboarding.json` | 4 | 4 | 0 |
| `projects.json` | 2 | 2 | 0 |
| `settings.json` | 327 | 327 | 0 |
| `traces.json` | 89 | 89 | 0 |
| **`skills.json`** *(nuevo)* | — | **371** | **+371** |
| **total** (sin `explicit.json`) | **2.445** | **2.816** | **+371** |

`explicit.json` no se tocó: sigue en 18.

### Un archivo de área nuevo, y por qué

Las 371 entradas son de tres pantallas que no tienen área propia. Meterlas en
`common.json` lo llevaba a 942 entradas y dejaba ilegible el diff del próximo
lote, que es justo lo que el ADR 0001 §7.2 quiere evitar. Así que el lote entra
en **`skills.json`**, y cablearlo cuesta exactamente lo que el propio
`overlay.ts` anuncia: un `import` más en la lista de capas, y una línea más en
el `ES_AR_AREAS` de `overlay.test.ts` para que las nueve invariantes del
diccionario también corran sobre el archivo nuevo. **Cero archivos de
upstream.**

## Cómo se decidió qué entra: medir el árbol antes de escribir

Igual que en [CHA-30](CHA-30-lote-tareas.md): **antes de traducir una sola
cadena se corrió `markText` sobre todo `ui/src` de este worktree** y se cruzaron
las 416 contra el conjunto de cadenas que los sitios marcados producen de
verdad. De las 416, **398 tienen sitio marcado** y 18 no.

Rindió dos veces:

- ninguna de las 371 entradas nuevas quedó sin cubrir. El reporte de sitios
  sigue en **7 entradas sin cubrir, y son las 7 de CHA-30**, no mías;
- las 10 cadenas que el árbol de entrega ya no escribe se detectaron antes de
  traducirlas, no después.

El sesgo de la medición que CHA-30 dejó anotado se confirma en este lote: los
lotes salieron de `/paperclip/workspaces/paperclip-es` (branch `traduccion-es`),
que **no es el árbol de la línea de entrega**. Acá son **10 de 416 (2,4 %)**, y
casi todas del mismo lugar: upstream reescribió la vista previa del paquete y el
diálogo de importar desde GitHub.

## Las 25 que quedaron afuera por decisión

### Dos españoles según el sitio — 3

El ADR 0001 revisión 2 pide resolverlas **por sitio** y ese mecanismo todavía no
existe en esta rama (el marcado de ADR 0002 emite `__tEs(texto)` sin identidad
del sitio). Son las tres del lote que **pedirían `tEs()`**, al lado de `Open`,
`Run`, `Comment` y `Review` de CHA-27/CHA-30:

| Cadena | Sitios | El problema |
| --- | --- | --- |
| `All` | 13 sitios marcados: `ActivityFeed.tsx:116`, `ArtifactsPanel.tsx:41`, `DecisionQueueRail.tsx:44`, `Agents.production.tsx:50`, `Approvals.tsx:99`, `Artifacts.tsx:33`, `Inbox.tsx:2441`, `LegacyInbox.tsx:2308`, `JoinRequestQueue.tsx:113`, `CompanySkills.tsx:334/455/1018/5491` (+ los mismos en `CompanySkills.production.tsx`) | «Todas» en tareas, skills, aprobaciones y decisiones; «Todos» en agentes, artefactos, actividad y pedidos de ingreso. Las dos formas en la misma app |
| `Private` | `ProjectProperties.tsx:501`, `ComposerAddMenu.tsx:132`, `SkillStudio.tsx:665`, `CompanySkills.tsx:1671/1688` (+ producción) | «Privada» concuerda con tarea y con skill; en `ProjectProperties` el sujeto es el proyecto y pide «Privado» |
| `Installed ·` | `CompanySkills.tsx:1870`, `CompanySkills.production.tsx:1853`, `TeamCatalog.tsx:2553` | «Instaladas ·» para skills y «Instalados ·» para equipos |

Dos cosas que sí se pudieron hacer y se hicieron, para que el agujero sea lo más
chico posible:

- **`All (`** —con el paréntesis del conteo— **sí entró**, como «Todas (»: sus
  dos sitios (`CompanySkills.tsx:1372` y `apps/Connections.tsx:347`) son los dos
  femeninos.
- **`Installed · Open in library`** sí entró entera («Instalada · Abrir en la
  biblioteca»): es una cadena distinta y sólo existe en la pantalla de skills.

Queda una costura visible y conviene decirla: en el selector de alcance de Skill
Studio, `Organization` ya era «Empresa» y `Public` entró como «Pública», así que
hasta que `Private` se resuelva por sitio el control se lee
«Empresa / Private / Pública». Preferí la costura antes que escribir «Privado»
sobre una skill o «Privada» sobre un proyecto.

### Iguales en los dos idiomas — 8

`Compatible`, `Roles`, `Roles:`, `Editable`, `Frontmatter`, `YAML`, `Hash`,
`Slug`. Una entrada que no cambia nada es ruido, suma superficie de
sobretraducción y el test «ninguna traducción es idéntica al inglés» la rebota
(glosario §7). Las cuatro últimas son además términos técnicos que en es-AR se
usan en inglés.

### Variables de plantilla — 7

`{{skillName}}`, `{{skillKey}}`, `{{skillInvocation}}`, `{{skillVersion}}`,
`{{runId}}`, `{{issueId}}`, `{{outputDocumentKey}}`. Son los marcadores que el
usuario copia dentro del cuerpo de una plantilla de ejecución
(`SkillStudio.tsx:2895`): identificadores técnicos, §7. Lo que sí entró es la
etiqueta que los presenta, `Placeholders:` → «Variables:».

### Valores de ejemplo — 3

`onboarding/happy-path` (ejemplo de slug con carpeta), `references/examples` y
`references/examples.md` (rutas de ejemplo del contenido inicial). No son texto
de interfaz: son el valor que el usuario va a escribir.

### Oraciones partidas que el español no puede ordenar — 2

| Cadena | Sitio | Por qué |
| --- | --- | --- |
| `behind latest` | `AgentsUsingSkillDialog.tsx:375` | Llega como `{n}` + `" version"` + `""`/`"s"` + `" behind latest"`. El español necesita «{n} versiones atrás de la última», o sea tocar el pivote del plural, que es el trozo `"version"` más la `"s"`. Traducir sólo el final deja «3 version atrás de la última» |
| `skills installed.` | `CompanySkills.tsx:2491` | `No {origen} skills installed.` El español necesita «No hay skills de catálogo instaladas», con el origen **después** del sustantivo; el overlay no puede cambiar el orden de los trozos (glosario §8) |

### No hay nada que traducir — 2

`Diff v` y `→ v` (`SkillStudio.tsx:3519`): `Diff` es término de Git (§7) y la
`v` es la de la versión. Traducir sólo la mayúscula inicial es ruido.

## Las 18 que no tienen sitio marcado

### No existen en el árbol de entrega — 10

Upstream reescribió la vista previa del paquete (`SkillPackagePreview.tsx`), el
árbol del origen (`SkillSourceTree.tsx`) y los encabezados de `SkillSources.tsx`
después de que se midieran los lotes:

| Cadena | Dónde estaba | Qué dice hoy el árbol de entrega |
| --- | --- | --- |
| `Checks cover Markdown links and explicit relative resource paths. They cannot establish every runtime dependency.` | `skills/SkillPackagePreview.tsx:53` de `paperclip-es` | el párrafo no existe |
| `Declared by the skill author. Importing does not install dependencies or run scripts.` | idem `:42` | no existe; queda `Runtime requirements` (sí traducida) |
| `These referenced paths are not included. If the skill needs them, fix the source or leave this skill unchecked.` | idem `:46` | no existe |
| `Preview unavailable for a package that failed validation.` | idem `:72` | `Needs setup: {error}` |
| `Check references` | idem `:45` y `skills/SkillSourceTree.tsx:140` | `Files not included` y el estado `Needs setup` |
| `Choose the skills to keep synced. Unchecked skills stay installed.` | `SkillSources.tsx:162` | sólo la segunda oración (ver «Las dos recuperadas») |
| `Import skills from GitHub and refresh them when you’re ready.` | idem `:46` | otro encabezado |
| `validation errors and will be skipped.` | idem `:210` | la oración no existe |
| `skill has` | idem `:210` | idem |
| `skills have` | idem `:210` | idem |

### Ruido técnico: listas de clases de Tailwind — 3

`hidden font-normal text-muted-foreground sm:inline-flex`,
`font-normal text-destructive`, `size-3 animate-spin`. Es el ~3,2 % de ruido que
el extractor declara en su `LEEME.md`. Además son inalcanzables por
construcción: el marcado de ADR 0002 no entra a `className`.

### Llegan por un nombre que no está en la lista blanca — 3

| Cadena | Prop | Sitio | Qué haría falta |
| --- | --- | --- | --- |
| `Last attempt` | `detail` | `SkillSources.tsx:168`, `` detail={`Last attempt ${timeAgo(...)}`} `` | el nombre `detail` en `TEXT_ATTRS` (Dev/Lead, ADR 0002 §8/fase 2) **y** la clave de formato `Last attempt {0}` |
| `saved input` | `value` | `SkillStudio.tsx:3138`, `<PropRow label="Input" value={…} />` | nada: `value` **no entra a la lista blanca por nada** (es el caso que el ADR existe para no marcar) |
| `ad-hoc paste` | `value` | idem | idem |

`detail` es el mismo nombre que CHA-30 ya puso sobre la mesa con 9 sitios; con
este suman 10. Las traducciones no se pierden: «Último intento {0}»,
«entrada guardada» y «texto pegado».

### Sólo aparece dentro de una plantilla — 1

`Installed skills`: el árbol de entrega la escribe únicamente en
`` aria-label={`Installed skills from ${source.fullName}`} `` (`SkillSources.tsx:152`).
Se recupera por la clave de formato (abajo).

### Bloqueada por la regla de la comparación — 1

`SKILL.md`: `CompanySkills.tsx:257-258` la usa en un `===` para ordenar archivos,
y §7.4 bloquea las cadenas comparadas. Es además un nombre de archivo, así que
no se traduce ni haría falta.

## Las dos recuperadas

Dos entradas de `skills.json` **no son cadenas del lote**: son la forma en que
dos de las excluidas se recuperan igual, con la clave que el árbol de entrega sí
produce. Es el mismo movimiento que las cinco de formato de CHA-30.

| Clave | es-AR | Recupera |
| --- | --- | --- |
| `Unchecked skills stay installed.` | Las skills que no marques quedan instaladas. | `Choose the skills to keep synced. Unchecked skills stay installed.` |
| `Installed skills from {0}` | Skills instaladas de {0} | `Installed skills` |

## Dos huecos que no son de este lote, y conviene anotar

Los dos son trozos de oraciones que sí traduje, y que quedan mezclados porque el
trozo que falta **no está en ningún lote**:

1. **El conector `and`.** `ImportSkillsFromProjectDialog.tsx:997` arma
   «We searched `.claude/skills`, `.agent/skills` and 7 other agent-harness
   folders.» El `" and "` es un trozo de JSX propio y no aparece en ningún lote
   (el extractor no entrega palabras de una letra o dos). Mientras no entre, esa
   oración se lee «. Buscamos en …, … and 7 carpetas más de harness de
   agentes.». Entrada sugerida para quien tome el próximo lote: `and` → «y».
2. **`notice` / `notices`.** `SkillPackagePreview.tsx:54` escribe
   «Content audit · {n} notices». El prefijo entró («Auditoría de contenido ·»)
   y el sustantivo contado queda en inglés. Mismo caso del §8 del glosario: el
   singular y el plural son dos trozos distintos, así que alcanzaría con
   `notice` → «aviso» y `notices` → «avisos», pero no son de este lote.

## Términos nuevos

Los 25 que salieron de este lote están en el glosario
([glosario-es-AR.md](glosario-es-AR.md), sección «Agregadas en CHA-31»). Los
cuatro que vale la pena nombrar acá:

- **`Fork` → «Copiar» / «Copia».** La propia app ya usa las dos palabras para lo
  mismo: el botón dice `Fork` para una skill propia y `Make a copy` para una de
  GitHub. En castellano «forkear» es jerga y «bifurcar» no se usa, así que el
  verbo es «copiar», el badge `Forked` es «Copia» y `Forked from` es «Copiada
  de». `Make a copy` queda «Hacer una copia», que es la misma acción dicha más
  largo, igual que en inglés.
- **`Bundled` → «De fábrica».** Es una forma **sin género**, y hacía falta:
  la misma cadena rotula skills (femenino), plugins y equipos (masculino).
  Mismo criterio del glosario §3 que resolvió `Running` → «En curso».
- **Trust level `Safe` → «Sin riesgo»**, por lo mismo: la fila de confianza
  describe la skill, y «Segura» obligaba a elegir género en una etiqueta que
  mañana puede rotular un plugin.
- **`Placeholders:` → «Variables:».** «Marcadores de posición» no entra en la
  etiqueta y nadie lo dice; lo que el usuario ve abajo son `{{skillName}}` y
  compañía, que son variables.

## Verificación

Corrida sobre el árbol entregado, con las dos configs a propósito:

```sh
cd /paperclip/workspaces/es-ar-corte2/ui
npx vitest run src/i18n-es-ar src/i18n/locale-validation.test.ts  # 106 pasan, 19 skipped
npx vitest run --config vitest.config.es-ar.ts                    # 20 pasan
npx tsc --noEmit -p tsconfig.json                                 # 0 errores
node src/i18n-es-ar/tools/report-text-sites.ts                    # 2.816 entradas, 7 sin cubrir
```

Los 19 skipped de la config de upstream son los que necesitan el plugin y se
saltean a propósito; los 20 de la config es-AR son esos dos archivos corriendo
de verdad. **Con una sola config el verde miente por omisión**, así que las dos
se corrieron en cada tanda.

El reporte de sitios, además de las 7 sin cubrir de CHA-30, confirma dos cosas
sobre las entradas nuevas: ninguna cae en la lista de «cadenas que la regla de
la comparación bloqueó» (las 5 del diccionario que sí caen —`File`, `Inbox`,
`Paused`, `Revoke`, `Tasks`— son de lotes anteriores) y ninguna aparece en la
lista de «entradas que parecen técnicas».

### Una corrida en rojo que no era un defecto

La primera corrida de `vitest.config.es-ar.ts` dio **1 test en rojo** en
`datos-del-dueno.es-ar.test.tsx` (el que renderiza cada entrada de una sola
palabra como nombre de agente). Repetida tal cual pasó, y repetida con
`--no-file-parallelism --testTimeout=20000` también: 20/20 las dos veces. Es la
fragilidad que [CHA-28](CHA-28-validacion-corte2.md) ya midió, no un defecto de
estas entradas —y es un dato con sentido, porque este lote agrega **37 entradas
de una sola palabra** (las que ese test mide, `/^[A-Za-z][A-Za-z0-9-]*$/` con
traducción distinta del inglés) y por lo tanto 37 casos nuevos a ese mismo test,
que pasa—.

### Cero archivos de upstream

| commit | archivos |
| --- | --- |
| `95196c42f` | `dictionary/es-AR/skills.json`, `overlay.ts`, `overlay.test.ts` |
| `d43df828c` | `dictionary/es-AR/skills.json` |
| este commit | `glosario-es-AR.md`, esta bitácora |

Nada fuera de `ui/src/i18n-es-ar/` y `doc/i18n-es-ar/`. Los dos archivos de
máquina que se tocaron (`overlay.ts`, `overlay.test.ts`) son del overlay es-AR,
no de upstream. `pnpm-lock.yaml` intacto. Presupuesto de ediciones de upstream:
**12 archivos y 36 `tEs(`, sin cambio. Gastado: 0.**

### Sobre el worktree compartido

Se corrió `git status` antes de arrancar y antes de cada commit; el árbol estaba
limpio cada vez. Nunca se usó `git add -A` ni `git commit -a`: los tres commits
agregan archivos por ruta. Los commits se hicieron en tandas (250 / 121 / docs)
para que un corte de ventana no se llevara el trabajo.

**No se pusheó**: el runner sigue sin credencial de GitHub. Los tres commits
quedan locales en `es-ar/corte2`.
