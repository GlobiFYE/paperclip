# ADR 0003 — La capa es-AR no entra al build de upstream

- **Estado:** Aceptado
- **Fecha:** 2026-10-17
- **Decide:** Arquitecto (Chanchu Labs)
- **Ejecuta:** Dev UX/UI
- **Alcance:** rama `es-ar/corte2`, sobre `46f07a032`
- **Complementa:** [ADR 0001](0001-traduccion-es-ar-por-overlay-en-jsx.md) §5d.1
  («un árbol de fuentes, dos salidas») y
  [ADR 0002](0002-marcado-del-texto-de-interfaz-en-compilacion.md) §9. **No
  cambia nada de la semántica de traducción**: ni el diccionario, ni `lookup`,
  ni el marcado, ni la invariante del dato de ADR 0002 §4. Es una decisión de
  empaquetado.
- **Tarea:** CHA-37. Hallazgo **H-1** de [CHA-28](../i18n-es-ar/CHA-28-validacion-corte2.md) (QA).

## 0. La respuesta, sin adornos

Las tres preguntas de CHA-37, contestadas antes del detalle.

1. **Sí se puede, y no hace falta `import()` dinámico.** La causa de H-1 no es
   cuándo se carga el diccionario: es **qué módulo lo puede alcanzar**. Hoy el
   diccionario y `tEs()` viven en el mismo archivo, así que 12 archivos de
   upstream que sólo quieren `tEs()` se traen las 3.882 entradas. Partiendo
   `overlay.ts` en tres módulos, el build de upstream deja de tener una sola
   arista hacia el diccionario y **no lo incluye**. `lookup()` **sigue
   sincrónico** y **ningún sitio de llamada cambia**. Medido, no supuesto (§4).
2. **Cuesta cero archivos nuevos de upstream.** Los mismos 12 que ya están
   tocados, las mismas líneas: 11 cambian el destino de un `import` que ya
   existe (`@/i18n-es-ar/overlay` → `@/i18n-es-ar/explicit`). El presupuesto de
   ADR 0001 §7.5 queda **igual**: gastadas 36, quedan 14.
3. **Hacerlo, y ahora.** Es medio día de Dev UX/UI, entero dentro de nuestro
   directorio, y se verifica con un `grep` sobre el build. Pero **no por los
   86 KB**: lo que se compra es que «un árbol de fuentes, dos salidas» pase de
   ser una afirmación a ser una propiedad del grafo de módulos, con un chequeo
   de una línea que no puede pasar por casualidad (§8).

Y la que el enunciado pedía al revés, que es la que hay que decir fuerte:
**no, esto no hace que sobren las 36 llamadas a `tEs()`, y la limpieza de
ADR 0002 §9 no resuelve H-1.** Son dos cosas independientes. El corte de
módulo resuelve H-1 solo y es la única de las dos que lo resuelve; la limpieza
de §9 sigue valiendo la pena por el presupuesto de conflictos, que es otro
problema (§7).

## 1. El hallazgo, y cuánto creció mientras se escribía este ADR

QA lo midió sobre el build de `500bd7604` (`ui/dist`, 21:13Z): las traducciones
viajan **también** en el bundle de upstream, en un chunk de 268 KiB
(`BreadcrumbContext-*.js`) que `ui/index.html` **precarga con
`modulepreload`**. No es una fuga —con la bandera compilada en `false` nada de
eso se puede renderizar, CHA-28 §2.4— es peso muerto que paga quien lee en
inglés.

Lo verifiqué otra vez, por mi cuenta, y agrego el dato que importa para decidir:

| | en `500bd7604` (lo que midió QA) | en `46f07a032` (hoy) |
| --- | ---: | ---: |
| entradas del diccionario | 1.986 | **3.882** |
| diccionario serializado | 137.364 B (134 KiB) | **266.325 B (260 KiB)** |
| …comprimido (gzip -9) | 45.298 B | **85.719 B** |

En las dos horas de trabajo que separan esos dos commits el peso muerto se
multiplicó por **1,94**. Faltan ~2.060 cadenas del alcance del corte 2, así que
va a volver a casi duplicarse. Es el único argumento de urgencia que tiene este
ADR, y es débil a propósito: el arreglo **no se encarece** con el diccionario
(§8).

## 2. La causa: trece aristas de `import`

Enumeradas, no estimadas. Son todos los `import` de `@/i18n-es-ar/*` que hay en
`ui/src` fuera de nuestro directorio:

| Arista | Cuántas | Qué pide |
| --- | ---: | --- |
| `import { tEs } from "@/i18n-es-ar/overlay"` en 11 archivos de upstream (36 llamadas, CHA-15/CHA-23) | 12 | `tEs()` |
| `import { LanguageSelector } from "@/i18n-es-ar/LanguageSelector"` en `ProfileSettings.tsx`, y de ahí `activeUiLocale()` + `isOverlayInstalled()` | 1 | la bandera y el idioma |

Ninguna de las trece pide el diccionario. Se lo llevan igual, porque
`overlay.ts` es **un solo módulo** y en el cuerpo del módulo construye las dos
capas con los 21 archivos de `dictionary/`.

Y la arista que sí necesita el diccionario —el `import` que ADR 0002 inyecta en
los 737 archivos marcados— **no existe en el build de upstream**: la pone el
`transform` del plugin, y el plugin se activa sólo desde
`ui/vite.config.es-ar.ts`. Es exactamente lo que hace que este arreglo sea
posible y barato: en el build por defecto, nadie tiene por qué poder ver el
diccionario.

## 3. Por qué el sacudido de árbol no lo arregla

La reacción razonable es «si nadie importa `lookup`, el bundler lo tira». No lo
tira, y conviene saber por qué antes de proponer nada:

```ts
const LAYERS = { "es-AR": layer([...19 archivos...], ...), es: layer([...]) };
```

Eso es una **llamada en el cuerpo del módulo**. Rolldown no puede probar que
`layer()` —que hace `Object.entries` y `new Map`— no tenga efectos, así que
conserva el inicializador, y con él los 21 JSON. Alcanza con que **un** archivo
importe **cualquier** cosa de `overlay.ts` para que el módulo entre al grafo y
su cuerpo se evalúe. Verificado en §4, caso A: con `lookup` y `translate`
inalcanzables, el diccionario queda igual en el bundle.

Entonces la pregunta correcta no es *cuándo cargamos el diccionario* sino
**quién lo puede alcanzar**. Es un problema de frontera de módulo, no de
estrategia de carga. Todo lo que sigue sale de ahí.

## 4. Qué se verificó

Todo el 2026-10-17, sobre el worktree `/paperclip/workspaces/es-ar-corte2` en
`46f07a032`. Las pruebas se escribieron **fuera del repo**
(`$PAPERCLIP_SCRATCH_DIR/h1`) y el árbol quedó intacto: la implementación es de
Dev UX/UI.

**4.1 — El hallazgo, confirmado aparte de QA.** De los valores únicos de más de
20 caracteres del diccionario de `500bd7604` (1.084), están **1.084 de 1.084**
dentro de `ui/dist/assets/BreadcrumbContext-DZWt7WIy.js`, que es un chunk
precargado del build de upstream. No es una muestra: es el diccionario entero.

**4.2 — Las cuatro formas, construidas con el Vite del repo.** Mismo
`ui/node_modules/.bin/vite` (8.2.2 / Rolldown), mismo diccionario es-AR de hoy
(266 KB), misma bandera. La columna de la izquierda es el build de upstream
(bandera `false`, sin el `import` que inyecta el marcado); la de la derecha, el
build es-AR (bandera `true`, con un archivo marcado que importa `translate`):

| Caso | Forma | Build de upstream | Build es-AR |
| --- | --- | ---: | --- |
| **A** | como hoy: diccionario y `tEs()` en un módulo | **270.069 B, con español** | igual |
| **B** | **corte de módulo** (la decisión) | **741 B, sin una palabra en español** | 270.254 B, **un solo chunk, sincrónico** |
| **C** | `import()` dinámico detrás de la bandera | 771 B, sin español | **dos chunks**: el diccionario aparte (269.330 B), un viaje más antes del primer pintado, y `lookup` pasa a asincrónico |
| **D** | `await` de nivel superior en `overlay.ts` | 769 B, sin español | **dos chunks**; `lookup` sigue sincrónico, pero el grafo entero queda asincrónico |

El caso A reproduce la realidad medida en 4.1, así que la medición de B, C y D
es comparable: las tres sacan el diccionario del build de upstream. **Lo que las
separa es lo que le hacen al build es-AR**, que es el que el dueño usa.

**4.3 — El build es-AR ya tiene el diccionario en su propio chunk.** En
`ui/dist-es-ar` el diccionario está en `overlay-GBfMcSG2.js` (197 KB,
precargado) y `BreadcrumbContext-*.js` bajó a 128 KB; en `ui/dist` los dos
están fundidos en 271 KB. O sea que para el build es-AR **el corte de módulo no
cambia el reparto de chunks**: `overlay.ts` ya es un chunk propio porque lo
importan los 737 archivos marcados. El caso B no le cuesta nada al lado que
importa.

**4.4 — El residuo, medido.** Después del corte queda en el build de upstream
`dictionary/*/explicit.json`: **18 entradas, 650 B**, porque `tEs()` los
necesita y `active()` no es constante de build (tiene el `installed` de los
tests). Se van solos el día que se haga la limpieza de ADR 0002 §9. Es el 0,2 %
de lo que viaja hoy, y no cambia la decisión; cambia qué cadena usa QA como
canario (§10).

## 5. Opciones evaluadas

### (a) `import()` dinámico detrás de la bandera

Es lo que pedía el enunciado y **funciona para H-1** (§4.2, caso C). Se rechaza
por lo que cuesta del otro lado:

- **Rompe la sincronía donde más duele.** El diccionario pasa a llegar en una
  promesa, y los dos consumidores que tenemos corren antes de que se resuelva:
  los sitios marcados corren **en render**, y los 36 `tEs()` de los mapas de
  etiquetas de upstream corren **en el cuerpo del módulo**, al importarse. Para
  que no salga media interfaz en inglés hay que esperar el diccionario antes del
  primer render, o sea un `await` en `ui/src/main.tsx` —**archivo de upstream**,
  que es justo lo que no gastamos.
- **No compra nada en el build que importa.** El dueño va a construir en es-AR,
  y ahí el diccionario no es contenido opcional: es el idioma de la interfaz, se
  necesita en la primera pintada. Diferirlo sólo agrega un viaje de red (§4.2).

### (b) `await` de nivel superior en `overlay.ts`

Resuelve la objeción de sincronía de (a) —`lookup()` se queda sincrónico porque
los 737 módulos marcados esperan a `overlay.ts` por transitividad— y no toca
`main.tsx`. **Rechazada igual**: vuelve asincrónico el grafo entero de la
interfaz en el build es-AR, cambia el formato de los chunks, y sigue pagando el
viaje extra de (a) sin ninguna ganancia. Es mucho mecanismo nuevo (criterio 3
de ADR 0001 §3) para un problema que no es de carga.

### (c) La limpieza de ADR 0002 §9, sola

Revertir las 36 llamadas a `tEs()` y cubrir esos mapas por `TEXT_DECLS`.
**No resuelve H-1.** Quedaría en pie la decimotercera arista:
`ProfileSettings.tsx` → `LanguageSelector` → `overlay.ts`, y con ella las
266 KB enteras. Es la respuesta a la pregunta 2 del enunciado y es la contraria
a la esperada: la limpieza es necesaria para otra cosa (el presupuesto de
conflictos) y **no es suficiente para ésta**. Se ejecuta aparte, con su propio
QA (§7).

### (d) Corte de módulo — **elegida**

Partir `overlay.ts` en tres, por lo que cada consumidor necesita de verdad:

```
              upstream (12 archivos)              los 737 archivos marcados
                      │                                      │
          ┌───────────┴────────────┐                         │
          ▼                        ▼                         ▼
  LanguageSelector.tsx       explicit.ts  ───────►   overlay.ts
          │                   (tEs, 650 B)        (lookup/translate/formatted,
          └──────────┬────────────┘                 los 21 archivos de área)
                     ▼                                       │
             active-locale.ts  ◄─────────────────────────────┘
          (la bandera, el idioma activo)
```

Lo que el build de upstream puede alcanzar queda **arriba y a la izquierda** de
la línea: la bandera, el idioma y 18 claves punteadas. El diccionario cuelga de
`overlay.ts`, y a `overlay.ts` sólo llega el `import` que el marcado inyecta, que
en el build de upstream no existe (§2).

Tres propiedades que la hacen ganar:

1. **Cero async.** `lookup()`, `translate()`, `formatted()` y `tEs()` siguen
   siendo funciones sincrónicas con la misma firma. Ningún sitio de llamada
   cambia, ni los 19.547 marcados ni los 36 de upstream.
2. **La garantía pasa a ser estructural.** Hoy «el build de upstream no traduce»
   es cierto por un booleano compilado; después es cierto porque **el
   diccionario no está en el grafo**. Es el criterio 4 de ADR 0002 §3 aplicado
   al empaquetado, y se chequea con un `grep` (§10).
3. **Es nuestro directorio.** Cero archivos nuevos de upstream (§7).

### (e) No hacer nada

Hay que decirlo porque es una opción real: el dueño construye en es-AR, así que
probablemente nunca pague estos bytes. Se rechaza por una razón y no por el
tamaño: mientras la capa esté en el grafo del build por defecto, la afirmación
que sostiene todo el fork —«un árbol de fuentes, dos salidas», ADR 0001 §5d.1—
es **falsa en los hechos**, y lo único que separa «peso muerto» de «fuga» es un
booleano. Con el corte, las separa el grafo de módulos.

## 6. El diseño

Tres archivos nuestros, ninguno de upstream nuevo. Nombres y contenidos, para
que no haya que elegir nada al implementar.

### 6.1 `ui/src/i18n-es-ar/active-locale.ts` (nuevo)

Se le muda, **tal cual, sin cambiarles una línea de lógica**, lo que hoy está en
`overlay.ts` entre la bandera y `markOverlayInstalled()`: `OVERLAY_IN_BUNDLE`
con su marca de comentario, `installed`, `cached`, `OFF`, `active()`,
`activeUiLocale()`, `markOverlayInstalled()`, `isOverlayInstalled()`. Importa
**sólo** `./language`. Exporta `active()` además de lo de hoy, que es lo que
antes era privado.

Es el único archivo con la marca `/* paperclip-es-ar:in-bundle */`, así que es
el que el plugin reescribe (§6.4).

### 6.2 `ui/src/i18n-es-ar/explicit.ts` (nuevo)

`tEs()` y nada más. Importa `./active-locale` y los dos `explicit.json`
(es-AR y es). **No importa `./overlay` ni ningún archivo de área**: eso es la
frontera, y es lo que hay que mirar en una revisión.

### 6.3 `ui/src/i18n-es-ar/overlay.ts` (cambia)

Pierde la bandera, `active()` y `tEs()`; importa `active` de
`./active-locale`. Todo lo demás queda **idéntico**: `LAYERS`, `layer()`,
`resolveInLayer`, `resolveInChain`, `lookup`, `translate`, `formatted`, el memo,
`clearOverlayMemo`, `layerEntries`.

> **La regla que no se puede romper:** `overlay.ts` **no re-exporta** nada de
> `active-locale.ts` ni de `explicit.ts`. Un `export { tEs } from "./explicit"`
> sería cómodo —no habría que tocar los 11 `import` de upstream— y anularía todo
> el ADR: quien importe `tEs` de `overlay.ts` se vuelve a traer el diccionario
> (§3). Si aparece ese re-export, el test de §6.5 falla.

**Convive con el mapa por sitio de CHA-38**, que está a medio implementar en
este worktree mientras se escribe esto (sin commitear, así que no está en los
números de §1 y §4). `por-sitio.ts` y su `dictionary/por-sitio/` cuelgan de
`overlay.ts`, o sea que quedan **del lado es-AR de la frontera** y el corte los
alcanza solo: no hay nada que coordinar, y el paso 3 de §9 se hace sobre
`overlay.ts` como esté. Si CHA-38 termina reemplazando las 36 llamadas a
`tEs()`, pasa lo de §7: `explicit.ts` se queda sin consumidores de upstream y el
build por defecto baja a cero bytes en español.

### 6.4 `ui/src/i18n-es-ar/vite-plugin.ts` (cambia, 2 líneas)

La constante `OVERLAY` pasa a apuntar a `active-locale.ts` y el mensaje del
`throw` con ella. El resto del plugin no cambia: `marks()` ya excluye todo
`i18n-es-ar/` salvo `LanguageSelector.tsx`, así que los dos archivos nuevos no
se marcan, que es lo correcto. El `throw` por marca faltante **se queda**: sin
él un build es-AR saldría en inglés sin avisar.

### 6.5 `ui/src/i18n-es-ar/bundle-boundary.test.ts` (nuevo)

El guardián de la frontera. Es un test de texto sobre el árbol de fuentes, no
necesita bundler, y es lo que hace que esto no se deshaga sin que nadie se
entere:

1. Ningún archivo de `ui/src` fuera de `i18n-es-ar/` importa
   `@/i18n-es-ar/overlay` ni nada de `i18n-es-ar/dictionary/`.
2. `active-locale.ts` importa sólo `./language`.
3. `explicit.ts` no importa `./overlay` ni ningún `dictionary/*/` que no sea
   `explicit.json`.
4. `LanguageSelector.tsx` no importa `./overlay`.
5. `overlay.ts` no tiene ningún `export … from`.

Si upstream o nosotros agregamos mañana un `tEs` apuntando a `overlay`, falla
acá y no seis semanas después en un informe de QA.

### 6.6 Los que cambian una línea de `import`

- **11 archivos de upstream**: `@/i18n-es-ar/overlay` → `@/i18n-es-ar/explicit`.
  `attention.ts`, `issue-filters.ts`, `task-views.ts`, `PriorityIcon.tsx`,
  `IssuesList.tsx`, `LegacyIssuesList.tsx`, `ActivityCharts.tsx`,
  `DecisionsToolbar.tsx`, `Sidebar.tsx`, `Sidebar.production.tsx`, `Agents.tsx`.
- **`LanguageSelector.tsx`**: `activeUiLocale`/`isOverlayInstalled` de
  `./active-locale`.
- **Nuestros tests**: `overlay.test.ts` toma `tEs` de `./explicit`;
  `real-components.es-ar.test.tsx` y `datos-del-dueno.es-ar.test.tsx` toman
  `isOverlayInstalled` de `./active-locale`; `overlay.dom.test.tsx` hace el
  `import("./active-locale")` dinámico para llamar a `markOverlayInstalled()`
  antes de importar `@/lib/task-views`. Ojo con éste: lo que el test necesita es
  que sea **la misma instancia de módulo** la que ve `installed`, y lo sigue
  siendo porque `explicit.ts` resuelve por `active()` de `active-locale.ts`. El
  orden de los `import` del test no cambia (CHA-29).

`ProfileSettings.tsx` **no se toca**.

## 7. Presupuesto de ediciones a upstream

**Cero archivos nuevos y cero líneas nuevas.** Los 11 archivos ya están tocados
desde CHA-15/CHA-23 y siguen con un `import` y sus `tEs()`: lo único que cambia
es el destino de ese `import`, que ya era nuestro y sigue siendo nuestro. La
cuenta de ADR 0002 §9 queda intacta:

| | Líneas de upstream |
| --- | ---: |
| Tope de ADR 0001 §7.5 | ~50 |
| Gastadas (corte 1) | 36 |
| **Gasta ADR 0003** | **0** |
| Recuperables con la limpieza de ADR 0002 §9 | −33 |

**Y la aclaración que el enunciado pedía al revés.** H-1 y las 36 llamadas no se
resuelven con un cambio, se resuelven con dos, y en este orden:

- **El corte de módulo (este ADR) resuelve H-1 solo.** Es necesario y
  suficiente.
- **La limpieza de §9 no resuelve H-1** (§5c) y H-1 no la necesita.
- Hacer las dos es estrictamente mejor: cuando las 36 llamadas se vayan,
  `explicit.ts` se queda sin consumidores de upstream y el build por defecto
  baja a **cero bytes en español** (§4.4). Pero la limpieza arrastra una
  decisión de traducción que no es de arquitectura —hoy el chip de estado y los
  seis botones *Done* de upstream comparten la entrada literal, y con
  `TEXT_DECLS` pasan a ser dos sitios distintos (ADR 0002 §10.5)— y pide el QA
  de T2/T3. Por eso queda en su tarea.

Si hubiera que elegir **una sola**, es ésta: es más barata, no toca ninguna
traducción y cubre el 99,8 % de los bytes.

## 8. ¿Vale la pena?

**Sí, y ahora.** Pero conviene ser honesto con los dos lados de la cuenta.

**Lo que cuesta:** tres archivos nuestros, dos líneas del plugin, 15 líneas de
`import` repartidas y un test. Medio día de Dev UX/UI, sin trabajo de
diccionario, sin tocar una traducción, sin riesgo para la invariante de ADR 0002
§4 (nada de esto cambia **qué** se marca ni **qué** se traduce).

**Lo que compra:** que el build por defecto deje de cargar 260 KiB / 86 KiB
comprimidos en un chunk precargado. Y una cosa que vale más: el chequeo de
regresión pasa de «confirmar que la bandera compiló en `false` y que no hay
marcas `__tEs`» a `grep -r "copiá tu texto antes de salir" ui/dist` → sin
resultados. Un chequeo de una línea, imposible de pasar por casualidad.

**Lo que no es:** no es urgente y no es un defecto de corrección. Nadie ve nada
mal hoy; el dueño probablemente no pague nunca estos bytes porque va a
construir en es-AR. Si hay que elegir entre esto y más diccionario, **gana el
diccionario**: el arreglo es una frontera de módulo y no se encarece con las
entradas que se agreguen mientras espera. Lo único que empeora con el tiempo es
el número del informe de QA.

La razón por la que igual recomiendo hacerlo ya es la de §5e: hasta que esto
esté, «un árbol de fuentes, dos salidas» es una intención y no un hecho, y lo
único que separa peso muerto de fuga es un booleano. Es barato comprar la
diferencia ahora, con el diccionario a mitad de camino, y no cuando haya 6.000
entradas y 12 lotes más de los que desconfiar.

## 9. Instrucciones de implementación

Para Dev UX/UI. En este orden; cada paso deja el árbol compilando.

1. **Crear `active-locale.ts`** con el bloque mudado de `overlay.ts` (§6.1).
   Mover, no reescribir: si una línea cambia de lógica, cambió el idioma
   efectivo y eso no es parte de esta tarea.
2. **Crear `explicit.ts`** con `tEs()` y los dos `explicit.json` (§6.2).
3. **Podar `overlay.ts`** y apuntarlo a `./active-locale` (§6.3). Sin
   re-exports.
4. **Apuntar el plugin** a `active-locale.ts` (§6.4).
5. **Repuntar los 15 `import`** de §6.6.
6. **Escribir `bundle-boundary.test.ts`** (§6.5).

### Verificación antes de entregar

```sh
cd /paperclip/workspaces/es-ar-corte2/ui
./node_modules/.bin/vitest run src/i18n-es-ar src/i18n/locale-validation.test.ts
./node_modules/.bin/vitest run --config vitest.config.es-ar.ts
./node_modules/.bin/tsc --noEmit -p tsconfig.json

# el chequeo de este ADR: el build por defecto, sin una palabra del diccionario
./node_modules/.bin/vite build
grep -rl "copiá tu texto antes de salir" dist/ ; echo "esperado: sin resultados"

# y el build es-AR, que tiene que seguir traduciendo igual
./node_modules/.bin/vite build --config vite.config.es-ar.ts --outDir dist-es-ar
grep -rl "copiá tu texto antes de salir" dist-es-ar/ ; echo "esperado: un chunk"
```

La receta de entorno para que los dos builds corran en este worktree está en
[CHA-35](../i18n-es-ar/CHA-35-build-en-el-worktree.md). La primera corrida de la
config es-AR puede dar timeout por caché fría del transform: hay que repetirla
antes de reportar una falla.

## 10. Cómo lo verifica QA

Es un hallazgo de empaquetado, así que la verificación es sobre los artefactos
emitidos, no sobre pantallas. Cuatro puntos y un canario.

**El canario** es una cadena del diccionario **de un archivo de área**, larga y
sin ambigüedad: `"El almacenamiento del navegador no está disponible; copiá tu
texto antes de salir."` (`common.json`). No sirve una de `explicit.json`: esas
18 se quedan hasta la limpieza de §9 (§4.4).

| # | Chequeo | Qué tiene que pasar |
| --- | --- | --- |
| B1 | el canario en `ui/dist/**` (build por defecto) | **sin resultados** |
| B2 | el canario en `ui/dist-es-ar/**` | presente, en un chunk |
| B3 | tamaño del chunk precargado más grande de `ui/dist`, contra el de hoy | baja ~140 KiB con el diccionario de `500bd7604`, ~260 KiB con el de hoy |
| B4 | la pasada funcional de CHA-9 §5 sobre el build es-AR, y T1–T10 de ADR 0002 §11.2 | **sin un solo cambio**: esto no toca qué se traduce |

Si B1 da resultados, el arreglo no está hecho o alguien agregó una arista nueva
—y en ese caso el test de §6.5 tendría que haber fallado antes, así que
reportar los dos.

Lo que **no** hay que volver a medir: la invariante del dato (ADR 0002 §11.1,
D1–D6) y la cobertura del diccionario. Este ADR no las puede mover; si se
movieron, es un bug de la implementación y no un cambio de diseño.

## 11. Riesgos y límites

| Riesgo | Mitigación |
| --- | --- |
| Alguien vuelve a importar `overlay` desde upstream, o agrega un re-export «por comodidad» | El test de §6.5 falla en el acto. Es la única razón por la que ese test existe |
| Mudar `active()` cambia sin querer el idioma efectivo | Es una mudanza literal (§9/1) y la cubren `overlay.dom.test.tsx` y los F1–F6 de CHA-9 §5, que no cambian |
| El plugin busca la marca de la bandera en el archivo viejo | El `throw` por marca faltante ya existe y es ruidoso: un build es-AR fallado, no un build en inglés silencioso |
| Rolldown funde `active-locale.ts` en un chunk raro y la bandera queda duplicada | ESM garantiza una instancia por módulo; y es lo que ya pasa hoy con `overlay.ts`, que es un chunk propio (§4.3) |
| Quedan 650 B de `explicit.json` en el build de upstream | Medido y aceptado (§4.4). Se van con la limpieza de ADR 0002 §9, y hasta entonces el canario de QA no es una de esas 18 cadenas |
| El día que upstream mueva `ProfileSettings.tsx` o renombre algo | Igual que hoy: conflicto en los 12 archivos que ya están tocados. Este ADR no agrega ni saca ninguno |

**Cuándo volver a este ADR:**

- si alguna vez hace falta **un solo bundle con dos idiomas** (que hoy no hace
  falta: el fork construye dos veces). Ahí sí la respuesta es `import()`
  dinámico, y el caso C de §4.2 es la medición de cuánto cuesta;
- si el diccionario crece tanto que el **build es-AR** necesite partirlo por
  pantalla. Es otro problema —carga diferida de verdad, con el idioma puesto— y
  no lo resuelve esta decisión;
- si upstream empieza a importar algo nuestro, que sería la señal de que la
  frontera dejó de tener sentido.

## 12. Lo que no se toca nunca

§11 de ADR 0001 y §13 de ADR 0002 siguen vigentes, enteros. Este ADR no pide
ninguna excepción y agrega una línea propia:

- **`ui/src/i18n/`, `ui/vite.config.ts`, `ui/vitest.config.ts`,
  `ui/package.json`, los 684 tests de upstream**: igual que siempre.
- **`ui/src/main.tsx` y `ui/index.html`**: son el único camino por el que un
  `import()` dinámico podría haber entrado (§5a) y están fuera de alcance. Si la
  implementación parece pedir una edición ahí, no se edita: es que se eligió la
  opción que este ADR rechazó.
