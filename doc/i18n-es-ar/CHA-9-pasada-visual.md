# CHA-9 — Pasada visual del corte 1 es-AR con navegador

**Veredicto: el corte 1 cierra.** No hay un solo desborde de texto atribuible a
la traducción, en ninguna de las superficies que pedía la tarea, a 1440 px ni a
1024 px. Los 6 puntos de verificación funcional pasan. El punto 1 de la lista
anterior (el build de upstream sigue 100 % en inglés con el navegador pidiendo
español) quedó confirmado en pantalla y **no contradice** la medición de código.

Sí aparecieron dos defectos de traducción, los dos en los chips de estado, y
los dos se arreglan tocando sólo diccionario.

- Worktree: `/paperclip/workspaces/paperclip-es`, rama `traduccion-es`, commit `a06fbc8fb`.
- Navegador: Chromium 151.0.7922.34, headless.
- Fecha: 2026-10-17.

---

## 1. Cómo se midió (importa para leer el resultado)

Decir "no hay desbordes" no vale nada si no se dice contra qué. El método fue
este:

> Se carga **la misma pantalla, del mismo bundle, con los mismos datos**, dos
> veces: una en es-AR y otra con `?lang=en`. `?lang=en` es la precedencia más
> alta de `resolveUiLocale()`, así que apaga el overlay sin cambiar una línea de
> código ni un byte de datos. **Lo único que cambia entre las dos cargas es el
> largo del texto.**

Entonces, todo elemento que recorta o desborda en es-AR y **no** en inglés es un
desborde que causó la traducción. Lo que desborda en las dos ya venía de
upstream y no es nuestro: reportarlo sería mandarle al Dev a arreglar algo que
no rompimos.

Para cada elemento visible con texto se midió `scrollWidth` contra
`clientWidth`, el `text-overflow: ellipsis` efectivo, y si la caja se escapa de
un padre que no la recorta ni la scrollea ("empuja el layout").

**Dos anchos**, como pedía la tarea: 1440 px (escritorio normal) y 1024 px
(escritorio angosto).

**Cobertura:** 7 pantallas × 2 anchos × 2 idiomas, más 8 estados que hay que
abrir con el mouse (menú de estado, vista de tablero, menúes de la barra de
herramientas, diálogo de tarea nueva, menú de cuenta, selector de empresa,
escritorio de decisiones, selector de idioma), también × 2 anchos × 2 idiomas.

Toda la pasada fue **de sólo lectura**: el arnés contesta 405 a cualquier método
que no sea GET y lleva la cuenta. Escrituras bloqueadas al final de la corrida:
**ninguna**. No se tocó la instancia viva del NAS.

---

## 2. Desbordes de texto — el hueco más grande

### Resultado: ninguno

| Superficie (las que nombra la tarea) | Medidos | Recortados sólo en es-AR |
|---|---:|---:|
| Barra lateral — etiquetas de navegación | 22 | **0** |
| Chips de estado (menú de cambio de estado) | 7 | **0** |
| Chips de prioridad (diálogo de tarea nueva) | 2 | **0** |
| Encabezados de columna del tablero (por estado) | 7 | **0** |
| Botones, incluidos los angostos de la barra | 2 | **0** |
| Leyenda del gráfico de tareas por estado | 34 | **0** |
| Selector de idioma (perfil) | 15 | **0** |

Idéntico a 1440 px y a 1024 px. En el barrido general de las 7 pantallas
completas tampoco apareció ningún elemento que recortara en es-AR y no en
inglés, y la página no scrollea horizontal en español donde no lo hacía en
inglés.

### Cuánto margen queda

Lo importante no es sólo que hoy no se corte, sino por cuánto. Lo que más crece
al traducir:

| Dónde | Inglés | es-AR | Crece | ¿Se corta? |
|---|---|---|---:|---|
| Encabezado de columna del tablero | `TODO` (40 px) | `POR HACER` (74 px) | **+34 px** | no |
| Encabezado de columna del tablero | `IN REVIEW` (64 px) | `EN REVISIÓN` (80 px) | +16 px | no |
| Selector de idioma, descripción | `The interface as upstream ships it.` (204 px) | `La interfaz como la entrega upstream.` (223 px) | +19 px | no |
| Selector de idioma, párrafo | 644 px | 652 px | +8 px | no, quedan 20 px |
| Encabezado de columna del tablero | `CANCELLED` (76 px) | `CANCELADA` (80 px) | +4 px | no |

Los encabezados del tablero son cajas que se ajustan al contenido
(`shrink-to-fit`), así que crecen con el texto en vez de recortarlo: por eso
`POR HACER` puede crecer 34 % sin romper nada. Las etiquetas de la barra
lateral y los chips de estado y prioridad tienen **más de 24 px de margen**
libre en todos los casos, en los dos anchos.

Un detalle de implementación que vale la pena conocer: los chips del menú de
estado son `<button>` con `whitespace-nowrap`, o sea que **no pueden envolver**.
Hoy entran holgados; si en una tanda futura del diccionario alguna etiqueta de
estado se vuelve mucho más larga, ése es el lugar donde se va a notar primero.

**Para el Lead: no hace falta abrir tarea de arreglo de desbordes.** No hay
ninguno.

Capturas: `1440_issues-es.png`, `1024-vista-tablero-es.png`,
`1024_dashboard-es.png`, `1024-menu-cuenta-es.png`, `1440-menu-estado-es.png`.

---

## 3. Hallazgos

### H-1 · "Backlog" y "Blocked" quedan en inglés dentro de una lista que sí está traducida

**Severidad: se ve mal.**

En el menú de cambio de estado conviven, uno debajo del otro:

> Backlog · Por hacer · En curso · En revisión · Listo · Cancelada · Blocked

Cinco de siete traducidos y dos en inglés, en la misma lista y a la vista al
mismo tiempo. Lo mismo en los encabezados del tablero (`BACKLOG`, `POR HACER`,
`EN CURSO`, …, `BLOCKED`) y en la leyenda del gráfico del Panel.

- **Archivo:** `ui/src/i18n-es-ar/dictionary/es-AR/common.json`
- **Qué ajustar:** faltan las dos entradas literales. Hoy el archivo tiene
  `"In progress"`, `"In review"`, `"Todo"`, `"Cancelled"` y `"Done"`, pero no
  `"Backlog"` ni `"Blocked"`.
- **Capturas:** `1440-menu-estado-es.png`, `1024-vista-tablero-es.png`.

### H-2 · El mismo estado tiene dos nombres distintos en español según la pantalla

**Severidad: se ve mal.**

| Estado | Menú de estado / tablero | Leyenda del Panel |
|---|---|---|
| `done` | **Listo** | **Terminada** |
| `blocked` | **Blocked** (sin traducir) | **Bloqueada** |

Son dos caminos de traducción distintos que no se pusieron de acuerdo:

- La capa literal traduce `"Done" → "Listo"`
  (`ui/src/i18n-es-ar/dictionary/es-AR/common.json`, línea 12) y no tiene
  `"Blocked"`.
- La capa explícita traduce `issues.status.done → "Terminada"` y
  `issues.status.blocked → "Bloqueada"`
  (`ui/src/i18n-es-ar/dictionary/es-AR/explicit.json`).

El escape `tEs()` de `ui/src/components/IssuesList.tsx` (líneas 141–142) usa la
capa explícita, pero el menú de estado y los encabezados del tablero no pasan
por ese mapa: les llega la cadena cruda y la resuelve la capa literal. Resultado:
dos nombres para el mismo estado, visibles en dos pantallas de la misma app.

- **Qué ajustar:** elegir un término por estado y dejar las dos capas iguales.
  Es decisión de UX/UI, no mía; mi observación es que `Terminada` / `Bloqueada`
  concuerdan con el género de "tarea", que es lo que ya usan
  `navigation.taskViews.*` (`Terminadas`, `Bloqueadas`) y las prioridades
  (`Crítica`, `Alta`, `Media`, `Baja`).
- **Capturas:** `1440-menu-estado-es.png` (dice *Listo*, *Blocked*) contra
  `1024_dashboard-es.png` (dice *Terminada*, *Bloqueada*).

### H-3 · Cobertura: 79 cadenas de interfaz sin traducir en las 7 pantallas

**Severidad: cosmético** (y es información para el Lead, no un pedido de arreglo).

Sale gratis del mismo par de cargas: una cadena que aparece **idéntica** en
es-AR y en inglés, y que no es un dato de la fixture, es interfaz que el corte 1
no cubre.

| Pantalla | Cadenas sin traducir |
|---|---:|
| Perfil / Configuración | 27 |
| Búsqueda | 24 |
| Panel | 21 |
| Decisiones | 14 |
| Bandeja | 8 |
| Aprobaciones | 8 |
| Tareas | 6 |

El Panel es el caso más visible porque queda **mezclado**: la barra lateral y la
leyenda del gráfico en español, y las tarjetas de métricas enteras en inglés
(*Agents Enabled*, *Tasks In Progress*, *Month Spend*, *Pending Approvals*,
*Run Activity*, *Tasks by Status*, *Success Rate*, *Last 14 days*,
*Recent Tasks*). Ver `1024_dashboard-es.png`.

Otras que se ven seguido: *Today* y *51m ago* en todas las listas de tareas,
*Switch to dark mode* en el menú de cuenta, *Describe a task…* en el diálogo de
tarea nueva, *Command Palette* / *Search for a command to run…* en el paleta, y
casi toda la pantalla de Perfil, que es justamente donde vive el selector de
idioma.

El detalle completo, pantalla por pantalla, quedó en
`ui/qa-cha9/shots/coverage.json` del worktree (archivo temporal, sin commitear).

**Esto no es la decisión de alcance escalada al dueño** (el overlay dando vuelta
texto escrito por personas); es cobertura del diccionario, que es otra cosa.
Lo dejo como observación para que el Lead decida si abre una tanda 2.

---

## 4. Los 6 puntos de verificación funcional

**6 de 6 pasan.** Todos medidos en el navegador, sobre el build es-AR.

| # | Qué se verificó | Resultado | Evidencia |
|---|---|---|---|
| F1 | El selector aparece en el perfil | **Pasa** | La sección existe, titulada *Idioma*, con las dos opciones (*English* y *Español (Argentina)*), y arranca con es-AR tildado. `F1-selector-en-perfil.png` |
| F2 | El selector cambia el idioma | **Pasa** | Tablero antes: es-AR, sin nada guardado. Se elige *English* en el perfil → `localStorage["paperclip.lang"] = "en"` → tablero después: inglés. `F2-despues-de-elegir-english.png` |
| F3 | Persiste al recargar | **Pasa** | Recargando y navegando a otra pantalla sigue en inglés, con `localStorage` en `"en"`. `F3-persiste-al-recargar.png` |
| F4 | Arranca en español con el navegador en español | **Pasa** | `navigator.languages = ["es-AR"]`, `localStorage` vacío, sin `?lang` → interfaz en es-AR (*Nueva tarea*, *Panel*, *Bandeja*, *Tareas*, *Buscar*). `F4-navegador-en-espanol.png` |
| F5 | `?lang=en` vuelve a inglés | **Pasa** | Con el navegador en es-AR, `?lang=en` fuerza inglés (*New Task*, *Dashboard*, *Inbox*, *Tasks*, *Search*). `F5-lang-en-por-url.png` |
| F6 | `localStorage["paperclip.lang"]="en"` vuelve a inglés | **Pasa** | Sin `?lang`, con el navegador en es-AR y la clave preseteada → inglés. `F6-localstorage-en.png` |

Nota sobre F2: el selector recarga la página a propósito (el overlay traduce en
la frontera de JSX y memoiza, así que el idioma se fija al cargar). La recarga
se vio funcionar; no hay estado a medio traducir.

---

## 5. Punto 1 de la lista anterior, ahora en pantalla

**Confirmado. No contradice la medición de código, así que no hay bloqueante.**

Con el navegador pidiendo español (`navigator.languages = ["es-AR"]`), el build
de upstream (`vite.config.ts`, sin el plugin del overlay) sale **100 % en
inglés**: *New Task*, *Search*, *Dashboard*, *Inbox*, *WORK*, *Tasks*,
*Projects*, *Routines*, *Artifacts*, *ORG*, *Agents*, *Skills*, *Connectors*,
*Audit*. Ver `P3-upstream-tablero-navegador-es.png`, que es la misma pantalla y
los mismos datos que `1440_issues-es.png`, lado a lado.

Además, y es la otra mitad del interruptor del ADR §10: en ese build el
**selector de idioma no se renderiza** en el perfil
(`P3-upstream-perfil-sin-selector.png`). Es lo correcto —ofrecer un control
muerto sería peor—, y confirma que `isOverlayInstalled()` está apagado ahí.

Se buscaron fugas del diccionario en esa pantalla (*Nueva tarea*, *Bandeja*,
*Panel*, *En curso*, *Idioma*, *Tareas*, *Buscar*, *Perfil*, *Terminada*):
**ninguna**.

---

## 6. Lo que esta pasada no cubrió

Honestidad sobre los bordes:

- **`/agents` y `/projects` no se pudieron rendir.** No es un defecto del
  producto: el arnés sirve los builds estáticos con un `/api` simulado, y a esas
  dos pantallas les falta fidelidad en la fixture (`/agents` revienta pidiendo
  una forma de `instance/settings` que no repliqué del todo; `/projects` pide un
  mapa indexado por id de proyecto). Las superficies que la tarea nombraba
  —encabezados y celdas de columnas— quedaron cubiertas igual por la vista de
  tablero, la lista de tareas, la bandeja y la búsqueda.
- **Un solo tema.** Se midió en modo claro, que es el que levantó el arnés. El
  largo del texto no depende del tema, así que el resultado de desbordes vale
  para los dos; lo que no se miró es contraste ni color.
- **Mobile.** La tarea pedía escritorio normal y angosto; eso se hizo. No se
  midió debajo de 1024 px.

---

## 7. Hallazgo de entorno (no es del producto)

La receta del Lead funciona, pero **le falta una pieza**, y sin ella el
navegador arranca y se muere a los dos segundos:

El contenedor no tiene **ninguna fuente del sistema ni configuración de
fontconfig**. Apenas una página pide una fuente de respaldo, Skia aborta el
proceso entero:

```
Fontconfig error: Cannot load default config file: File not found
[FATAL:third_party/skia/src/ports/SkFontMgr_FontConfigInterface.cpp:163] Not implemented.
<process did exit: exitCode=null, signal=SIGTRAP>
```

Se presenta como `Target page, context or browser has been closed`, que no dice
nada, y antes de eso produce capturas que se ven bien pero **sin una sola letra
renderizada** — que es la peor forma de fallar para una tarea de QA visual.

**Cómo se resolvió:** alcanza con darle a fontconfig un archivo de
configuración y al menos una fuente. Queda en
`ui/qa-cha9/fontconfig/` del worktree y se activa con:

```
export FONTCONFIG_FILE=<worktree>/ui/qa-cha9/fontconfig/fonts.conf
```

Importante para la validez de lo medido acá: **las medidas de ancho de texto son
las de la fuente real del producto**. La app sirve Inter por `@font-face` en
`/fonts/InterVariable.woff2` y Chromium decodifica woff2 por su cuenta, sin
pasar por fontconfig. El respaldo del sistema sólo existe para que el gestor de
fuentes pueda inicializarse.

**Sugerencia para el Lead:** agregar las tres líneas a la receta junto a
`PLAYWRIGHT_BROWSERS_PATH` y `LD_LIBRARY_PATH`, o instalar fontconfig y una
familia base en la imagen. Si no, el próximo que haga QA visual va a perder el
mismo rato persiguiendo un `SIGTRAP` sin mensaje.

---

## 8. Arnés usado (temporal, sin commitear)

Todo en `ui/qa-cha9/` del worktree, más `ui/dist-qa-es` y `ui/dist-qa-en`:

| Archivo | Para qué |
|---|---|
| `mock-api.mjs` | `/api` simulado, sólo lectura (405 a todo lo que no sea GET) |
| `serve.mjs` | sirve los dos builds (5373 es-AR, 5274 upstream) |
| `app-overflow.mjs` | barrido de desbordes, 7 pantallas × 2 anchos × 2 idiomas |
| `interactive.mjs` | lo mismo para los 8 estados que hay que abrir con el mouse |
| `headroom.mjs` | margen que queda antes de que el texto se corte, por superficie |
| `functional.mjs` | los 6 puntos funcionales + el punto 1 de la lista anterior |
| `coverage.mjs` | cadenas de interfaz que quedaron sin traducir |
| `fontconfig/` | el arreglo de fuentes de la sección 7 |

No se commiteó nada de esto ni se tocó `pnpm-lock.yaml`, como pedía la tarea.
