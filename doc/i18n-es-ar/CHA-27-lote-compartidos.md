# CHA-27 — El lote `compartidos` completo, sobre la línea de entrega

Dos tramos, dos commits. El tramo A trae a `es-ar/corte2` las 494 cadenas largas
que CHA-25 había dejado en la rama equivocada; el tramo B traduce las 987 cortas.

## Tramo A — portar las 494 largas de CHA-25

### Por qué un porte y no un `cherry-pick`

CHA-25 commiteó en `traduccion-es` (`deff36b50`), que sale de `22a3ea341`;
`es-ar/corte2` sale de `2cc799236`, que es el commit que corre la instancia del
dueño. Los dos árboles escribieron los mismos archivos de diccionario
(`settings.json`, `common.json`, `errors.json`): CHA-21 en esta rama, CHA-25 en
la otra. Un `cherry-pick` conflictúa en los tres y resuelve por hunk, que para un
JSON de pares es resolver por posición de línea. Así que se portó el
**contenido**: las entradas que `deff36b50` agrega sobre su propio padre
(`3a32cb640`), comparadas clave por clave contra lo que ya había acá.

### Qué hubo que reconciliar: nada, y eso se verificó

- **Claves con dos traducciones distintas: 0.** De las 494, nueve ya existían en
  `settings.json` por CHA-21 —CHA-25 las había copiado palabra por palabra justo
  para esto— y las nueve coinciden carácter por carácter. Se dejó la que ya
  estaba; no hay diferencia que elegir, así que el glosario no tuvo que desempatar
  nada.
- **La misma clave en dos archivos distintos: 0.** Es el riesgo que el
  `cherry-pick` no habría avisado y que los tests
  "una cadena vive en un solo archivo" y "ningún par de archivos … traducciones
  distintas" sí cubren. Se comprobó antes de escribir: ninguna de las 494 cae en
  un archivo distinto del que ya la tenía en esta rama.

Resultado: **+485 claves nuevas** y 9 que ya estaban iguales, o sea las 494
entradas de CHA-25 presentes en esta rama.

| archivo | antes | después |
| --- | --- | --- |
| `agents.json` | 0 | 45 |
| `audit.json` | — (nuevo) | 10 |
| `common.json` | 128 | 160 |
| `connections.json` | 48 | 257 |
| `errors.json` | 115 | 142 |
| `issues.json` | 0 | 107 |
| `onboarding.json` | 0 | 4 |
| `settings.json` | 280 | 300 |
| `traces.json` | — (nuevo) | 31 |

Las ediciones son **sólo agregados**: las entradas nuevas van al final de cada
archivo y lo que ya estaba no se movió ni se reordenó, para que el diff se pueda
leer. Lo único que cambia de una línea vieja es la coma al final de la última
entrada.

`audit.json` y `traces.json` son archivos de área nuevos: llevan su `import` en
`overlay.ts` (ADR 0001 §7.2) y entran en `ES_AR_AREAS` de `overlay.test.ts`, que
es lo que hace que las reglas de glosario —que corren por archivo— también los
cubran. Sin esa segunda mitad el archivo traduce pero nadie lo valida.

### Las 8 que siguen afuera

CHA-25 omitió 8 de las 502 del lote y siguen omitidas, por el mismo motivo que
están anotadas en [CHA-25](CHA-25-lote-1-compartidos.md): siete son listas de
clases de Tailwind que el extractor levanta como texto, y la octava es el
placeholder de una plantilla de prompt, o sea contenido para el modelo, no
interfaz.

### Lo que cambió desde CHA-25 y acá no se usó

ADR 0002 reemplazó el overlay de tiempo de render por marcado en compilación, así
que ya no hay nada nuestro en el camino de render de React. Para el tramo A no
cambia nada: las claves son las mismas cadenas inglesas exactas y la búsqueda es
la misma. Lo que habilita es el tramo B.

## Tramo B — las 987 cortas compartidas

De las 987 de `compartidos--cortas.json`, **46 ya estaban traducidas** (del
corte 1, de CHA-21 o del tramo A de esta misma tarea), así que se decidieron
**941**: 859 entran al diccionario y 82 quedan afuera, cada una con su motivo.

Entraron, por archivo de área:

| archivo | entradas nuevas |
| --- | --- |
| `common.json` | 382 |
| `connections.json` | 165 |
| `issues.json` | 157 |
| `traces.json` | 56 |
| `agents.json` | 45 |
| `settings.json` | 31 |
| `errors.json` | 12 |
| `navigation.json` | 7 |
| `audit.json` | 3 |
| `projects.json` | 1 |

Se commiteó en cuatro lotes (250 / 250 / 250 / 109) para que un corte de ventana
no se llevara el trabajo.

### Lo que quedó afuera, y por qué

**Homografía: 3.** Son las que necesitan **dos españoles distintos según el
sitio**. El ADR 0001 revisión 2 (§12–§21) pide resolverlas **por sitio**, en un
mapa nuestro, y ese mecanismo **todavía no existe en esta rama**: el marcado de
ADR 0002 emite `__tEs("Open")` sin ninguna identidad del sitio, así que la
búsqueda no puede distinguir. El único canal que distingue, `tEs(clave, inglés)`,
necesita editar el `.tsx` de upstream, y el presupuesto de ediciones es cero. Así
que se listan y no se fuerzan:

| Cadena | Los dos españoles | Sitios mirados |
| --- | --- | --- |
| `Open` | «Abrir» *(acción)* vs. «Abierto» *(estado)* | `PipelineHealthWarnings.tsx:27` lo usa como etiqueta de link (`hrefLabel ?? "Open"`); `BudgetIncidentCard.tsx:25` lo devuelve como estado de un incidente; `TaskSidePanel.tsx:615` titula la sección de ítems abiertos |
| `Run` | «Ejecutar» *(acción)* vs. «Ejecución» *(sustantivo)* | `WorkspaceRuntimeControls.tsx:376` es el botón (`action === "run" ? "Run"`); `AuditFeed.tsx:51` es la etiqueta del filtro `heartbeat_run`; `IssueRunLedger.tsx:867` es encabezado de columna |
| `Comment` | «Comentar» *(acción)* vs. «Comentario» *(sustantivo)* | `CommentThread.tsx:1096` y `DocumentAnnotationPanel.tsx:309` son el botón de enviar (`submitting ? "Posting..." : "Comment"`); `MatchSourceChip.tsx:19` es el chip de tipo de resultado |

No se dejó afuera ninguna por **concordancia de género**, y no porque no haya
riesgo: se resolvió con las dos reglas que quedaron en el glosario —`X by` se
traduce como verbo en pasado («Approved by» → «Aprobó») y las etiquetas de estado
van en masculino o, mejor, en una forma sin género («Running» → «En curso»,
«Disconnected» → «Sin conexión», «Parked» → «En reserva»)—. Las que tenían varios
sitios con géneros distintos se miraron una por una en el código antes de
decidir, no de memoria.

**Fragmentos de oración: 19.** `The`, `it is`, `they are`, `Get an`, `Set up
the`, `Use an existing`, `Use your own`, `Group these`, `Reuse this saved`,
`saved API`, `is off for`, `will be on`, `live below`, `Checking local`, `access
to “`, `1 item was`, `another organization`, `Use "`, `Hold`. Son trozos de una
oración partida por un `<code>`, un nombre o un `<kbd>` (glosario §8). El español
necesitaría otro orden o un artículo cuyo género depende del trozo siguiente, y
el overlay no puede cambiar el orden de los trozos. Los fragmentos que **sí**
entraron son los que se sostienen solos: `the task` → «la tarea», `for this
agent.` → «para este agente.», `on behalf of` → «en nombre de».

**Ruido técnico: 16 + 14 de Tailwind.** Listas de clases (`h-4 w-4`,
`mx-auto max-w-2xl`…), variables de entorno (`OPENAI_API_KEY`), rutas, comandos
(`gemini --acp`), teclas (`Shift`, `Option` —que es la tecla de macOS, no la
palabra—) y plantillas de ejemplo (`e.g. node, python`). Es el ~3,2 % de ruido
que el propio extractor declara en su `LEEME.md`.

**Nombres propios: 16.** `Paperclip`, `Codex`, `Claude CLI`, `Gemini CLI`,
`Grok Build`, `OpenCode`, `AWS AgentCore`, `macOS (Finder)`,
`Windows (File Explorer)`…

**Iguales en los dos idiomas: 14.** `Color`, `Plan`, `Visible`, `Experimental`,
`No`, `OK`, `Skill`, `Skills`, `Runner`, `ALIAS`, `ID:`, `Repo:`, `Cc:`,
`frames ·`. Una entrada que no cambia nada es ruido y encima el test
«ninguna traducción es idéntica al inglés» la rebota (glosario §7).

### Velocidad real medida

| Tramo | Entradas | Minutos | Entradas/min |
| --- | --- | --- | --- |
| A — portar las 494 largas | 494 (485 claves nuevas) | ~4 | ~124 |
| B — las 987 cortas | 941 decididas (859 traducidas + 82 excluidas) | ~13 | ~72 |

El tramo A es rápido porque es mecánico: el contenido ya estaba traducido y
revisado en CHA-25, el trabajo fue comparar clave por clave y escribir. El tramo
B es traducción de verdad, y el costo no estuvo en escribir el español sino en
**decidir**: para una cadena de una o dos palabras hay que ir a mirar el sitio en
el código antes de elegir, porque «Open», «Running» o «Allowed» no se resuelven
leyendo la cadena. Se miraron ~60 sitios a mano.

## Verificación

Corrida en este worktree, sobre el árbol entregado:

```sh
cd /paperclip/workspaces/es-ar-corte2/ui
npx vitest run src/i18n-es-ar src/i18n/locale-validation.test.ts  # 104 pasan, 13 skipped
npx vitest run --config vitest.config.es-ar.ts                    # 12 pasan
npx tsc --noEmit                                                  # 777 errores: la línea base, sin cambio
```

**Las dos configs, a propósito**: con la de upstream, `real-components.es-ar.test.tsx`
se saltea, así que una sola config miente por omisión. Los 777 de `tsc` se
midieron antes y después del tramo A y de los cuatro lotes del tramo B: son los
mismos, y ninguno está en `ui/src/i18n-es-ar/`.

**Cero archivos de upstream tocados.** `git diff --name-only b631ed711..HEAD`
no sale de `ui/src/i18n-es-ar/` y `doc/i18n-es-ar/`; `pnpm-lock.yaml` intacto.

### Las entradas están en el bundle compilado, no sólo en los tests

Esto cuesta explicarlo porque **el build del fork no corre en este worktree**, y
no por nuestra culpa: `node_modules` está enlazado al worktree viejo
(`paperclip-es`), cuyos `packages/shared` y `packages/adapters` no tienen los
exports que esta rama usa —`HEARTBEAT_RUN_LIST_DEFAULT_LIMIT`,
`aiProviderSetupPreset`, `resolveCodexLocalCliPolicy`…—, y además le falta
`@spekoai/client`. Es la misma causa de los 777 errores de `tsc`. Ninguno de los
37 errores del build menciona `i18n-es-ar`, y el paquete que falta es de upstream.

Para medirlo igual se compiló con una config de verificación **fuera del
árbol entregado** (creada, usada y borrada; no se commitea): la del fork más
alias de los paquetes del workspace a los de **este** worktree. Con eso el build
transformó 7.877 módulos y emitió 267 chunks antes de cortarse en
`@spekoai/client`. En los chunks emitidos:

- Las **1.968 entradas** del diccionario es-AR —todas, no una muestra— están en
  el chunk `assets/overlay-*.js`. Se verificó comparando el valor de cada entrada
  de los once archivos de área contra el JS compilado: **0 ausentes**.
- La clave inglesa marcada aparece en el chunk de los componentes
  (`"Allowed agents"` en `assets/index-*.js`), o sea que el marcado de ADR 0002
  corrió sobre el código de upstream y el texto llega al overlay.
- La bandera `OVERLAY_IN_BUNDLE` quedó encendida: en el chunk del overlay no hay
  ni un literal `!1`, y la fuente tiene exactamente un `false` —el de la marca
  que el plugin reescribe—.

Lo que esta medición **no** prueba es que la app entera arranque: para eso hace
falta un `pnpm install` en este worktree, que es decisión del dueño porque toca
el lockfile.
