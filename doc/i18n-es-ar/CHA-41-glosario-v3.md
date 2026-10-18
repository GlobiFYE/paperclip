# CHA-41 — Glosario es-AR v3: las formas por sitio y las limitaciones declaradas

Bitácora del Traductor i18n. Cierra el **entregable 1 de CHA-2**. Es trabajo de
documentación: **cero código, cero diccionario, cero mapa por sitio, cero
archivos de upstream.**

## Lo que se agregó al glosario

| Sección | Qué quedó |
| --- | --- |
| cabecera | **v2 → v3**, con el «Cambios respecto de la v2» |
| §2 | corregida la fila de `Mine`: la v1 decía «Mis tareas» y el corte 2 entregó «Mías». Ver abajo |
| §5 | un puntero: cinco de sus botones (`Open`, `Run`, `Comment`, `Review`, `Type`) no tienen una sola forma |
| **§9 nueva** | **las formas por sitio**: las 8 familias, los tres discriminantes, por qué 7 no tienen entrada global, y el género de `All` en Búsqueda |
| **§10 nueva** | **las limitaciones conocidas del corte 2**, en un solo lugar y cada una con su motivo |

Lo que §9 fija **no es el reparto archivo por archivo** —eso es
[CHA-38](CHA-38-mapa-por-sitio.md) y no tiene sentido copiarlo: se
desactualiza—. Fija el **discriminante**: la pregunta que hay que contestar para
saber qué forma va en un archivo que todavía no está en el mapa. Son tres, y las
tres salen de §1, que ya estaba escrita desde la v1:

1. ¿cuál es el sustantivo elidido y de qué género es? → `All`, `Private`,
   `Installed ·`
2. ¿es verbo o sustantivo? → `Open`, `Run`, `Comment`, `Review`, `Type`
3. si es verbo, ¿es botón o oración? → infinitivo o voseo

El mapa por sitio **no cambió ninguna decisión anterior**: le agregó la dimensión
del archivo a ocho cadenas. Lo que sí hizo fue dejar tres reglas de §7 —la 3 de
CHA-27, la 1 de CHA-31 y la 2 de CHA-33— diciendo «no entra» sobre cadenas que
ahora entran. Quedan escritas como registro de por qué no entraban, con una nota
en §9 que dice que lo que vale hoy es §9. Borrarlas sería peor: el patrón que
describen («esta cadena necesita dos españoles») es justo el que hay que
reconocer para llevarla al mapa.

## «Revisar»: **confirmado**

Era lo único que la tarea me pedía decidir, y la decido como está.

`Review` en `pages/PluginManager.tsx:326` y en
`pages/tools/profiles/ProfileDetail.tsx:348` son **botones**, verificados en el
código: el primero es el único hijo de un `<Link>` dentro de un `<Button>`, el
segundo un `<Button size="sm" onClick={onReview}>`. §1 pide infinitivo para
botones y acciones, así que **«Revisar»**. Que la forma la haya propuesto Dev
UX/UI y no una bitácora de traducción no la hace sospechosa: es la regla 3 de §9
aplicada, la misma que ya decidió `Open`→«Abrir», `Run`→«Ejecutar» y
`Comment`→«Comentar». Hoy esos dos botones dicen «Revisión», que está mal.

Las alternativas que miré y por qué no:

- **«Revisalo» / «Revisalas»** — el voseo es para el texto corrido (§1), y acá
  además obliga a elegir el objeto: en `PluginManager` es un plugin y en
  `ProfileDetail` son herramientas nuevas. Una sola cadena no puede con los dos.
- **«A revisar»** — se lee como rótulo de estado, no como acción. Choca con
  «En revisión» de §3.
- **«Revisión»**, o sea dejarlo como está — es el sustantivo, y en un botón
  nombra la cosa en vez de la acción. Es exactamente el defecto que CHA-30
  encontró en `IssueRunLedger.tsx` y que el mapa vino a arreglar.

Las otras siete familias no las toqué: salen de bitácoras de traducción y el
reparto por archivo lo hizo CHA-38 leyendo los 91 sitios.

## Repaso de las 58 entradas del mapa

Leí los sitios de las asignaciones donde la decisión es de traducción y no de
mecanismo —los 11 archivos de `All`, los dos géneros de `Private`, los dos de
`Installed ·`, los tres sentidos de `Open`, `Run`, `Comment` y `Review`, y los
dos de `Type`—. **No encontré ninguna forma mal puesta.** Tres que valía la pena
verificar y quedan bien:

- **`components/ActivityFeed.tsx` → «Todos»** y no «Todas». El filtro parece de
  tareas, pero sus hermanos en pantalla son «En curso», «En revisión» y «Listo»:
  ninguno es femenino, así que «Todos» es lo coherente.
- **`pages/JoinRequestQueue.tsx` → «Todos»**. El `<select>` se rotula «Request
  type» y sus opciones son Human / Agent: lo elidido son los pedidos de ingreso
  (masculino, §2), no las personas.
- **`components/task-side-panel/TaskSidePanel.tsx` → «Abrir»**, que es la
  corrección que hizo CHA-38 sobre lo que había leído CHA-27. Confirmo:
  `{ id: "open", label: "Open", items: primary }` encabeza un lanzador de
  paneles, y cada ítem trae su bandera `alreadyOpen`. Es la acción.

## Pedidos (no los implemento: son diccionario o mapa)

Ordenados por lo que arreglan. Los dos primeros ya están escritos como decisión
en §10.5 del glosario, con la forma elegida; los demás son hallazgos de este
repaso.

| # | Qué | Dónde | Forma | Por qué |
| --- | --- | --- | --- | --- |
| 1 | `On` / `Off` / `Archived` / `Draft` en el span de 48 px | `components/RoutineList.tsx:188-190` | **Activa** / **Inactiva** / **Archivada** / **Borrador** *(las cuatro, o ninguna)* | es **D-3** de CHA-36, el único desborde nuestro de la pasada visual. Hay una implementación en curso que elige otras formas: ver abajo |
| 2 | `Installed` *(sin el `·`)* | `pages/TeamCatalog.tsx:739` | **Instalado** | tiene entrada global «Instaladas» (`skills.json`) y ese sitio es el badge de **un equipo**: género y número equivocados. Es la novena homógrafa de la familia y CHA-38 sólo mapeó `Installed ·` |
| 3 | `All` | `pages/Search.tsx` | **Todos** | la decisión que CHA-39 y CHA-36 dejaron abierta. Está razonada en §9.3: lo elidido son «los ámbitos» y cinco de los seis hermanos son masculinos. Es **una línea** y arregla la primera pestaña de Búsqueda |
| 4 | `Open Settings` | `pages/PluginManager.tsx:326` | **Abrir la configuración** | es la **otra rama del mismo ternario** que recibe «Revisar», y no está en el diccionario. Con una lista de plugins mezclada se ven las dos ramas a la vez: «Revisar» al lado de `Open Settings`. Botón que manda a otra pantalla → lleva artículo (§5) |
| 5 | `Blocked` | `pages/Inbox.tsx:2440`, `pages/LegacyInbox.tsx:2307` | **Bloqueadas** | la entrada global es «Bloqueada» (singular, el chip de una tarea) y en la fila de pestañas queda «Mías / Recientes / Sin leer / **Bloqueada** / Todas». El singular canta al lado de cuatro plurales |
| 6 | `Done` | `components/ActivityFeed.tsx:119` | **Terminado** *(baja prioridad)* | la global es «Listo», que es la forma de botón (§5). En ese filtro es un estado, y queda «Todos / En curso / En revisión / Listo». Es coherencia, no un defecto; si se toca, masculino, que es lo que ya decidió el «Todos» del mismo filtro |

### D-3 se está implementando en paralelo, y con otras formas

Cuando fui a commitear, el worktree **no estaba limpio**: hay trabajo sin
commitear de otro rol (`navigation.json`, `skills.json`, `por-sitio/es-AR.json`,
`por-sitio.test.ts`, `text-sites.ts` — se ve el arreglo de D-4 y el de
«Secrets & variables»). Commiteé **sólo mis dos archivos**, con `git add` por
ruta, así que no toqué nada de eso. Lo digo porque una de esas líneas choca con
esta tarea:

```json
"components/RoutineList.tsx": { "Archived": "Archivo", "Off": "Off", "On": "Activa" }
```

Coincidimos en `On` → «Activa». Las otras dos no, y la decisión de forma es de
glosario:

- **`"Off": "Off"`** deja la columna a medio traducir: «Activa» para unas
  rutinas y `Off` para otras, en la misma columna de la misma lista. Es la regla
  3 de CHA-34 (§7) al revés. El mecanismo funciona —la entrada de identidad no
  la rebota ningún test, porque la guarda de «ninguna traducción es idéntica al
  inglés» recorre `ES_AR_AREAS` y no el mapa—, así que esto no se va a poner
  rojo solo: es una decisión, y la que corresponde es «Inactiva» o,
  si no entra, **las cuatro en inglés**.
- **`"Archived": "Archivo"`** es un sustantivo donde va un adjetivo: en esa
  columna «Archivo» se lee como un archivo de disco. Va «Archivada».

Está razonado en §10.5 del glosario, con la advertencia de que las anchuras las
mide QA y que `Draft` → «Borrador» es la única de las cuatro que hay que medir
antes de ponerla (cortada a siete caracteres queda «Borrado», que dice algo
falso). **Es para que el Lead reconcilie**: no edité el mapa ni el trabajo de
nadie.

Dos que no son pedidos míos y los dejo apuntados porque aparecieron al leer:

- **`Mine` → «Mías»**: el diccionario (`navigation.json`) y el glosario §2 no
  decían lo mismo —la v1 había escrito «Mis tareas»—. **Corregí el glosario, no
  el diccionario**: «Mías» es la forma correcta para una pestaña y sus dos
  únicos sitios son pestañas. Nadie tiene que hacer nada.
- **`pages/apps/CatalogSourceFilters.tsx:6`** tiene `installed: "Installed"` y
  `all: "All"` en un `export const` que no está declarado en `text-sites.ts`.
  Si alguna vez se declara, las dos cadenas son de las familias de §9 y
  necesitan forma por sitio, no entrada global. Es para quien amplíe la lista
  blanca, no para ahora.

## Lo que verifiqué y lo que no

- **Verifiqué leyendo el código** los sitios que nombro acá y en §9/§10 del
  glosario, con archivo y línea, sobre `94d421eaf`. Una aclaración de números,
  porque en la tarea y en CHA-38 difieren: los sitios se citan con **la línea
  que reporta el marcado**, que es la de apertura del elemento, no la del nodo de
  texto. Por eso `ConnectionSetupFlow.tsx:4030` y
  `WizardToolsStep.tsx:205`, aunque el literal se lea una línea más abajo en los
  dos casos. Los dos números son correctos; conviene citar siempre el del
  marcado, que es el que aparece en la salida con la que se relevan los sitios.
- **No corrí `markText`, ni builds, ni la suite**: la tarea es doc. Eso tiene
  una consecuencia concreta para el pedido 2: el sitio de `Installed` en
  `TeamCatalog.tsx:739` lo inferí de que es un nodo de texto JSX de la misma
  forma que el `Installed · {n}` del mismo archivo, que CHA-38 **sí** relevó con
  el marcado. Quien lo implemente conviene que lo confirme con el marcado
  primero: contar sitios a ojo es el error que CHA-30 pagó.
- **No toqué el diccionario ni el mapa por sitio**, como pedía el encargo. Todo
  lo que me pareció mal está en la tabla de pedidos.

## Para otros roles

- **Lead:** los seis pedidos de arriba. El 1 (D-3) y el 3 (`All` en Búsqueda)
  son los dos que QA y CHA-39 dejaron esperando una decisión de glosario, y las
  dos decisiones están tomadas en §9.3 y §10.5: lo que falta es una línea de
  mapa cada una. **El 1 además hay que reconciliarlo**: se está implementando en
  paralelo con otras formas, está arriba con el diff a la vista.
- **Lead:** sigue abierto lo que no es mío y el glosario §10 deja declarado: el
  discriminante por clase de sitio para los 6 sitios de `RoutineVariablesEditor`
  y `SkillStudio` (§10.2), y `Backlog`, que es pregunta al dueño (decisión 9.3).
- **Dev UX/UI:** nada de esta tarea toca código. Los pedidos 1 a 6 son líneas de
  diccionario o de mapa, ninguna edición de upstream.
- **Quien escriba el glosario v4:** §9 es el lugar de las homógrafas. Si una
  cadena nueva necesita dos españoles, no vuelve a «lo que no entró»: va al mapa
  y su discriminante va a §9.1.
