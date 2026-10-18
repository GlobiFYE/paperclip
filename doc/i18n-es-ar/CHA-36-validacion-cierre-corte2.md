# CHA-36 — Validación de cierre del corte 2, con pasada visual de desbordes

**Veredicto: el corte 2 cierra.** Los trece gates —los que protegen el dato del
dueño y los archivos de upstream— dan todos lo que tenían que dar, y la pasada
visual que CHA-28 me quedó debiendo **se hizo**: doce pantallas, dos anchos, dos
idiomas, mismo bundle y mismos datos.

De la pasada visual salen **dos defectos** que conviene arreglar antes de
mostrárselo al dueño, los dos de una línea y ninguno toca upstream:

- **D-3** · «Desactivado» sale **cortado** en la lista de Rutinas: la caja mide
  48 px y el texto 75 px, sin puntos suspensivos. En inglés dice `Off` y entra.
  Es el único desborde de toda la pasada atribuible a la traducción.
- **D-4** · El encabezado de la pantalla Skills se lee **«Installed skills»** en
  es-AR. La traducción de la otra mitad del mismo ternario («Descubrir skills»)
  ya está en el diccionario. Y `cierre-corte2.md` §3.2 lo clasifica mal: dice
  que `Installed skills` «no existe como cadena propia en este árbol» y sí
  existe, en `CompanySkills.tsx:1138`.

Y queda una **cola medida, no un defecto**: 41 cadenas distintas que se ven en
inglés en las doce pantallas del alcance y que §3 de `cierre-corte2.md` **no
nombra**. Están listadas una por una en §6.3, con pantalla y causa; cuatro de
ellas ya están traducidas en el diccionario y no se aplican, y tres de esas
cuatro fallan por la misma posición sin declarar.

Aparte van dos que ya estaban y siguen: **D-1** (el botón «New Task» de la
pantalla Tareas, §6.3) y **D-5** (el chip «Private» de tarea privada, §6.4). D-5
**no se arregla declarando el local**: por ahí pasa el `identifier` del dueño.

---

## 1. Qué árbol se midió

| Qué | Valor |
| --- | --- |
| Worktree | `/paperclip/workspaces/es-ar-corte2` |
| Branch | `es-ar/corte2` |
| HEAD | `e4dae68e3` — *ux-ui: detail y SCOPE_LABELS en la lista blanca (CHA-39)* |
| Árbol | limpio (`git status --porcelain` → vacío) antes de empezar |
| Lotes adentro | los doce del alcance, más CHA-35 (build), CHA-37 (ADR 0003), **CHA-38** (mapa por sitio) y **CHA-39** (las dos declaraciones) |

Las dos tareas que me bloqueaban cerraron: CHA-38 en `4d39a854a` y CHA-39 en
`e4dae68e3`. **Se midió una sola vez, con todo puesto**, como pidió el Lead.

Los dos bundles se reconstruyeron en HEAD antes de medir: el del fork
(`vite.config.es-ar.ts`, verde en 15,45 s) y el de upstream
(`pnpm --filter "@paperclipai/ui..." build`). Los artefactos que había en disco
eran de las 00:11 y CHA-39 entró a las 00:15: medir sobre eso habría medido el
árbol anterior.

---

## 2. Los gates, con la invocación de cada uno

Todos corridos sobre `e4dae68e3`, con `unset NODE_PATH` antes de cada comando de
node.

| # | Gate | Invocación | Resultado | Umbral |
| --- | --- | --- | --- | --- |
| 1 | Tipos | `pnpm --filter @paperclipai/ui typecheck` | **0 errores** (salida 0) | 0 ✅ |
| 2 | Suite con la config de upstream | `pnpm exec vitest run src/i18n-es-ar` | **174 pasan / 19 salteados**, 5 archivos + 1 salteado, 15,44 s | sin regresiones ✅ |
| 3 | Suite con la config es-AR | `pnpm exec vitest run --config vitest.config.es-ar.ts` | **20 pasan / 20**, 16,49 s | sin regresiones ✅ |
| 4 | Posiciones no literales | el test `todo ui/src marcado` de `datos-del-dueno.es-ar.test.tsx`, que corre en **las dos** configs | **3**: `KanbanBoard.tsx`, `StatusIcon.tsx`, `CompanyEnvironments.tsx` | exactamente 3 ✅ |
| 5 | Llamadas `tEs()` del corte 1 | `grep -rn 'tEs(' ui/src --include=*.tsx --include=*.ts \| grep -v 'i18n-es-ar/' \| grep -vE '__tEs' \| wc -l` | **36** | 36 ✅ |
| 6 | Upstream tocado por CHA-38 + CHA-39 | `git diff --name-only 46f07a032 e4dae68e3 \| grep -v 'i18n-es-ar\|^doc/' \| wc -l` | **0** | 0 ✅ |
| 7 | `pnpm-lock.yaml` y los `package.json` | `git diff --stat 2cc799236 -- pnpm-lock.yaml ui/package.json package.json` | **sin una línea** | intacto ✅ |
| 8 | Shim de `jsx-runtime` | `git ls-files \| grep -i jsx-runtime` | **ausente** | ausente ✅ |
| 9 | `derived.json` (ADR §14.3, obsoleto) | `ls ui/src/i18n-es-ar/dictionary/es-AR/derived.json` | **no existe** | no existe ✅ |
| 10 | Marcas en el build de upstream | `grep -ro '__tEs(' dist/assets \| wc -l` y `grep -rl installEsArOverlay dist \| wc -l` | **0** y **0** | 0 ✅ |
| 11 | Entradas del diccionario ausentes del bundle es-AR | los 3.807 valores distintos del diccionario buscados en `dist-es-ar/**/*.{js,css,html}` | **0 ausentes** | 0 ✅ |
| 12 | Cobertura del diccionario | `node --experimental-strip-types src/i18n-es-ar/tools/report-text-sites.ts` | **3.873 entradas · 3.869 cubiertas · 4 sin cubrir** | bajó de 7 ✅ |
| 13 | Escrituras en la pasada visual | el arnés contesta 405 a todo lo que no es GET y las anota | **ninguna** | 0 ✅ |

**Una precisión sobre el gate 6**, para que nadie lo lea como regresión: la
**rama** tiene 12 archivos de upstream tocados
(`git diff --name-only 2cc799236 -- ui/src | grep -v i18n-es-ar | wc -l` → 12).
Son los `tEs()` de CHA-15 y CHA-23 que el Lead confirmó que no se tocan. El cero
es el del diff de CHA-38 + CHA-39, que es donde estaba el riesgo.

**Las 4 entradas sin cubrir** (gate 12) son las mismas cuatro que midió el Lead:
`Choose agents`, `Loading permissions…`, `Choose a saved API key or enter a new one`
y `This authorization request expired`. Ninguna declaración se rompió.

### 2.1 El mapa por sitio de CHA-38, medido

`ui/src/i18n-es-ar/dictionary/por-sitio/es-AR.json`: **51 archivos, 58 entradas,
8 cadenas inglesas distintas** — coincide con lo que contó el Lead.

| Cadena inglesa | Archivos | Españoles |
| --- | ---: | --- |
| `Open` | 14 | Abiertas · Abierto · Abrir |
| `All` | 11 | Todas · Todos |
| `Type` | 9 | Escribí · Tipo |
| `Run` | 6 | Ejecución · Ejecutar · Ejecutá |
| `Comment` | 6 | Comentar · Comentario |
| `Private` | 5 | Privada · **Privado** |
| `Review` | 4 | Revisar · Revisá |
| `Installed ·` | 3 | Instaladas · · Instalados · |

Y el control negativo del Lead: `Review` sigue teniendo **«Revisión»** en
`navigation.json` para la barra lateral, o sea que un archivo **sin** entrada en
el mapa sigue resolviendo por el diccionario global. El mecanismo no se comió el
global.

---

## 3. La pasada visual: el método, que es lo que le da valor al número

Es el de CHA-9 y no cambió: **la misma pantalla, del mismo bundle, con los
mismos datos, dos veces** — una en es-AR y otra con `?lang=en`. `?lang=en` es la
precedencia más alta de `resolveUiLocale()`, así que apaga el overlay sin
cambiar una línea de código ni un byte de datos. **Lo único que cambia entre las
dos cargas es el largo del texto.**

Entonces: lo que recorta o desborda en es-AR y **no** en inglés lo rompimos
nosotros. Lo que desborda en las dos ya venía de upstream y no se reporta.

Para cada elemento visible con texto se midió `scrollWidth` contra
`clientWidth`, el `text-overflow: ellipsis` efectivo, y si la caja se escapa de
la del padre cuando el padre no recorta ni scrollea. Sólo se cuentan las
**hojas**: si un ancestro aparece por culpa de un hijo que desborda, el hallazgo
útil es el del hijo.

**Cobertura: 12 pantallas × 2 anchos (1440 y 1024 px) × 2 idiomas = 48 cargas**,
más 16 cargas de las costuras y del control contra el build de upstream. El
barrido salió a medir 14 y descartó 2 —la ficha de rutina (`/routines/rt-1`) y
la ficha de agente (`/agents/ag-qa`)— porque un panel de esas dos pantallas cae
en su límite de error con el arnés; están anotadas en
`shots/hallazgos.json` → `rotas`, y lo que sí renderizan entró igual al barrido
de inglés de §6.3.

Todo de **sólo lectura**: el arnés contesta 405 a cualquier método que no sea
GET y los anota; **hubo cero escrituras** (`escrituras: []`).

Receta del navegador (las tres variables son obligatorias):

```
export PLAYWRIGHT_BROWSERS_PATH=/paperclip/workspaces/.playwright-browsers
export LD_LIBRARY_PATH=/paperclip/.local/pw-deps/root/usr/lib:/paperclip/.local/pw-deps/root/usr/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=/paperclip/workspaces/.qa-fontconfig/fonts.conf
node /paperclip/workspaces/.qa-cha36/barrido.mjs http://127.0.0.1:5473
```

El arnés y las capturas viven en `/paperclip/workspaces/.qa-cha36/`, fuera del
worktree: `rutas.mjs`, `mock-extra.mjs`, `barrido.mjs`, `costuras.mjs`,
`ingles.mjs`, `sonda.mjs` y `shots/` (56 PNG + `hallazgos.json` + `ingles.json`).

### 3.1 El resultado del barrido

**32 candidatos crudos, y se van a 1 cuando se aplica el recorte del método:**

| Clase | Candidatos | Por qué no cuenta |
| --- | ---: | --- |
| El enlace «Saltar al contenido principal» (`sr-only`) | 24 | Es el salto de accesibilidad: sólo se ve con foco, y la diferencia es el ancho del rectángulo de recorte, no texto visible |
| Mismo texto en los dos idiomas | 6 | Son títulos de tarea y nombres que puso la fixture: dato del dueño, que **tiene** que salir igual. La diferencia de 4 px es ruido de layout |
| **Texto distinto y recorte sólo en es-AR** | **2** (el mismo caso en los dos anchos) | **D-3** |

---

## 4. Las tres costuras que el Lead pidió mirar con los ojos

### 4.1 Skill Studio · el selector de alcance: **pasa**

Capturado del DOM, misma pantalla y mismos datos, los dos idiomas
(`/CHA/skills/studio/new`):

| Idioma | Lo que se lee |
| --- | --- |
| es-AR | «Cómo se comparte · Elegí quién puede descubrir esta skill dentro de Paperclip. · **Empresa** / **Privada** / **Pública**» |
| inglés | «Sharing · Choose who can discover this skill inside Paperclip. · Organization / Private / Public» |

Ya no se lee «Empresa / **Private** / Pública»: la costura que el dueño podía
ver **se cerró**. Captura: `shots/costura-studio-nuevo-es.png`.

### 4.2 `ProjectProperties` tiene que decir «Privado»: **pasa**, medido por el mecanismo

La ficha de proyecto **no se puede abrir con el arnés** (ver §7), así que esta la
medí donde se decide, no en la pantalla. Marcando el archivo con el plugin y
resolviendo contra el mapa:

| Archivo | Marca que emite el plugin | Lo que resuelve el mapa |
| --- | --- | --- |
| `components/ProjectProperties.tsx` | `__tEs("Private", "components/ProjectProperties.tsx")` | **«Privado»** (masculino, concuerda con proyecto) |
| `pages/SkillStudio.tsx` | `__tEs("Private", "pages/SkillStudio.tsx")` | «Privada» |
| `pages/CompanySkills.tsx` | `__tEs("Private", "pages/CompanySkills.tsx")` | «Privada» |

O sea: **el mismo inglés con dos españoles distintos según el archivo**, y la
marca lleva el sitio. Es el caso que el Lead puso como prueba del mecanismo.
Además `por-sitio.test.ts` lo cubre con 75 casos, verdes en el gate 2.

### 4.3 Búsqueda · las siete pestañas y la frase de vacío

Las siete pestañas, leídas de la pantalla:

| Pestaña | es-AR | inglés |
| --- | --- | --- |
| 1 | **All** | All |
| 2 | Tareas | Tasks |
| 3 | Comentarios | Comments |
| 4 | Documentos | Documents |
| 5 | Artefactos | Artifacts |
| 6 | Agentes | Agents |
| 7 | Proyectos | Projects |

**Seis de siete en castellano.** `Comments` → «Comentarios» entró con CHA-39, y
`All` queda en inglés: es una de las 8 homografías y `pages/Search.tsx` no tiene
entrada en el mapa. CHA-39 lo dejó escrito como decisión («recuperarla es una
línea cuando se decida el género»), así que **no lo cuento como defecto**; lo
anoto como decisión abierta en §8.

La frase de vacío, misma pantalla, los dos idiomas:

| Idioma | Lo que se lee |
| --- | --- |
| es-AR | «No hay resultados para “zzzz”. **No encontramos nada en all scopes.** Probá ampliar el alcance o reformular la consulta.» |
| inglés | «No results for “zzzz”. We couldn’t find a match in all scopes. Try widening the scope or rephrasing your query.» |

Los dos fragmentos de alrededor están traducidos y el del medio no, así que la
costura **se ve**. Es la decisión que CHA-39 documentó: declarar `describeScope`
envuelve `return SCOPE_LABELS[scope]` entero y eso sería una **cuarta posición
no literal**, que el gate 4 rebota. Queda como decisión del Lead, no como
defecto. Si algún día entra, la clave es `"All scopes"` **en mayúscula** —el
literal de `Search.tsx:75`—, nunca `"all scopes"`: el `.toLowerCase()` de la
línea 865 corre **después** de la traducción.

---

## 5. La invariante del dato del dueño, sobre el diccionario completo

Es la que sostiene la promesa: **lo que el dueño escribe no se traduce.**

| Qué | Hoy | En CHA-28 |
| --- | --- | --- |
| Entradas del diccionario | **3.873** | 1.986 |
| Entradas de una sola palabra (el peor caso) | **586** | 286 |
| Sitios marcados | **19.589** | 18.374 |
| Posiciones no literales | **3** | 3 |

El denominador casi se duplicó y la invariante no se movió. El test
`datos-del-dueno.es-ar.test.tsx` pasa las 586 entradas de una palabra por
nombre de agente, título de tarea, nombre de proyecto y nombre de archivo:
**cero se dan vuelta**.

Y se ve en pantalla: los títulos `CHA-1: Paperclip onboarding`,
`CHA-2: Traducir la interfaz…` y los nombres de los cinco agentes salen
idénticos en las 56 cargas, en los dos idiomas.

Las **3** posiciones no literales siguen siendo las mismas tres y las tres
derivan de un valor técnico del API, no de texto libre. **CHA-39 no agregó una
cuarta**, y es lo que más me importaba de su diff: declaró `SCOPE_LABELS` y
dejó `describeScope` afuera a propósito.

---

## 6. Hallazgos

### 6.1 D-3 · «Desactivado» sale cortado en la lista de Rutinas

**El único desborde de toda la pasada que es nuestro.**

| | es-AR | inglés |
| --- | --- | --- |
| Texto | «Desactivado» | `Off` |
| Caja | 48 px | 48 px |
| Contenido | **75 px** | 48 px |
| Recorte | **27 px, sin puntos suspensivos** | 0 |

Sitio: `ui/src/components/RoutineList.tsx:188-190`.

```tsx
<span className="w-12 text-xs text-muted-foreground">
  {isArchived ? "Archived" : isDraft ? "Draft" : enabled ? "On" : "Off"}
</span>
```

`w-12` son 48 px fijos. `Off` → «Desactivado» sale de `common.json`, y la
palabra se corta a la mitad. **Y el mismo span tiene dos cadenas más que van a
cortarse igual** cuando les toque datos: `Archived` → «En archivo»
(`inbox.json`) y `Draft`, que hoy no está en el diccionario.

Lo que **no** se puede hacer: ensanchar el span, porque `RoutineList.tsx` es de
upstream y el criterio del dueño es no tocarlo.

Lo que sí, y es una línea: una entrada en el mapa por sitio con una forma que
entre en 48 px a 12 px de tipografía —unos 7 u 8 caracteres—, por ejemplo
`components/RoutineList.tsx: {"Off": "No"}`. Ojo que **sacar `Off` del global no
sirve**: lo deja en inglés acá y lo pierde en el resto de la app. Es una decisión
de glosario con un número al lado, así que la dejo planteada y no la decido yo.

Capturas: `shots/1440_routines-es.png` y `shots/1440_routines-en.png`.

### 6.2 D-4 · «Installed skills» se lee en inglés en la pantalla Skills

El encabezado de la pantalla Skills sale **«Installed skills»** en es-AR, con el
subtítulo «Skills available to this organization.» también en inglés. Es el
primer renglón de la pantalla: se ve antes que cualquier otra cosa.

Causa, medida: `ui/src/pages/CompanySkills.tsx:1138`

```ts
const viewTitle = installedView ? "Installed skills" : "Discover skills";
```

Es una **declaración local**, de la misma clase que las que CHA-39 declaró. El
plugin **no emite ninguna marca** para esas dos cadenas (medido: marcando el
archivo, cero `__tEs("Installed skills"…)`). Y la otra mitad del ternario ya
está traducida: `skills.json` tiene `Discover skills` → «Descubrir skills».

**Y acá hay un error de documentación que conviene corregir**:
`cierre-corte2.md` §3.2 clasifica `Installed skills` entre los «recortes de otra
cadena o de un comentario», con el texto «en este árbol **no existen como cadena
propia**». Existe, es una cadena propia, y está en una declaración. Es el segundo
error de §3 que encuentro, después del «seis de las siete» de §3.2 que reporté
en el hueco de ayer (son cinco).

El arreglo cuesta un nombre en `TEXT_DECLS`
(`src/pages/CompanySkills.tsx` → `viewTitle`, y lo mismo en
`CompanySkills.production.tsx`) más una entrada de diccionario. Cero ediciones
de upstream. Ojo: `viewTitle` es un ternario entre **dos literales**, así que
**no** suma una posición no literal.

### 6.3 La cola: 41 cadenas en inglés en las doce pantallas del alcance

Medido así: mismo bundle, mismos datos, dos cargas; un texto hoja que sale
**idéntico** en las dos es inglés que no tradujimos — descontando los datos que
puso la fixture, los números, las familias de interpolación («21h ago»,
«3 skills», «Enabled for 2 agents») y todo lo que §3 de `cierre-corte2.md`
nombra entre backticks.

Las cadenas van **como están en el código**, no como se ven: varios
encabezados llevan `text-transform: uppercase`, así que en pantalla se leen
`INBOX` o `AUTHOR` pero la cadena sin traducir es `Inbox` y `Author`. Lo
verifiqué comparando `textContent` contra `innerText` y el
`text-transform` efectivo de cada nodo, porque la diferencia cambia a quién le
toca: **el uppercase no es el problema** —las secciones vecinas se leen
«TRABAJO» y «EMPRESA», o sea traducidas y después pasadas a mayúscula—, el
problema es la cadena.

| Pantalla | Cadenas en inglés **no declaradas** |
| --- | --- |
| Panel | `No recent agent runs.`, `Succeeded` |
| Tareas | **`New Task`** (D-1), `Yesterday` |
| Bandeja | **`Inbox`**, `Yesterday` |
| Skills | `Discover`, `Sources`, `Author`, `Skills you create, edit, and test.`, **`Skills available to this organization.`**, `Most agents`, `Not enabled for any agents`, `by Local`, `Local` |
| Skill Studio | `Studio`, `Discover`, `Sources`, `Author`, `Skills you create, edit, and test.`, `Select skill` |
| Agentes | `Claude Code`, `idle`, `working` |
| Agentes · ficha | `agent`, `Overview`, **`Secrets & variables`**, `Tools`, `Governance`, `Permissions / Trust`, `API Keys`, `Loading audit links…` |
| Rutinas | **`paused`**, `Never`, `On` |
| Rutinas · ficha | `Overview`, `Delivery` |
| Proyectos | `My Projects`, `active`, `Leave` |
| Búsqueda | `Relevance` |
| Artefactos | `Images`, `Videos`, `No artifact stacks yet.` |
| **todas (14/14)** | **`Command Palette`, `Search for a command to run...`** |

**Cuatro de ellas ya están traducidas en el diccionario y no se aplican**, que
es la clase más barata de arreglar porque no hace falta decidir nada:

| Cadena | Dónde está la traducción | Por qué no llega |
| --- | --- | --- |
| `New Task` | `navigation.json` → «Nueva tarea» | **D-1**, sigue vivo: `LegacyIssuesList.tsx:1642-1643` la arma por interpolación (`` `New ${createIssueLabel}` ``) y ningún sitio está marcado. La barra lateral sí dice «Nueva tarea»; el botón de la pantalla dice `New Task` |
| `Inbox` | `navigation.json` → «Bandeja» | `Inbox.tsx:825`, **valor por defecto de un parámetro** (`surfaceLabel = "Inbox"`), que se usa como miga de pan. La barra lateral dice «Bandeja» y el encabezado de la misma pantalla dice `INBOX` |
| `Secrets & variables` | `agents.json` | `AgentContextualSidebar.tsx:54`, **valor por defecto de un parámetro** (`labels = { secrets: "Secrets & variables" }`), y `AgentDetail.tsx:1398` como expresión dentro de JSX |
| `paused` | `common.json` → «en pausa» | el estado se imprime crudo en la lista de Rutinas |

**Y hay un patrón atrás de tres de estos cuatro, que vale más que los casos
sueltos: el valor por defecto de un parámetro.** Las dos cadenas que aparecen en
**las catorce pantallas** son exactamente eso,
`ui/src/components/ui/command.tsx:34-35`:

```ts
title = "Command Palette",
description = "Search for a command to run...",
```

Van al título y la descripción del diálogo de la paleta de comandos, que es
texto para lectores de pantalla y se ve cuando se abre con `⌘K`.

Lo que tienen en común `command.tsx:34`, `Inbox.tsx:825` y
`AgentContextualSidebar.tsx:54` es la **posición**: un literal de cadena como
default en la desestructuración de props. Hoy la lista blanca no la cubre.
Y es una posición **barata y segura**: lo que se envolvería es un literal
estático, así que **no suma una posición no literal** y el gate de las 3 no se
mueve. Un solo nombre de posición arregla las catorce pantallas más la miga de
pan de Bandeja: es el mejor cociente pantalla/línea que queda en el corte, igual
que lo era `SCOPE_LABELS` antes de CHA-39.

**Lo que esto significa, y no más que eso:** §3 de `cierre-corte2.md` clasifica
267 cadenas una por una, pero el denominador salió de medir los lotes sobre el
worktree del corte 1 — el sesgo que §3.3 declara. Las 41 de arriba son lo que el
dueño ve en inglés en las doce pantallas y que esa clasificación no nombra. No
las reporto como defecto del corte: las reporto como **cola medida**, con
pantalla y causa, para que el glosario v3 (CHA-41) y el Traductor tengan la
lista en vez de volver a buscarla.

Dos clases aparte dentro de esas 41, por si ayuda a repartirlas:

- **Encabezados de sección y agrupadores de fecha** (`Inbox`, `Author`,
  `Governance`, `Yesterday`): van en mayúscula por CSS, no por la cadena. Las
  secciones vecinas de la misma barra se leen «TRABAJO» y «EMPRESA», así que el
  `uppercase` no estorba: lo que falta es la entrada o el sitio.
- **Estados de agente en minúscula** (`idle`, `working`, `active`): el canal de
  declaraciones los resuelve por el diccionario global y `common.json` tiene
  `paused` y `running` pero no estos tres.

### 6.4 D-5 · «Private» queda en inglés en el chip de tarea privada

`ui/src/components/LockedIssueChip.tsx:35`:

```ts
const label = identifier ?? (unavailable ? "Unavailable" : "Private");
```

Medido: el plugin **no emite ninguna marca** para `"Private"` en ese archivo,
así que no lo alcanza ni el mapa por sitio ni el diccionario global. El chip se
lee «Private».

**No es un agujero de CHA-38 ni de CHA-39**, y quiero que quede escrito por qué:
ese `label` recibe el `identifier` del dueño («CHA-1»). Declarar el local
`label` haría que el canal de declaraciones marque una posición que recibe dato
del dueño: **cuarta posición no literal**, y el gate 4 la rebota. CHA-39 hizo
bien en dejarlo afuera. Si alguna vez se recupera, lo que hay que declarar son
**los dos literales**, nunca el local.

---

## 7. Los límites de esta medición, declarados

**Tres pantallas del alcance no se pudieron medir** porque se caen con el arnés
de QA. Lo importante: **se caen igual en inglés sobre el build de upstream**, con
el mismo mock, los mismos datos y el mismo mensaje, así que es un hueco de la
fixture y no de la traducción.

| Pantalla | Error, idéntico en los dos builds |
| --- | --- |
| Conectores (`/apps`) | `Cannot read properties of undefined (reading 'length')` |
| Auditoría (`/activity`) | `Cannot read properties of undefined (reading 'id')` |
| Proyecto · configuración (`/projects/:ref/configuration`) | `Cannot read properties of undefined (reading 'find')` |

La verificación: las mismas tres rutas contra `dist` (upstream, inglés) dan
«This page hit an error / Paperclip hit an error» con el mismo mensaje. La
captura de ese control está en `shots/`.

**Lo que sí arreglé del arnés**, que era la deuda D-2 que arrastraba desde
CHA-28: la pantalla de **Skills** —donde vive la costura de «Privada»— se caía
por falta de rutas en el mock, y ahora abre. Las fixtures nuevas están en
`/paperclip/workspaces/.qa-cha36/mock-extra.mjs` y están armadas **contra el
tipo** de `packages/shared`, no a ojo, porque un campo de menos no deja la
pantalla a medias: tira la app entera. Lo medí de las dos formas:

| Ruta | Forma que hacía falta | Qué se cae sin ella |
| --- | --- | --- |
| `/folders` | `FolderListResult` (`{ kind, folders, allCount, unfiledCount }`) | Skills, en `.map` |
| `/routines` | `RoutineListItem` = `Routine` + `triggers` + `lastRun` + `activeIssue` | **todas** las pantallas, porque falla en la barra lateral |
| `/search` | `CompanySearchResponse` completo, con `zeroResults: null` | Búsqueda, en `.length` |
| `/skills`, `/skills/installed`, `/skill-sources` | `CompanySkillListItem[]` | la lista de skills |
| `/tools/*` | `{ applications }`, `{ connections }`, `{ apps, capabilities, credentialSources }` | Conectores (no alcanzó) |
| `/projects/:ref`, `/project-repositories` | `Project` con `visibility`, `ProjectRepositoryOptions` con los dos contadores | la ficha de proyecto (no alcanzó) |

Dos detalles del arnés que le sirven a quien lo retome:

- **`zeroResults` tiene que ir en `null`.** Con un objeto, `Search.tsx:857`
  devuelve la pantalla de recuperación y **no** la frase de vacío, que es
  justo la que había que mirar.
- **`live-runs`, `activity`, `approvals` y `user-directory` no se tocan**: el
  default `[]` del mock de CHA-9 las deja funcionando, y darlas como objeto tira
  la app entera en todas las pantallas.

---

## 8. Lo que **no** se reporta, por decisión ya tomada

- **`All` solo, en la pestaña de Búsqueda.** Homografía; `pages/Search.tsx` no
  tiene entrada en el mapa y el sitio ya está declarado. CHA-39 lo dejó escrito:
  es una línea cuando se decida el género. Decisión abierta, no defecto.
- **«No encontramos nada en *all scopes*».** Declarar `describeScope` sería una
  cuarta posición no literal y el gate 4 la rebota. Decisión del Lead.
- **Las dos colisiones dentro de un mismo archivo**: `Type` en
  `RoutineVariablesEditor.tsx` (119 sustantivo, 304 verbo) y `Run` en
  `SkillStudio.tsx` (2527 verbo, 3100/3107/3122 sustantivo). El mapa se indexa
  por `archivo + inglés` y no las puede separar; dejarlas afuera es la salida
  correcta. Verificado: el plugin emite `__tEs("Type")` **sin sitio** en ese
  archivo, o sea que cae al global, que no tiene la clave → inglés.
- **La familia de orden de palabras**: `Showing the first`, `connection?`,
  `’s email address`, `All {group.name} tools` y
  `Open {entry.name} app settings`. De esta última confirmo lo que verificó el
  Lead: la entrada `app settings` **existe** en `common.json` desde CHA-27 y
  tiene sitio marcado; el defecto es el orden («Abrir Box configuración de la
  app»), no la falta de entrada.
- **`Paperclip couldn’t start`** en `ui/index.html`: decisión del dueño, vive en
  un archivo de upstream.
- **`Backlog`**: decisión 9.3, escalada al dueño, con un test que la fija en
  inglés hasta que conteste.
- **H-1, el diccionario en el build de upstream.** Sigue ahí y lo medí: viaja
  dentro del chunk `dist/assets/BreadcrumbContext-*.js`, que hoy pesa **400 KB**
  (eran 268 KB en CHA-28: creció con el diccionario). Es **peso muerto, no
  fuga**: en todo `dist` hay **cero** referencias a `installEsArOverlay` o a
  `i18n-es-ar`, así que no hay camino que lo aplique. Es de ADR 0003 y está en
  CHA-40.

---

## 9. Para otros roles

- **Dev UX/UI** · **D-4**: `viewTitle` en `CompanySkills.tsx:1138` y en
  `CompanySkills.production.tsx:1138` → `TEXT_DECLS`. Es un ternario entre dos
  literales, así que no suma posición no literal. Y una posición nueva que vale
  la pena mirar como clase, no como caso: **el valor por defecto de un
  parámetro** (`components/ui/command.tsx:34-35`, `pages/Inbox.tsx:825`,
  `components/AgentContextualSidebar.tsx:54`). Son literales estáticos, así que
  tampoco mueven el gate de las 3, y arreglan las catorce pantallas más la miga
  de pan de Bandeja.
- **Traductor i18n** · **D-1** sigue vivo y ahora está visto en pantalla:
  `LegacyIssuesList.tsx:1642-1643` arma «New Task» por interpolación. Más la
  entrada que falta para `Installed skills` («Descubrir skills» ya está) y las
  41 de §6.3, que están con pantalla y causa.
- **Lead / glosario (CHA-41)** · **D-3**: hay que elegir una forma de `Off` que
  entre en 48 px, o aceptar que se corta. Es una decisión de glosario con un
  número al lado y no la tomo yo.
- **Arquitecto / autor de `cierre-corte2.md`** · dos correcciones de §3.2:
  `Installed skills` **sí** existe como cadena propia
  (`CompanySkills.tsx:1138`), y «seis de las siete etiquetas ya están
  traducidas» son **cinco** (`All` y `Comments` estaban las dos ausentes antes
  de CHA-39).
- **Quien retome el arnés** · las tres pantallas de §7 necesitan tres fixtures
  más para poder medirse. Ninguna es de la traducción: se caen igual en inglés.
