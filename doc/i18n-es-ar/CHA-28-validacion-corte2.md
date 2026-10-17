# CHA-28 — validación del corte 2 sobre la línea de entrega

Bitácora de QA de la validación del lote compartido (CHA-27) sobre
`es-ar/corte2`, worktree `/paperclip/workspaces/es-ar-corte2`, con el blindaje
de ADR 0002 (CHA-23) puesto.

CHA-27 cerró el lote el 2026-10-17 a las 20:05Z (`a3b44f63b`): las 494 largas
portadas más las 859 cortas, **1.344 entradas nuevas** medidas sobre los cinco
commits del lote. El veredicto de la validación está en la sección 2; la
sección 1 es el hallazgo de infraestructura que levanté antes de que entregara.

**Veredicto: el lote pasa.** La garantía del dueño se sostiene y además se puede
sostener con una medición sobre el árbol entero, no sobre una muestra. Quedan
tres hallazgos que no lo rebotan y un chequeo que no se pudo hacer, los cuatro
en la sección 2.6.

## 1. La suite de `src/i18n-es-ar` es frágil bajo carga, y miente en rojo

Levantado por el Traductor i18n sobre `es-ar/entrega-master`. Lo reproduje acá
y lo medí, porque un test que cambia de veredicto según cómo lo corras
envenena el gate entero: el día que yo diga «rojo, rebotado» alguien va a
tener razón en no creerme.

### Qué pasa

`overlay.dom.test.tsx` simula una recarga de navegador por caso: `reload()`
hace `vi.resetModules()` y vuelve a importar el overlay y los mapas de
etiquetas de upstream. Eso cuesta caro y el costo es el problema.

Con la máquina libre, `pnpm exec vitest run src/i18n-es-ar/overlay.dom.test.tsx
--reporter=verbose` (20 casos, todos verdes):

| Caso | Duración |
| --- | --- |
| traduce la cadena marcada y no toca el identificador técnico | **4104 ms** |
| un navegador en español ve español sin tocar nada | 3720 ms |
| cualquier otro navegador ve inglés | 3431 ms |
| una elección guardada sobrevive la recarga | 2451 ms |
| el resto (16 casos) | 15 – 1626 ms |

El `testTimeout` por defecto de Vitest es **5000 ms**. O sea que el caso más
lento usa el **82 % del presupuesto con la máquina ociosa**. No hay margen: no
es que falle a veces, es que está calibrado para fallar en cuanto la máquina
tenga algo más que hacer.

### La falla que miente

Lo importante no es el timeout, es lo que viene después. Repetí la suite con 12
procesos quemando CPU al lado (8 núcleos):

```
pnpm exec vitest run src/i18n-es-ar     # con 12 bucles de carga al lado
→ 5 failed | 92 passed | 13 skipped
  4 × "Test timed out in 5000ms"
  1 × AssertionError: en-US: expected 'es-AR' to be 'en'
```

Esa última **no es un timeout**: es una afirmación de contenido que falla. El
caso «cualquier otro navegador ve inglés» vio es-AR. Es el mismo bicho que el
`expected 'Blocked' to be 'Bloqueadas'` que reportó el Traductor, y es la
versión peligrosa: cuando un caso se aborta por timeout, su continuación sigue
viva y vuelve a tocar el registro de módulos y los espías de `navigator` que el
caso siguiente ya dejó armados. El resultado es un rojo que **señala al
diccionario o al blindaje**, cuando la causa es el reloj.

Confirmado que la causa es el presupuesto de tiempo y no el código traducido:

| Invocación | Resultado |
| --- | --- |
| `vitest run src/i18n-es-ar`, máquina libre, 3 corridas seguidas | **97 pasan / 13 skipped**, las tres |
| `vitest run src/i18n-es-ar/overlay.dom.test.tsx --reporter=verbose` | **20/20** |
| ídem con 12 procesos de carga al lado | 5 fallan, 1 de ellas por afirmación |
| `--testTimeout=1200` (forzado, máquina libre) | 8 fallan, **todas** por timeout |
| `--no-file-parallelism --testTimeout=20000` | **97 pasan / 13 skipped** (78 s) |

Medido el 2026-10-17 entre las 19:49Z y las 19:58Z; el branch se movió abajo
mío mientras tanto (de `2a67b2f44` a `8776ffccd`, los lotes de cortas que
CHA-27 va commiteando en este mismo worktree). Ninguna de las dos puntas
cambia el cuadro: el verde se repite en las dos y la falla aparece sólo con
carga.

### Lo que NO está roto: el test que sostiene la garantía del dueño

Revisé si la fragilidad puede producir un **verde falso**, que sería mucho
peor: `real-components.es-ar.test.tsx` afirma que el contenido del dueño no se
traduce, y un overlay que no se instala haría pasar esas afirmaciones sin
probar nada.

No puede. `load()` tiene control positivo antes de cada caso:

```ts
expect(overlay.isOverlayInstalled(), "el overlay tiene que estar puesto").toBe(true);
expect(overlay.activeUiLocale()).toBe("es-AR");
```

Si el overlay no está, el caso falla en vez de pasar de taquito. Y el
`describe.runIf(withOverlay)` es lo que lo saltea entero bajo la config de
upstream — salteado a propósito, no apagado por accidente. **El riesgo está
acotado a rojos falsos en `overlay.dom.test.tsx`.**

### Qué hago yo con esto, y qué no

Regla para esta validación y las que sigan, en todo informe de QA de este
corte: **se reporta con qué invocación se corrió**, y *un rojo en paralelo se
repite en serie antes de llamarlo defecto*:

```
pnpm exec vitest run src/i18n-es-ar --no-file-parallelism --testTimeout=20000
```

El arreglo **no lo hago yo**. Las dos salidas posibles tocan
`ui/src/i18n-es-ar/overlay.dom.test.tsx`, que es de Dev UX/UI:

1. **Barata**: subirle el `testTimeout` al archivo (`vi.setConfig` o el timeout
   del `describe`). Tapa el síntoma; con 4,1 s medidos, 20 s deja margen real.
2. **De fondo**: que un caso abortado no pueda tocar el estado del siguiente
   —que `reload()` quede acotado por caso en vez de pisar el registro global—.
   Mata también el rojo mentiroso, que es el que hace daño.

Recomiendo las dos, en ese orden. Queda pedido al Lead para delegar.

---

## 2. La validación del lote (CHA-27, `a3b44f63b`)

Branch `es-ar/corte2`, worktree `/paperclip/workspaces/es-ar-corte2`, HEAD
`a3b44f63b`, árbol limpio. 2026-10-17, 20:10Z–20:30Z.

### 2.0 Con qué invocación corrió cada cosa

Es la regla que adopté en la sección 1 y vale para todos los números de acá:
**todo veredicto dice con qué invocación corrió**, y un rojo en paralelo se
repite en serie antes de que yo lo llame defecto.

| Qué | Invocación |
| --- | --- |
| Tests de las dos configs | `vitest run … --no-file-parallelism --testTimeout=200000` |
| Tipos | `pnpm exec tsc --noEmit` |
| Marcado sobre el árbol | `markText` sobre los 1.269 archivos que marca el plugin |
| Bundles | `vite build` con los paquetes del workspace reapuntados (ver 2.6, I-1) |

### 2.1 El chequeo central: el contenido del dueño no se traduce

El pedido era 0 de N sobre HTML real. Lo hice por los dos lados, porque cada uno
tapa el agujero del otro: **exhaustivo por el diccionario** (todas las entradas
de una sola palabra, no cuatro elegidas a mano) y **exhaustivo por el código**
(todo `ui/src` marcado, no los componentes que a mí me parecieron
representativos). Queda como test repetible en
`ui/src/i18n-es-ar/datos-del-dueno.es-ar.test.tsx`.

#### Por el lado del diccionario: 0 de 286, en tres componentes

Las 286 entradas de una sola palabra del diccionario completo (1.986 entradas),
pasadas como **dato** a componentes reales de upstream sin tocarles una línea:

| Dato | Componente | Traducidos |
| --- | --- | ---: |
| Nombre de agente | `AgentIdentity` (`title=` y texto) | **0 de 286** |
| Título de tarea y mensaje | `EmptyState` | **0 de 286** |
| Nombre de proyecto + ruta de archivo | `ArtifactFileChip` | **0 de 286** |
| Clave punteada como nombre de agente | `AgentIdentity` | **0 de 18** |

Los tres componentes se eligieron por lo que *no* cubre
`real-components.es-ar.test.tsx`: `ArtifactFileChip` arma
`"<proyecto> / <ruta>"` **en runtime**, que es el caso de dato compuesto que
ningún literal del código puede cubrir.

Honestidad sobre el método: la primera corrida me marcó 2 de 286 en los tres
componentes (`Role → Rol`, `Creates → Crea`). **Eran falsos positivos míos**: el
español es subcadena del inglés, así que buscar la traducción con `includes`
dentro del HTML da positivo contra el dato **sin traducir**. El detector quedó
comparando nodo de texto exacto, y el test documenta por qué.

#### La capa de patrones: 0 de 27

Los 9 patrones de `patterns.ts`, cada uno con `Deploy` metido en su captura de
texto libre, por los tres caminos (nombre de agente, título, mensaje):
**ninguno se disparó**. Cada caso lleva su control positivo: el test verifica
primero que la cadena **sí** pega en el patrón (`lookup("Deploy is archived")`
devuelve `"Deploy quedó archivada"`), así que el verde no es por un caso vacío.
Los casos se derivan de `PATTERNS` mismo: si mañana entra un patrón nuevo, se
prueba sin que nadie se acuerde de agregarlo.

#### Por el lado del código: 18.374 marcas, 3 no literales

En vez de confiar en una muestra de componentes, marqué **todo `ui/src`** y
revisé el argumento de cada marca que el plugin emite:

| Medición | Valor |
| --- | ---: |
| Archivos que el plugin marca | 1.269 |
| Archivos que terminan con alguna edición | 737 |
| Marcas `__tEs(…)` | **18.374** |
| Marcas `__tEsFmt(…)` (formatos) | 1.176 |
| Marcas cuyo argumento **no** es un literal estático | **3** |

Las tres, enteras:

| Archivo | Argumento |
| --- | --- |
| `src/components/StatusIcon.tsx` | `status.replace(/_/g, " ").replace(/\b\w/g, …)` |
| `src/components/KanbanBoard.tsx` | ídem (la copia byte a byte) |
| `src/pages/CompanyEnvironments.tsx` | `null` |

O sea: **18.371 de 18.374 marcas reciben una cadena que el compilador vio
escrita en el código fuente.** Las tres que no, son el canal de declaraciones de
`TEXT_DECLS`, que envuelve el `return` entero de una función declarada; las dos
primeras derivan del enum cerrado de 7 estados y la tercera es un `null`, que
`translate()` devuelve sin tocar por ser no-cadena. Ninguna puede llevar texto
que escribió una persona.

Eso convierte la invariante de §4 en una medición sobre el árbol: **el dato del
dueño no tiene por dónde llegar a `lookup()`**. El test deja las tres en una
lista esperada, así que una marca no literal nueva —un `TEXT_DECLS` agregado
sobre una función que sí recibe texto libre— aparece como falla antes de
entregar, y no como un nombre de agente traducido en la pantalla del dueño.

Lo que sí revisé a mano, por si el canal de declaraciones se ampliaba sin que la
lista lo mostrara: los `const` de `TEXT_DECLS` **no** son un agujero.
`declPlan` marca sólo los literales del inicializador, así que en
`secondaryLabel = session?.user.email?.trim() || "Signed in"`
(`SidebarAccountMenu.production.tsx:158`) lo que se envuelve es el `"Signed in"`
y **no** el mail de la persona. Es la diferencia entre envolver una región y
envolver un retorno, y está bien del lado seguro.

### 2.2 Las dos configuraciones de tests, y los tipos

| Invocación | Resultado |
| --- | --- |
| `vitest run --config vitest.config.es-ar.ts` (serial) | **20 pasan / 20** (12 de `real-components` + 8 nuevos) |
| `vitest run src/i18n-es-ar` con la config de upstream (serial) | **99 pasan / 19 salteados** |
| `pnpm exec tsc --noEmit` | **777 errores**, la línea base exacta, **0** en `i18n-es-ar` |

Los 19 salteados de la config de upstream son los `describe.runIf(withOverlay)`
de los dos archivos de es-AR: salteados a propósito, no apagados. El barrido del
marcado de 2.1 **no** lleva `runIf`, así que corre en las dos configs: la
invariante se mide igual con y sin plugin.

Los 777 son de `storybook/` y de tipos de `@paperclipai/shared` sin construir,
tal como dice la tarea. Mi archivo de test rompió la base (777 → 779, las dos en
mi archivo, `EmptyState` pide `message`); está arreglado y vuelve a dar 777.

### 2.3 Cero archivos de upstream, y el lockfile

Los cinco commits del lote (`2a67b2f44`, `3bb0f277a`, `507da0d34`, `8776ffccd`,
`a3b44f63b`) tocan **sólo** `ui/src/i18n-es-ar/**` y `doc/**`:
diccionario, más `overlay.ts` y `overlay.test.ts` (+4 líneas cada uno, los
`import` de las áreas nuevas `audit` y `traces`, que es lo que ADR 0001 §7.2
manda). **Cero archivos de upstream** y `pnpm-lock.yaml` **sin una línea de
diferencia** contra `2cc799236`.

Para que quede dicho con precisión, porque la medición da otra cosa si se mira
la rama entera y no el lote: contra `2cc799236` hay **12 archivos de upstream**
tocados en la rama, todos de CHA-15/CHA-23 (los `tEs` insertados en
`PriorityIcon`, `IssuesList`, `ActivityCharts`, `Sidebar`, `Agents`,
`ProfileSettings` y las tres de `src/lib/`). No son de este lote y no las
reboto; las anoto porque son la causa del hallazgo H-1.

### 2.4 El build de upstream sigue 100 % en inglés

Medido en el bundle emitido, no en el código fuente. La diferencia entre los dos
builds está en una constante:

| | bundle de upstream | bundle es-AR |
| --- | --- | --- |
| Bandera `OVERLAY_IN_BUNDLE` compilada | `mn=!1` (**false**) | `Kr=!0` (**true**) |
| `active()` | `if(!mn) return {locale:"en",chain:[]}` | resuelve el idioma |
| Marcas `__tEs` en el bundle | **ninguna** | las 18.374 |
| `tEs(clave, inglés)` | recorre `chain` vacía → devuelve el inglés | resuelve por clave |
| `isOverlayInstalled()` | `false` → el selector no se muestra | `true` |

O sea que el build por defecto **no puede** traducir: no hay una sola marca que
llame al overlay, y los `tEs` que CHA-23 dejó dentro de archivos de upstream
caen al inglés por cadena vacía. La reescritura de la bandera que hace el plugin
**funciona en un build real**, no sólo en los tests.

Ojo con el detalle que avisa la tarea: en esta rama **no existe**
`ui/vite.config.mjs`, y `ui/vite.config.ts` no tiene ni un commit nuestro. El
build por defecto de **esta** rama es el de upstream, en inglés; el es-AR sale
sólo con `--config vite.config.es-ar.ts`. Lo de CHA-22 vive en otra rama.

### 2.5 Las entradas están en el bundle es-AR compilado

Las **1.344** entradas que agrega el lote, buscadas una por una en el JS, CSS y
HTML emitidos del build es-AR: **0 ausentes de 1.344**. No es sólo que los tests
las vean: viajan en el bundle.

### 2.6 Lo que no rebota el lote pero hay que ver

**H-1 · El diccionario es-AR viaja en el build de upstream, y lo paga quien lo
lee en inglés.** Las 1.344 traducciones del lote están **también** en el bundle
de upstream: 16.09 MB contra 16.17 MB del es-AR, o sea que el marcado pesa ~80 KB
y el diccionario está en los dos. Cae todo en un chunk de **268 KB**
(`BreadcrumbContext-*.js`) que `index.html` **precarga con `modulepreload`**: lo
baja cualquiera, en la primera carga, aunque nunca pueda traducir una palabra.
El diccionario serializado son **134 KB**, y **91 KB los agregó este lote**.
No es una fuga —nada de eso se puede renderizar, ver 2.4— es peso muerto. La
causa no es el lote: es que archivos de upstream importan de
`@/i18n-es-ar/overlay` (los `tEs` de CHA-23 y el `LanguageSelector`), así que el
diccionario entra al grafo del build por defecto. El lote sólo lo hizo más
grande. **Es decisión de arquitectura** (cargar la capa aparte, o un `import()`
dinámico detrás de la bandera), no de QA ni del Traductor.

**H-2 · 15 de las entradas nuevas no las puede producir ningún sitio marcado.**
El reporte de la fase 3 pasó de 11 entradas sin cubrir (las de ADR 0002 §10) a
**26**; cruzadas contra el lote, **15 son de CHA-27**. Hay tres clases:

- **Fragmentos de oración que sí entraron**, aunque CHA-27 dejó 19 afuera por
  ese mismo motivo: `"? This replaces the agent's existing authentication with
  the responsible person's"`, `"connection. The model stays the same."`,
  `"Use Connections for"`, `"sign-in…"`, `"capture was off"`,
  `"no exact bytes"`. Un fragmento no puede pegar nunca: la clave es la cadena
  inglesa **completa** del sitio.
- **Cadenas que no están en `ui/src`**: `"Hide routine runs"`,
  `"Setup prompt copied. Ready to paste into your agent."`. La extracción trajo
  texto que hoy no está en el código.
- **Cadenas que viven en sitios que no se marcan nunca**: `"Not ready"` y
  `"Setup required"` están en atributos `value`, que la lista blanca excluye a
  propósito (§7.3).

Son 15 entradas que nunca se van a ver, y además viajan en los dos bundles
(H-1). Es trabajo del Traductor i18n, con el reporte de la fase 3 como lista:
`cd ui && node src/i18n-es-ar/tools/report-text-sites.ts`.

**H-3 · La pantalla de "no arrancó" queda en inglés.** `Paperclip couldn't
start` vive en `ui/index.html`, fuera de `ui/src`, así que el marcado no la
alcanza. Es la única pantalla que ve alguien cuando el bundle falla, y la ve en
inglés incluso en el build es-AR. Lo vi en el navegador, no leyendo el código.
Cuesta una línea en `index.html` —archivo de upstream— o se deja documentado:
decisión del Lead.

**I-1 · No se pudo hacer la pasada de desbordes, y la causa bloquea cualquier
build en esta rama.** `node_modules` de este worktree es un **enlace** al del
worktree del corte 1 (`/paperclip/workspaces/paperclip-es`), que está en otro
commit (`22a3ea341` contra `2cc799236`). Así que `@paperclipai/*` resuelve a los
paquetes de **otra rama** y el build muere con **37 `MISSING_EXPORT`** (el
primero: `aiProviderSetupPreset`, que este worktree sí exporta en
`packages/shared/src/index.ts:2860` y el otro no). Importa que **falla igual el
build de upstream y el de es-AR**: no es nuestro, es el entorno, y es la misma
causa que los 777 errores de tipos.

Con un `resolveId` que reapunta los paquetes del workspace a este worktree
conseguí emitir los dos bundles —de ahí salen 2.4 y 2.5— pero el bundle **no
arranca en el navegador**: `zod` no está en ese install, así que la app muere en
el límite de error y la pantalla que se ve es la de H-3. Medí en Chromium a
1440 px y 1024 px, en es-AR y con `?lang=en`: las cuatro cargas dan la misma
pantalla de error, 0 elementos recortados, sin scroll horizontal. **No es
cobertura de desbordes**: es la constancia de que no la hay.

Lo que sí se puede decir del riesgo, medido sobre las cadenas del lote: el es-AR
crece **×1,27 en promedio**, y de las 720 entradas nuevas cortas (≤18
caracteres, que son las que caen en botones y chips) **263 crecen 40 % o más**.
Las diez peores, que son por dónde hay que empezar a mirar:

| Inglés | es-AR | Δ |
| --- | --- | ---: |
| `Reset defaults` (14) | `Restablecer los valores por defecto` (35) | +21 |
| `Use agent default` (17) | `Usar el valor por defecto del agente` (36) | +19 |
| `No catalog match.` (17) | `No hay coincidencias en el catálogo.` (36) | +19 |
| `Device auth` (11) | `Autenticación por dispositivo` (29) | +18 |
| `Close agent setup` (17) | `Cerrar la configuración del agente` (34) | +17 |
| `Hide routine runs` (17) | `Ocultar las ejecuciones de rutinas` (34) | +17 |
| `Continue setup` (14) | `Continuar con la configuración` (30) | +16 |
| `Gateway auth token` (18) | `Token de autenticación del gateway` (34) | +16 |
| `Retry missed` (12) | `Reintentar lo que se perdió` (27) | +15 |
| `Run result` (10) | `Resultado de la ejecución` (25) | +15 |

Son **candidatos**, no defectos: en una pantalla real la mitad de esas cajas
tiene lugar de sobra. Para convertirlos en veredicto hace falta el navegador
contra una app que arranque, y para eso hace falta un `pnpm install` propio de
este worktree (o un enlace a un install del mismo commit). Es la pieza de
infraestructura que pido en el comentario de la tarea.
