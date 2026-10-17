# CHA-38 — El mapa por sitio, y las 8 cadenas con dos españoles

Bitácora de Dev UX/UI. Implementa **ADR 0001 revisión 2 §14.2** y lo aplica a
las cadenas que cinco lotes del corte 2 dejaron afuera porque necesitaban dos
traducciones distintas según el archivo. Porta además la revisión 2 del ADR a
la rama de entrega, que es donde faltaba.

**Cero archivos de upstream tocados.** Es el criterio del dueño desde el primer
día y sigue en pie: `git status` antes del commit da sólo archivos nuestros.

## Lo que hay ahora

| Archivo | Qué es |
| --- | --- |
| `ui/src/i18n-es-ar/dictionary/por-sitio/es-AR.json` | el mapa: **51 archivos, 58 entradas, 8 cadenas** |
| `ui/src/i18n-es-ar/por-sitio.ts` | carga, valida y busca en el mapa |
| `ui/src/i18n-es-ar/overlay.ts` | `lookupPorSitio()`, y `translate(valor, archivo?)` |
| `ui/src/i18n-es-ar/mark-text.ts` | le pasa el sitio a `__tEs` donde el mapa tiene algo que decir |
| `ui/src/i18n-es-ar/por-sitio.test.ts` | 75 casos |

Vive en `dictionary/por-sitio/` y no en `dictionary/es-AR/` **a propósito**: el
reporte de cobertura (`tools/report-text-sites.ts`) lee todos los `.json` de
`dictionary/es-AR/` como diccionarios de área, y ahí adentro el mapa habría
hecho que el reporte tomara rutas de archivo como cadenas inglesas.

### Cinco cosas que el diseño no decía y hubo que fijar

Están en el ADR, en el recuadro de §14.2. En corto:

1. **La ruta es relativa a `ui/src/`**, como los ejemplos del ADR. Una clave que
   empiece con `src/` no pegaría nunca, así que el cargador la rechaza con un
   error en vez de ignorarla en silencio.
2. **El sitio se le pasa a `__tEs` sólo donde hay entrada.** En los demás ~8.000
   sitios la llamada sale con un argumento, idéntica a la de antes. Por eso el
   test de la garantía del dueño (CHA-28) sigue contando **exactamente 3**
   posiciones no literales: no se movió.
3. **Los espacios del borde se recortan y se vuelven a pegar**, igual que §7.1.
   Sin esto `Installed ·` era inescribible: el nodo de texto de
   `Installed · {n}` es `"Installed · "`, con el espacio adentro.
4. **Un archivo, un español por cadena.** Ver «los dos que quedaron afuera».
5. **No llega al canal de declaraciones**, y eso es la razón de ser del mapa.
   Ver «por qué estas 7 no van al diccionario global».

### La forma larga con `forzar: true` no está implementada

Habilitar posiciones que la lista blanca no cubre toca `text-sites.ts` y es una
decisión aparte; ninguna de las 8 cadenas la necesitó. El cargador **falla
fuerte** si encuentra un `forzar`, para que no quede escrito y sin efecto.

## Las 8 cadenas, sitio por sitio

Las formas **no se inventaron acá**: salen de las bitácoras que dejaron cada
cadena pendiente. Lo que sí se hizo acá es **asignar la forma a cada archivo**,
que es el trabajo que el mecanismo habilita, y para eso se leyeron los **91
sitios** —en 57 archivos— uno por uno.

Los sitios se relevaron corriendo el marcado sobre todo `ui/src` y leyendo las
llamadas `__tEs(...)` de la salida, que conserva los números de línea. No se
relevaron por `grep`: ésa es la razón de las correcciones de más abajo.

### `All` — 11 archivos (CHA-31)

«Todas» donde el sustantivo tácito es femenino, «Todos» donde es masculino.

| Español | Archivos |
| --- | --- |
| **Todas** | `pages/Approvals.tsx`, `components/DecisionQueueRail.tsx`, `pages/Inbox.tsx`, `pages/LegacyInbox.tsx`, `pages/CompanySkills.tsx`, `pages/CompanySkills.production.tsx` |
| **Todos** | `components/ActivityFeed.tsx`, `components/ArtifactsPanel.tsx`, `pages/Artifacts.tsx`, `pages/Agents.production.tsx`, `pages/JoinRequestQueue.tsx` |

Los 5 sitios de `CompanySkills.tsx` (filtro de tipo, barra de categorías, filtro
de fuente ×2, pestañas) son todos sobre **skills**, así que «Todas» sirve en los
cinco y el archivo no se parte.

### `Private` — 5 archivos (CHA-31)

| Español | Archivos |
| --- | --- |
| **Privada** | `pages/SkillStudio.tsx`, `pages/CompanySkills.tsx`, `pages/CompanySkills.production.tsx`, `components/task-chat/ComposerAddMenu.tsx` |
| **Privado** | `components/ProjectProperties.tsx` *(el sujeto es el proyecto)* |

**Cierra la costura que veía el dueño.** El selector de alcance de Skill Studio
se leía «Empresa / Private / Pública» porque `Private` no se podía traducir sin
escribir «Privada» sobre un proyecto. Ahora se lee entero.

### `Installed ·` — 3 archivos (CHA-31)

| Español | Archivos |
| --- | --- |
| **Instaladas ·** | `pages/CompanySkills.tsx`, `pages/CompanySkills.production.tsx` |
| **Instalados ·** | `pages/TeamCatalog.tsx` *(equipos)* |

### `Open` — 14 archivos (CHA-27)

«Abrir» cuando es la acción, «Abierto/a» cuando es el estado. El reparto quedó
**13 sitios a 2** para el verbo (`IssueRow.tsx` tiene dos).

| Español | Archivos |
| --- | --- |
| **Abrir** | `components/AttentionQueueRow.tsx`, `components/IssueRow.tsx`, `components/IssueThreadInteractionCard.tsx`, `components/PipelineHealthWarnings.tsx`, `components/chat/ExternallyConnectedTaskBanner.tsx`, `components/issue-output/OutputPrimaryCard.tsx`, `components/task-chat/TaskChatCompactInteractionCard.tsx`, `components/task-side-panel/TaskSidePanel.tsx`, `features/connections/ConnectionSetupFlow.tsx`, `pages/Pipelines.tsx`, `pages/apps/chat/ChatEndpointSetup.tsx`, `pages/skills/ImportSkillsFromProjectDialog.tsx` |
| **Abierto** | `components/task-chat/RichWorkProductCard.tsx` *(estado de un pull request)* |
| **Abiertas** | `pages/UserProfile.tsx` *(cuenta de tareas abiertas, al lado de `assignedOpenIssues`)* |

### `Run` — 6 archivos (CHA-27)

«Ejecutar» cuando es el botón, «Ejecutá» cuando es una instrucción en una
oración, «Ejecución» cuando es el sustantivo.

| Español | Archivos |
| --- | --- |
| **Ejecutar** | `pages/apps/app-detail/ActionTestDialog.tsx` |
| **Ejecutá** | `components/agent-config-primitives.tsx` *(`Run <code>cd …</code>.`, ×2)* |
| **Ejecución** | `components/IssueRunLedger.tsx`, `pages/AgentDetail.production.tsx`, `pages/audit/AuditFeed.tsx`, `pages/ResponsibleUserDenialUxLab.tsx` |

### `Comment` — 6 archivos (CHA-27)

| Español | Archivos |
| --- | --- |
| **Comentar** | `components/CommentThread.tsx`, `components/DocumentAnnotationPanel.tsx`, `components/DocumentAnnotationPopover.tsx`, `components/DocumentAnnotationLayer.tsx`, `pages/DesignGuide.tsx` |
| **Comentario** | `components/search/SearchResultRow.tsx` *(tipo de resultado)* |

### `Review` — 4 archivos (CHA-30)

Es la única de las 8 que **ya tenía** entrada global: `navigation.json` dice
«Revisión», y está bien para 13 de los 17 archivos. El mapa sólo da vuelta los
cuatro que no son sustantivo.

| Español | Archivos |
| --- | --- |
| **Revisá** | `components/IssueRunLedger.tsx` *(el caso que pedía CHA-30)*, `pages/apps/app-detail/SetupPanel.tsx` |
| **Revisar** | `pages/PluginManager.tsx`, `pages/tools/profiles/ProfileDetail.tsx` *(botones)* |

`IssueRunLedger.tsx:749` era el caso que CHA-30 dejó anotado: el resto de la
oración («para ver el contexto de la recuperación.») ya estaba traducido
esperando esto, así que ahora se lee entera.

**`Revisar` es la única forma que no viene de una bitácora** y vale decirlo: es
la infinitiva de acción, exactamente el patrón que CHA-27 ya decidió para
`Open`→«Abrir», `Run`→«Ejecutar» y `Comment`→«Comentar». No es una palabra
nueva, es ese patrón aplicado a `Review`. Los dos sitios son botones y hoy se
leen «Revisión», que está mal. **Si el Traductor o el Lead prefieren otra forma,
son dos entradas del mapa y nada más.**

### `Type` — 9 archivos (CHA-33)

«Tipo» cuando es el sustantivo, «Escribí» cuando es el verbo.

| Español | Archivos |
| --- | --- |
| **Tipo** | `components/DecisionsToolbar.tsx`, `pages/CaseDetail.tsx`, `pages/Cases.tsx`, `pages/CompanySkills.tsx`, `pages/CompanySkills.production.tsx`, `pages/apps/Connections.tsx`, `pages/apps/app-detail/AdvancedPanel.tsx` |
| **Escribí** | `components/DecisionCard.tsx`, `pages/PipelineSettings.tsx` *(`Type {token} to confirm`)* |

## Lo que quedó afuera, y por qué

### Los dos homógrafos que el mapa no puede expresar

La clave es `archivo + inglés`, **no la línea** —es lo que la hace sobrevivir a
que upstream edite el archivo arriba—. Cuando los dos sentidos conviven en el
**mismo** archivo, el mapa no los puede separar. Pasó dos veces:

| Archivo | Cadena | Los dos sentidos |
| --- | --- | --- |
| `components/RoutineVariablesEditor.tsx` | `Type` | **119** sustantivo (`<Label>Type</Label>`) y **304** verbo (`Type {{variable_name}} anywhere in the title…`) |
| `pages/SkillStudio.tsx` | `Run` | **2527** verbo (botón `<Play/> Run`) y **3100/3107/3122** sustantivo (`<PaneScaffold title="Run">`) |

**Los dos quedan en inglés, a propósito.** Es la decisión importante de la
tarea, y los dos casos fallan distinto, así que conviene separarlos:

- **`Type` en `RoutineVariablesEditor.tsx` es el caso grave.** Cualquier entrada
  le pega también a la 304, y ahí el error no cae al inglés: cae a una **oración
  mal escrita** («Tipo `{{variable_name}}` en cualquier parte del título…»). Eso
  choca de frente con el «se degrada, no rompe» de §14.2, que es lo que hace
  confiable al mecanismo. 2 sitios en inglés es el precio, y es el barato.
- **`Run` en `SkillStudio.tsx` es más leve, y aun así va afuera.** Acá ninguna
  opción arma una oración mal escrita: las dos **mal etiquetan**. Por mayoría
  habría ido «Ejecución» (3 títulos de pane contra 1 botón), pero eso deja el
  **botón de ejecutar** —la acción principal de Skill Studio— diciendo
  «Ejecución», que es un defecto de interfaz bien visible. «Ejecutar» al revés
  deja los tres títulos mal. Entre mislabelear la acción principal y dejar 4
  sitios en inglés, elijo el inglés; es la opción que no empeora nada y que el
  discriminante por clase de sitio recupera entera y limpia.
- `SkillStudio.tsx` **sí** recibe su entrada de `Private`: la exclusión es por
  cadena, no por archivo, y la costura visible al dueño se cierra igual.

**Lo que haría falta para recuperarlos**, si el Lead lo quiere, es un
discriminante *dentro* del archivo. El que menos me disgusta no es la línea
—se mueve con cada edición de upstream— sino la **clase de sitio**, que el
marcado ya calcula: en `SkillStudio.tsx` el verbo es `jsx-text` y los tres
sustantivos son `jsx-attr`, así que los separa limpio y sobrevive a que upstream
edite el archivo. **No alcanza para `RoutineVariablesEditor.tsx`**, donde los
dos sitios son `jsx-text`; ahí haría falta además distinguir «este nodo de texto
es todo el contenido de su elemento» de «es un fragmento con hermanos». Es una
ampliación de la clave de §14.2 y una decisión de arquitectura, no algo para
meter en esta tarea: el encargo decía preferir cero cambios de transform a un
transform apurado.

### Orden de palabras: no es homografía y el mapa no lo arregla

- **`All` en `pages/tools/profiles/WizardToolsStep.tsx:205`** — es
  `All {group.name} tools (…)`, un fragmento de oración. «Todas» ahí deja
  «Todas Slack tools (3)». **Sin entrada**, queda en inglés. Este sitio **no
  estaba en la lista de CHA-31**; apareció al relevar con el marcado.
- **`Showing the first` (CHA-33), `connection?` y `’s email address` (CHA-32)** —
  quedan afuera por decisión del Lead y están bien afuera: el adjetivo va antes
  del número y el sustantivo llega en el trozo siguiente, que difiere entre
  sitios («los primeros 3 filas» / «las primeras 64 KB»). El mapa por sitio
  cambia la traducción de un trozo, no el orden de los trozos. **Limitación
  conocida y declarada**, igual que se le dijo a QA.

### Dos sitios que quedan a medio traducir, y está bien

`Open` es verbo y va primero, así que el orden no se rompe, pero el resto de la
oración vive en otro nodo de texto que todavía no está en el diccionario:

- `features/connections/ConnectionSetupFlow.tsx:4030` → «Abrir {nombre} app settings»
- `pages/apps/chat/ChatEndpointSetup.tsx:1966` → «Abrir {proveedor}» (éste queda entero)

Es castellano correcto con una cola en inglés, no una oración mal armada. Lo
cierra el Traductor agregando `app settings` al diccionario; no necesita
mecanismo.

## Por qué estas 7 **no** van al diccionario global

Vale dejarlo escrito porque es contraintuitivo: para `Open` el reparto es 13
sitios a 2, así que lo barato parecería ser una entrada global «Abrir» más dos
excepciones por sitio. **No se puede**, y el motivo es el canal de
declaraciones.

`TEXT_DECLS` envuelve el `return` entero de una función, así que lo que llega a
buscarse no es un literal del archivo y el marcado **no tiene dónde colgarle el
sitio**. Una de las tres funciones envueltas es `statusLabel` de
`components/StatusIcon.tsx`:

```ts
function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
```

`statusLabel("open")` devuelve `"Open"`. Con una entrada global, el glifo de
estado pasaría a decir **«Abrir»** donde tiene que decir «Abierta». El mapa por
sitio no lo podría arreglar, porque esa llamada no lleva sitio.

Así que las 7 cadenas nuevas viven **sólo** en el mapa por sitio, y hay un test
que lo fija: `lookup()` de cada una tiene que devolver el inglés. `Review` es la
excepción y ya tenía su entrada global antes de esta tarea.

## Los tests

`ui/src/i18n-es-ar/por-sitio.test.ts`, **75 casos**, seis grupos:

1. **Una por cadena (8):** el mismo inglés, dos archivos, dos españoles
   distintos, y la aserción de que son distintos.
2. **El control negativo:** `components/AppsSidebar.tsx` **tiene** un sitio de
   `Review` y **no** tiene entrada, así que lo resuelve el diccionario global —
   exactamente como antes de esta tarea. Más: las 8 cadenas en un archivo sin
   entrada resuelven idéntico a `lookup()`.
3. **La garantía del dueño:** ninguna de las 7 tiene entrada global.
4. **Las 51 entradas contra el árbol de verdad:** para cada archivo del mapa se
   corre el marcado y se verifica que la llamada de dos argumentos aparece de
   verdad. **Es el test que importa a futuro:** si upstream renombra el archivo
   o borra el literal, esto se pone rojo en vez de degradarse en silencio.
5. **Que el resto no cambió:** un archivo fuera del mapa se marca sin segundo
   argumento, y un archivo del mapa se lo pasa **sólo** a sus entradas.
6. **La prioridad y el memo:** el sitio le gana al global, y resolver un sitio
   **no** le cambia la respuesta a los demás archivos. `lookup` memoiza por
   valor y sin dimensión de archivo, así que si el resultado de un sitio cayera
   en ese memo, el primer archivo en renderizarse le fijaría la traducción a
   todos los demás —un bug que aparecería según el orden de render—. Está
   evitado por construcción (sólo el *miss* se delega a `lookup`) y fijado acá.

Corre con la config de upstream: `lookupPorSitio` es puro y no mira el
interruptor, igual que `lookup`.

**No hay caso de componente real renderizado** para el mapa, y es deliberado.
Los dos componentes que servirían (`PipelineHealthWarnings`, `SearchResultRow`)
dependen del `Link` de `@/lib/router`, que usa `useActiveCompanyPrefix()` y
necesita contexto de router; montarlo en `real-components.es-ar.test.tsx` habría
agregado un test frágil —y QA ya anotó en CHA-28 que esa suite miente en rojo
bajo carga— sin probar nada que los grupos 4 y 5 no prueben ya: lo que se
verifica ahí es el código marcado que el navegador evalúa.

## Gates

| Gate | Resultado |
| --- | --- |
| `pnpm run typecheck` | **0 errores** |
| `vitest` (config de upstream), `src/i18n-es-ar` | 172 pasan, 19 salteados, 0 fallan |
| `vitest --config vitest.config.es-ar.ts` | 20 pasan, 0 fallan |
| posiciones no literales (CHA-28) | **3**, sin moverse |
| `vite build` (upstream) | ✓, y **0** marcas `__tEs(` en `ui/dist` |
| `vite build --config vite.config.es-ar.ts` | ✓ `ui/dist-es-ar` |
| archivos de upstream tocados | **0** |

En `ui/dist-es-ar` se verificó que viajan las formas nuevas y las claves del
mapa: «Instaladas ·», «Instalados ·», «Privada», «Privado», «Revisá»,
«Comentario», «Abiertas», «Escribí», «Ejecución».

## Correcciones a lo que estaba anotado

Relevar con el marcado en vez de con `grep` movió varias cosas. Queda acá para
que nadie vuelva a buscarlas:

- **`Installed ·` parecía no existir.** Buscando la clave exacta da **0 sitios**:
  el nodo de texto es `"Installed · "`, con el espacio final. La resuelve la
  regla de recorte de §7.1, y por eso el mapa tuvo que respetarla también.
- **`pages/PipelineSettings.tsx:3388` NO es un falso positivo**, al revés de lo
  que anoté en el triage. Su clave cruda es `"Type "`, pero el recorte de §7.1
  la alcanza con `"Type"`, así que es un sitio de verdad y recibe «Escribí».
- **`Review` no tiene sitio en `pages/apps/Connections.tsx`**, que también anoté
  en el triage. Los cuatro sitios no sustantivos son `IssueRunLedger.tsx`,
  `SetupPanel.tsx`, `PluginManager.tsx` y `ProfileDetail.tsx`.
- **`Type` no era el caso más barato de los acumulados, era el más caro:** es uno
  de los dos que el mapa no puede expresar.
- **`Run` también colisiona dentro de un archivo** (`SkillStudio.tsx`). En el
  triage dije que `Type` era el único; eran dos, y el segundo recién aparece
  cuando se relevan los sitios con línea.
- **`components/task-side-panel/TaskSidePanel.tsx:615` es el verbo, no el
  sustantivo.** CHA-27 lo leyó como «titula la sección de ítems abiertos», pero
  los ítems de `primary` son paneles que se **pueden** abrir (Propiedades,
  Artefactos, Archivos), cada uno con su bandera `alreadyOpen`: es el
  encabezado de un lanzador. Va «Abrir».
- **Seis sitios de `Type` y uno de `All` no estaban en las listas previas**:
  `CompanySkills.production.tsx`, `AdvancedPanel.tsx`, `CaseDetail.tsx`,
  `Cases.tsx` (×2), `DecisionCard.tsx`, y `WizardToolsStep.tsx` para `All`.
- **`BudgetIncidentCard.tsx:25`**, que CHA-27 listó como sitio de estado de
  `Open`, **no produce un sitio marcado**: la posición no está en la lista
  blanca. No se puede traducir por este mecanismo y no está en el mapa.

## El mapa suma 58 entradas al peso muerto de H-1, y eso ya está decidido

Verificando los builds confirmé que el de **upstream** embarca el diccionario
es-AR completo en el chunk `BreadcrumbContext-*.js` (se ve con «Por hacer»,
«Bloqueada», «Invitar gente»). **No es un hallazgo nuevo ni lo introdujo esta
tarea:** es **H-1 de CHA-28**, y **ADR 0003** (aceptado, CHA-37) ya decidió el
arreglo —partir `overlay.ts` en `active-locale.ts`, `explicit.ts` y
`overlay.ts`, para que el build de upstream no tenga ninguna arista hacia el
diccionario—. El gate que el encargo nombra se cumple igual: **0** marcas
`__tEs(` en `ui/dist`.

Lo que sí corresponde anotar es **dónde cae el mapa por sitio cuando se haga
CHA-37**: del lado del **diccionario**, con `overlay.ts`.

- `overlay.ts` → `por-sitio.ts` → `dictionary/por-sitio/es-AR.json` es la única
  arista desde la app, así que el corte de módulo de ADR 0003 §6 lo deja afuera
  del build de upstream **sin nada extra**.
- `explicit.ts` **no** tiene que importar `por-sitio.ts`: el chequeo que ADR
  0003 §6.5 planea en `bundle-boundary.test.ts` («`explicit.ts` no importa
  ningún `dictionary/*/` que no sea `explicit.json`») sigue valiendo tal como
  está escrito, y el mapa queda del lado correcto.
- `mark-text.ts` también importa `por-sitio.ts`, pero es build-time y nunca
  entra al grafo de la app, así que no agrega aristas.

Mientras tanto son 58 entradas más de peso muerto en el build en inglés —chico
al lado de las 3.882 del diccionario, y se va con el mismo arreglo—.

## Para otros roles

- **Traductor:** el **glosario** (`glosario-es-AR.md`) no se tocó —no es archivo
  mío—. Hay que darle de alta las formas nuevas: «Todos/Todas», «Privado/Privada»,
  «Instalados/Instaladas ·», «Abrir / Abierto / Abiertas», «Ejecutar / Ejecutá /
  Ejecución», «Comentar / Comentario», «Revisá / Revisar / Revisión» y
  «Tipo / Escribí». Y confirmar **«Revisar»** para los dos botones, que es la
  única forma que no salió de una bitácora.
- **Traductor:** `app settings` (`ConnectionSetupFlow.tsx:4030`) para que esa
  oración quede entera.
- **Lead:** decidir si se quiere el discriminante por clase de sitio para
  recuperar los 6 sitios de `RoutineVariablesEditor.tsx` y `SkillStudio.tsx`.
  Recupera `SkillStudio` limpio; `RoutineVariablesEditor` necesita además la
  distinción por forma del nodo.
- **Lead:** §17 del ADR pide revertir las 36 llamadas a `tEs()`. **No se hizo**
  —el encargo lo excluía— y siguen siendo 36.
- **QA:** las 8 cadenas se pueden mirar en pantalla. La más visible es el
  selector de alcance de Skill Studio, que tenía que leerse
  «Empresa / Private / Pública» y ahora cierra.
- **Dev UX/UI (CHA-37, ADR 0003):** cuando se parta `overlay.ts`, `por-sitio.ts`
  va del lado del diccionario. Está explicado arriba.

## Nota sobre la suite completa de upstream

Se corrió entera **dos veces** (754 archivos, ~8.650 casos). Las dos dieron
rojo, **en archivos distintos**, y las dos veces lo rojo pasa al correrlo
aislado:

| Corrida | Resultado | Lo que falló | Aislado |
| --- | --- | --- | --- |
| 1, timeout por defecto (5 s) | 750 pasan, **3 archivos / 8 casos** fallan | todos **timeouts**, no aserciones: `src/lib/cron-fires.test.ts`, `src/components/IssuesList.test.tsx` (+1 que el reporte truncó) | los dos identificados: **62 casos pasan** con `--testTimeout=60000` |
| 2, `--testTimeout=60000` | 752 pasan, **1 archivo / 3 casos** fallan | `src/pages/CompanySettings.test.tsx > CompanyEnvironments`, con `expected null to be truthy` y ruido de `act(...)` | **4 casos pasan** |

**Conjuntos de fallas disjuntos entre corridas + verde al aislar** es la firma
de fragilidad por carga y orden, no de una regresión. Es exactamente lo que QA
documentó en CHA-28: la suite miente en rojo bajo carga.

Y el argumento que cierra el caso, que no depende de cuántas veces se corra:
**este cambio no puede alcanzar esos tests.** `CompanySettings.tsx`,
`CompanySettings.test.tsx` y `CompanyEnvironments.tsx` **no importan nada** de
`i18n-es-ar/`, y `vitest.config.ts` de upstream **no carga ningún plugin**, así
que el marcado no corre ahí y `por-sitio.ts` no entra al grafo. Verificado con
`grep`, no supuesto.
