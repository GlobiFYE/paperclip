# CHA-39 · Las dos declaraciones que faltaban en `text-sites.ts`

Corte 2, cierre §3.2. Dos nombres de la lista blanca, **cero ediciones de
upstream** y **cero presupuesto de `tEs()`**: los seis archivos tocados están
todos dentro de `ui/src/i18n-es-ar/`.

De las dos que pedía el plan entró **una y media**. `detail` entró entero;
`SCOPE_LABELS` entró y `describeScope` **no**, porque dispara el guardrail de
CHA-28 y eso es una decisión del Lead. Está todo en «Lo que no entró».

## 1. `detail` en `TEXT_ATTRS`

```ts
"error", "approveLabel", "rejectLabel", "requestedAccess",
"detail",
```

Lo venían pidiendo cuatro lotes seguidos (CHA-30 con 9 sitios, CHA-31 con 10,
CHA-32 con 11, CHA-33 con 17) y no es una decisión de producto nueva: el nombre
**ya estaba en `TEXT_KEYS`** (`text-sites.ts:36`), con una excepción por archivo
para `TaskChatThread.tsx`. Lo que faltaba era la misma decisión aplicada a la
variante «atributo de JSX».

**Antes de agregarlo revisé los 35 `detail=` del árbol, uno por uno.** El
riesgo real de ampliar `TEXT_ATTRS` es arrastrar sitios que no son etiqueta —es
lo que pasa con `action`, que lleva clases de Tailwind 113 veces (§7.2)—, y acá
no pasa: `detail` es la segunda línea de una ficha, debajo de `label`, y los 35
sitios llevan texto. Ni una clase, ni un valor técnico, ni un identificador. Por
eso no hizo falta la salida de escape que el plan dejaba abierta (una entrada
por archivo en `TEXT_DECLS` para los tres archivos).

## 2. `SCOPE_LABELS` en `TEXT_DECLS`

```ts
{ file: "src/pages/Search.tsx", names: ["SCOPE_LABELS"] },
```

El mapa de las siete pestañas de Búsqueda está indexado por el valor técnico
del API (`all`, `issues`, `comments`, …), que es el caso de ADR 0002 §10.5. La
salida del marcado, con los números de línea intactos:

```tsx
const SCOPE_LABELS: Record<CompanySearchScope, string> = {
  all: __tEs("All"),
  issues: __tEs("Tasks"),
  comments: __tEs("Comments"),
  …
};
```

### Las siete, una por una

El cierre decía «seis de siete ya traducidas». Medido contra el diccionario de
hoy son **cinco**: `Tasks`, `Documents`, `Artifacts`, `Agents` y `Projects`.

| Pestaña | Estado |
| --- | --- |
| `Tasks` → Tareas | ya estaba (`navigation.json`) |
| `Documents` → Documentos | ya estaba (`issues.json`) |
| `Artifacts` → Artefactos | ya estaba (`navigation.json`) |
| `Agents` → Agentes | ya estaba (`navigation.json`) |
| `Projects` → Proyectos | ya estaba (`navigation.json`) |
| `Comments` → **Comentarios** | **agregada acá**, `search.json` |
| `All` | **queda en inglés**, a propósito: ver abajo |

`Comments` se agrega como entrada **global** y eso se revisó: el marcado la
produce en tres sitios —la pestaña de Búsqueda, la métrica de `UserProfile.tsx`
y un encabezado de `DesignGuide.tsx`— y en los tres es el sustantivo plural. No
es homógrafo. Es distinto de `Comment` en singular, que sí lo es y que CHA-38
resolvió por sitio en cinco archivos («Comentar» el botón, «Comentario» el
sustantivo).

`All` es una de las 8 homografías de CHA-38 («Todas» las tareas vs. «Todos» los
agentes) y el mapa por sitio de ese corte **no tiene entrada para
`pages/Search.tsx`**, así que queda en inglés. El sitio ahora está declarado, o
sea que alcanza con una línea en `dictionary/por-sitio/es-AR.json` cuando se
decida el género —las siete pestañas cubren tareas, comentarios, documentos,
artefactos, agentes y proyectos, que es justo el caso mezclado—. Verifiqué que
el canal de declaraciones **sí** llega al mapa por sitio para los `const`:
`llamada()` le pasa el sitio a todo literal que marca, y la salvedad que anotó
CHA-38 es sólo para el `return` de una función, donde lo que se busca ya no es
un literal del archivo.

## 3. Las traducciones, de las bitácoras y no inventadas

Nueve entradas nuevas, todas copiadas de donde los lotes anteriores las habían
dejado escritas:

| Cadena | es-AR | Área | De |
| --- | --- | --- | --- |
| `Comments` | Comentarios | `search.json` | glosario (`Comment` → Comentario) |
| `A run is active now` | Hay una ejecución activa ahora | `routines.json` | CHA-33 |
| `No active run` | No hay ninguna ejecución activa | `routines.json` | CHA-33 |
| `Scheduled` | Programada | `routines.json` | CHA-33 |
| `Run manually or wait for a trigger` | Ejecutala a mano o esperá un disparador | `routines.json` | CHA-33 |
| `The weekly schedule is enabled and can create background work.` | La programación semanal está activada y puede crear trabajo en segundo plano. | `agents.json` | CHA-33 |
| `Nothing runs until you enable the weekly schedule — it costs zero tokens by default.` | No corre nada hasta que actives la programación semanal: por defecto no gasta ni un token. | `agents.json` | CHA-33 |
| `Dedicated to one agent` | Dedicada a un solo agente | `connections.json` | CHA-32 |
| `Last attempt {0}` | Último intento {0} | `skills.json` | CHA-31 |

Las tres de `traces.json` que CHA-30 había dejado escritas —`capture was off`,
`no exact bytes`, `Raw capture off`— **ya estaban en el diccionario** y lo único
que les faltaba era el sitio: entran solas con `detail`, sin agregar nada.

## 4. Lo que se movió, medido

Con `node src/i18n-es-ar/tools/report-text-sites.ts`:

| Medición | Antes (CHA-38) | Después |
| --- | ---: | ---: |
| entradas del diccionario es-AR | 3.864 | **3.873** |
| entradas **cubiertas** por algún sitio marcado | 3.857 | **3.869** |
| entradas **sin cubrir** (§1 del reporte) | 7 | **4** |
| sitios marcados | 19.552 | **19.589** |
| de ésos, `jsx-attr` | 3.371 | **3.393** |
| de ésos, `decl` | 58 | **65** |
| claves distintas que el marcado produce | 11.962 | **11.990** |

Las 9 entradas nuevas quedan cubiertas y además se recuperan las 3 de
`traces.json`: +12 cubiertas con +9 entradas. `detail` desaparece de la lista de
nombres sin cubrir de §2 del reporte.

El diff de claves lo medí de verdad y no por grep: corrí el marcado sobre todo
`ui/src` dos veces —una con los dos nombres puestos y otra sacándolos del `Set`
y del array en caliente— y comparé los conjuntos.

## 5. Las 17 cadenas que ahora **se pueden** traducir y todavía no lo están

Las dos declaraciones abren 28 claves nuevas. Once quedan traducidas (las 9 de
arriba + las 3 de `traces.json`, menos `Comments` que ya era una clave marcada
en otro lado). Las otras 17 **no estaban traducidas antes y siguen sin estarlo**:
el overlay las deja pasar en inglés, igual que hoy, así que no hay regresión. Lo
que cambia es que ahora son alcanzables, y ésta es la cola lista para el próximo
lote:

| Cadena | Archivo |
| --- | --- |
| `Waiting for an incoming request` | `components/RoutineOverview.tsx` |
| `Add or enable a schedule` | `components/RoutineOverview.tsx` |
| `A proposed Reflection Coach update is waiting for review.` | `components/BuiltInBundlePanel.tsx` |
| `Personal identity` | `pages/apps/app-detail/IdentitiesSection.tsx` |
| `Organization identity` | `pages/apps/app-detail/IdentitiesSection.tsx` |
| `correlated groups` | `components/RunnerInspector.tsx` |
| `captured through {0}` | `components/RunnerInspector.tsx` |
| `{0} visible` | `components/RunnerInspector.tsx` |
| `{0} ignored` | `components/RunnerInspector.tsx` |
| `Submitted {0}` | `pages/CompanyAccess.tsx` |
| `Ask {0} to send a fresh {1} authorization link.` | `components/IssueThreadInteractionCard.tsx` |
| `Only {0} can connect their own {1} account.` | `components/IssueThreadInteractionCard.tsx` |
| `{0} can ask again with a new {1} authorization link.` | `components/IssueThreadInteractionCard.tsx` |
| `In channels, only respond to messages that @mention this bot, including thread replies. Direct messages never require an @mention and must be allowed above.` | `pages/apps/chat/ChatEndpointDetail.tsx` |
| `The bot may participate in group chats where it is installed.` | `pages/apps/chat/ChatEndpointDetail.tsx` |
| `People without linked accounts can start isolated tasks. They cannot approve actions, spend, or manage access. Requests are refused when isolation is unavailable.` | `pages/apps/chat/ChatEndpointDetail.tsx` |
| `People must also enable Direct Messages in their shared Discord server’s Privacy Settings.` | `pages/apps/chat/ChatEndpointDetail.tsx` |

No las traduje acá porque el plan era explícito —«dos declaraciones bien puestas
antes que un intento apurado»— y porque traducirlas es un lote, con glosario y
revisión, no una línea en la lista blanca.

Un detalle de pantalla que conviene saber antes de tomarlo: la ficha de
`RoutineOverview` **va a quedar mezclada igual**, y no por estas cadenas. El
`value=` de las mismas cuatro tarjetas lleva `On webhook delivery` y
`Not scheduled`, y `value` **no entra a la lista blanca por nada** (§7.3): es
justo la posición que el ADR existe para no marcar. Es un límite estructural, no
una cadena que falte.

## Lo que no entró: `describeScope`

El plan pedía declarar también `describeScope`. **No se hizo**, y es la
excepción que el plan mismo previó: «un cuarto es hallazgo: parás y avisás».

`describeScope` es una `function`, así que el canal de declaraciones no le marca
literales sueltos: le envuelve el `return` entero. Su segundo `return` es

```tsx
return SCOPE_LABELS[scope];   // → __tEs(SCOPE_LABELS[scope])
```

y eso es una **cuarta posición no literal** en el árbol. Lo confirmé corriendo
el test, no deduciéndolo:

```
AssertionError: expected [ …(4) ] to deeply equal [ …(3) ]
  [ "src/components/KanbanBoard.tsx",
    "src/components/StatusIcon.tsx",
    "src/pages/CompanyEnvironments.tsx",
+   "src/pages/Search.tsx" ]
```

`datos-del-dueno.es-ar.test.tsx` lleva esa lista a mano a propósito: es la
medición que convierte la invariante de §4 —el dato del dueño no tiene por dónde
llegar a `lookup()`— en algo que falla antes de entregar. Ampliarla es del Lead.

**Lo que costaría y lo que daría, para que la decisión sea corta:**

- **El riesgo parece nulo.** `scope` es `CompanySearchScope`, una unión cerrada
  de 7 valores del API, y `SCOPE_LABELS` sólo tiene literales del código. Es la
  misma forma que `statusLabel` en `StatusIcon.tsx`, que ya está en la lista. No
  hay por dónde meter texto que escribió una persona.
- **El beneficio es exactamente una cadena.** Para los seis ámbitos que no son
  `all`, `describeScope` devuelve `SCOPE_LABELS[scope]`, que **ya sale traducido**
  con lo que entregué: la pantalla vacía dice «No encontramos nada en tareas.»
  sin tocar nada más. Lo único que queda en inglés es el caso `all`
  (`"All scopes"`), en un solo estado de una sola pantalla.
- **Si el Lead lo aprueba** son tres cosas: el nombre en `TEXT_DECLS`,
  `"src/pages/Search.tsx"` en `ESPERADAS` (y un cuarto caso en el test de al
  lado, «ninguna de esas funciones puede devolver texto de una persona»), y la
  entrada `"All scopes": "Todos los ámbitos"` en `search.json`. La traducción
  sale del glosario, que fija `Scope (de la búsqueda)` → `Ámbito`.

La entrada `"All scopes"` **no** quedó en el diccionario: sin el sitio marcado
sería una entrada que ningún sitio produce, o sea §1 del reporte pasando de 4 a
5. La traducción no se pierde, queda acá.

## Hallazgo aparte: «alcance» y «ámbito» en la misma oración

Con `Comments` adentro, la pantalla vacía de Búsqueda dice

> No encontramos nada en comentarios. Probá ampliar **el alcance** o reformular
> la consulta.

El glosario fija `Scope (de la búsqueda)` → **Ámbito**, y `search.json` lo
cumple en `"Search all scopes"` → «Buscar en todos los ámbitos». Pero
`". Try widening the scope or rephrasing your query."` quedó como «ampliar el
alcance». Son dos palabras para la misma cosa a dos oraciones de distancia.

No lo cambié: es una entrada de diccionario ya revisada de otro lote y arreglarla
de prepo en esta tarea sería meterme en una decisión de traducción ajena. Es una
línea y es para el Lead o para quien tome el próximo lote de Búsqueda.

## Gates

| Gate | Resultado |
| --- | --- |
| `pnpm run typecheck` | **0 errores** |
| `vitest` (config de upstream), `src/i18n-es-ar` | 174 pasan, 19 salteados, 0 fallan |
| `vitest --config vitest.config.es-ar.ts` | 20 pasan, 0 fallan |
| posiciones no literales (CHA-28) | **3**, sin moverse |
| `vite build` (upstream) | ✓, y **0** marcas `__tEs(` en `ui/dist` |
| `vite build --config vite.config.es-ar.ts --outDir dist-es-ar` | ✓ |
| archivos de upstream tocados | **0** |
| `pnpm-lock.yaml`, `package.json` | sin una línea de diferencia |
| llamadas a `tEs(` en upstream | **36**, sin moverse |

Las **dos** configs de vitest, no una: con la de upstream
`real-components.es-ar.test.tsx` se saltea a propósito, así que una sola miente
por omisión.

En `ui/dist-es-ar` verifiqué que viajan las nueve cadenas nuevas y las seis
pestañas traducidas: «Comentarios», «Tareas», «Documentos», «Artefactos»,
«Proyectos», «Hay una ejecución activa ahora», «No hay ninguna ejecución
activa», «Programada», «Ejecutala a mano o esperá un disparador», «La
programación semanal está activada…», «…no gasta ni un token», «Dedicada a un
solo agente», «Último intento».

### Una corrección al registro de CHA-38

CHA-38 anotó «172 pasan, 19 salteados» con la config de upstream. El árbol de
hoy da **174**, y **no es por este cambio**: corrí la suite contra `HEAD` con
los seis archivos guardados aparte y también da 174/19.

### Una trampa del build, para el próximo

`vite.config.es-ar.ts` hereda el `outDir` de upstream, así que
`vite build --config vite.config.es-ar.ts` **sin `--outDir` escribe en `ui/dist`
y pisa el build de upstream**. CHA-35 ya lo documenta con el flag puesto
(`--outDir dist-es-ar`); vale repetirlo porque el síntoma es silencioso: el
build sale ✓, `ui/dist-es-ar` queda viejo, y verificar contra él da verde por
una corrida anterior. Los dos builds de la tabla se corrieron con `--emptyOutDir`
y cada uno a su carpeta.

## Para otros roles

- **Lead:** decidir `describeScope` (arriba está el costo y el beneficio
  completos: una cuarta posición no literal a cambio de una cadena). Decidir
  también el género de `All` en `pages/Search.tsx` para el mapa por sitio, y si
  «alcance»/«ámbito» se unifica en `search.json`.
- **Quien tome el próximo lote:** las 17 cadenas de §5 están listas para medir,
  y `summary` sigue siendo el nombre que falta para `Loading permissions…`
  (§1 del reporte), con **un solo sitio**.
