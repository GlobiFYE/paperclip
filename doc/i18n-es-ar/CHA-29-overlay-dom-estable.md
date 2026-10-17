# CHA-29 — que `overlay.dom.test.tsx` no mienta en rojo

Bitácora del arreglo de la fragilidad que midió QA en
[CHA-28 §1](CHA-28-validacion-corte2.md). Branch `es-ar/corte2`, worktree
`/paperclip/workspaces/es-ar-corte2`, sobre `e684468b7`. Medido el 2026-10-17
entre las 20:35Z y las 21:05Z, 8 núcleos.

El diagnóstico no se rehízo: está en CHA-28 §1, con números, y se confirmó
reproduciéndolo tal cual antes de tocar nada.

**Resultado: el rojo mentiroso no vuelve a aparecer bajo carga, y el archivo
pasó de 21,5 s a 4,4 s de tests.** Queda un hallazgo que no es de este archivo
(H-1, abajo) y dos números de la tarjeta que había que corregir contra el
HEAD de hoy (§4).

## 1. Lo que estaba roto, reproducido antes de tocar

Con 12 bucles de CPU al lado, `pnpm exec vitest run src/i18n-es-ar` sobre el
árbol sin modificar:

```
5 failed | 94 passed | 19 skipped
  4 × "Test timed out in 5000ms"
  1 × AssertionError: en-US: expected 'es-AR' to be 'en'
```

Idéntico a lo que reportó QA. La última es la que hace daño: señala al
diccionario cuando la causa es el reloj.

Con la máquina ociosa, `--reporter=verbose` sobre el archivo solo: 20/20, caso
más lento **3.217 ms** contra un `testTimeout` de 5.000 ms (QA había medido
4.104 ms en una máquina más ocupada; el cuadro es el mismo: 64–82 % del
presupuesto gastado sin que pase nada raro).

## 2. El arreglo: tres piezas, todas en `overlay.dom.test.tsx`

Un solo archivo tocado. Cero archivos de upstream, cero movimientos en
`pnpm-lock.yaml`.

### 2.1 El presupuesto de tiempo (la salida barata de QA)

`vi.setConfig({ testTimeout, hookTimeout })` a 20.000 ms. Con el caso más lento
en 2,8 s, el margen real es de ~7×.

El valor sale de `ES_AR_TEST_TIMEOUT` si está puesta, y eso **no** es un
adorno: como el `setConfig` del archivo le gana al `--testTimeout` de la línea
de comandos, era la única forma de volver a correr la prueba de abortar casos a
propósito. Se usa en 2.4.

### 2.2 La recarga, atada al caso que la pidió (la salida de fondo)

Es la pieza que mata el rojo mentiroso. El mecanismo de la falla, que es lo que
había que cortar:

1. un caso se aborta por tiempo;
2. Vitest lo da por terminado, **pero su continuación sigue viva**: el `for`
   que tenía adentro arranca otra vuelta;
3. esa vuelta llama a `reload()`, que resetea el registro de módulos y vuelve a
   espiar `navigator.languages` **encima del caso siguiente**, que ya los dejó
   armados;
4. el caso siguiente afirma sobre el estado de un caso muerto y falla por
   contenido.

Ahora cada caso se declara con `itWithReload(nombre, async (reload) => …)` y
recibe **su** `reload`, que cierra léxicamente sobre un `live` propio.
`afterEach` cierra el caso en cuanto termina —incluso si terminó por timeout— y
a partir de ahí esa recarga deja de escribir: se estaciona en una promesa que
no se resuelve nunca, y la continuación huérfana muere ahí sin tocar nada. El
chequeo está antes de la primera escritura y después de cada `await`.

El caso que se quedó sin tiempo falla por **timeout**, que es verdad y se
arregla con tiempo. Ninguno de sus vecinos se entera.

### 2.3 Los módulos de upstream, bajo pedido (de dónde salió la velocidad)

`reload()` importaba siempre `@/lib/task-views` y `@/lib/issue-filters`, los
miren o no. Los miran 4 de 20 casos. Medido: reevaluar `issue-filters` en frío
cuesta ~2,8 s y es **toda** la cuenta del caso más lento; el overlay solo son
~20 ms.

Ahora vienen como `taskViews()` / `issueFilters()` y los importa sólo el caso
que los mira. No se sacó ni se aflojó ninguna aserción: los cuatro casos que
los usan los siguen comparando igual, y siguen importándose después de
`markOverlayInstalled()`, que es el orden que el archivo necesita.

| | antes | después |
| --- | ---: | ---: |
| Caso más lento (ocioso) | 3.217 ms | **2.835 ms** |
| Tests del archivo (ocioso) | 21,48 s | **4,44 s** |
| Casos | 20 | 20 |

### 2.4 Cómo se comprueba que el rojo mentiroso no está

Dos pruebas, porque una sola no alcanza:

**Abortando casos a propósito, con la máquina libre.** `ES_AR_TEST_TIMEOUT=50`
aborta la mayoría de los casos:

| Presupuesto | Resultado |
| --- | --- |
| `ES_AR_TEST_TIMEOUT=50` | 12 y 14 fallan en dos corridas, **todas por timeout**; 0 por afirmación |
| `ES_AR_TEST_TIMEOUT=120` | 3 fallan, **las 3 por timeout** |
| `ES_AR_TEST_TIMEOUT=400` | 2 fallan, **las 2 por timeout** |

Ninguna falla de contenido y ningún error sin dueño. Honestidad sobre el
método: esta prueba **no** reproducía el bicho por sí sola —el archivo viejo
con `--testTimeout=50` también daba 19 timeouts y 0 afirmaciones—, así que
prueba que el arreglo no inventó rojos nuevos, no que el viejo se fue. Eso lo
prueba la otra.

**Con carga al lado**, que es la que reproducía la falla: 12 bucles de CPU,
tres corridas seguidas de `pnpm exec vitest run src/i18n-es-ar`:

| Corrida | `overlay.dom.test.tsx` | Afirmaciones falsas |
| --- | --- | ---: |
| 1 | **20/20** | 0 |
| 2 | **20/20** | 0 |
| 3 | **20/20** | 0 |

Antes: 4 de 20 fallaban y una mentía. Ahora el archivo entero aguanta la misma
carga que lo volteaba.

## 3. La verificación completa, con la invocación de cada número

Todo sobre `e684468b7` + este cambio, `ui/` como directorio de trabajo.

| Invocación | Resultado |
| --- | --- |
| `pnpm exec vitest run src/i18n-es-ar --no-file-parallelism --testTimeout=20000` | **99 pasan / 19 salteados**, 29,9 s (antes: lo mismo en 44,3 s) |
| `pnpm exec vitest run src/i18n-es-ar` (ocioso) | **99 pasan / 19 salteados**, 14,4 s |
| `pnpm exec vitest run src/i18n-es-ar` (12 bucles de carga) | 1 falla, **ninguna en este archivo** (ver H-1) |
| `pnpm exec vitest run --config vitest.config.es-ar.ts` | **20 pasan / 20** |
| `pnpm exec tsc --noEmit` | **777 errores**, la línea base exacta; **0** en `i18n-es-ar` |

Las dos configs, porque con la de upstream `real-components.es-ar.test.tsx` se
saltea a propósito y una sola config miente por omisión.

## 4. Dos números de la tarjeta que ya no son los de hoy

No es un desacuerdo con QA: las dos mediciones son de antes de que CHA-28
commiteara su propio archivo de tests (`datos-del-dueno.es-ar.test.tsx`, en
`e684468b7`), que agrega 8 casos y 6 salteados.

| Lo que pedía la tarjeta | Lo que da el HEAD de hoy, **sin** mi cambio | Por qué |
| --- | --- | --- |
| 97 pasan / 13 salteados | **99 pasan / 19 salteados** | +8 casos nuevos, +6 salteados de CHA-28 |
| 12/12 con `vitest.config.es-ar.ts` | **20/20** | 12 de `real-components` + 8 de CHA-28 |

Los dos números de la columna del medio los medí **antes** de tocar el archivo,
justamente para poder decir que el cambio no mueve la aguja: después del
cambio dan exactamente lo mismo. Coinciden con lo que QA anotó en
[CHA-28 §2.2](CHA-28-validacion-corte2.md).

## 5. Hallazgo

**H-1 · Queda un rojo bajo carga, y no es de este archivo ni es mentiroso.**
Con 12 bucles al lado, `vitest run src/i18n-es-ar` falla **una** vez, siempre
la misma y en el archivo de QA:

```
FAIL src/i18n-es-ar/datos-del-dueno.es-ar.test.tsx
  > ninguna de esas tres funciones puede devolver texto que escribió una persona
  Error: Test timed out in 5000ms.
```

Es un timeout honesto, no una afirmación falsa: el caso importa
`@/components/StatusIcon` y lo renderiza, que en frío y con la máquina cargada
no entra en 5 s (ocioso, con el grafo ya evaluado: 27 ms). Es la misma clase de
fragilidad que arregla esta tarea, en el archivo de al lado: el caso vecino del
mismo `describe` ya lleva un presupuesto propio de 180 s
(`datos-del-dueno.es-ar.test.tsx:355`) y este se quedó con los 5 s por defecto.

**No lo toqué a propósito.** Es el entregable de CHA-28 y la tarjeta me acota a
`overlay.dom.test.tsx`; además, bajo la invocación que QA mandó para el gate
(`--testTimeout=20000`) el caso pasa, así que el gate no está roto. El arreglo
es una línea —el mismo presupuesto explícito que el caso de al lado— y la
decisión de quién la escribe es del Lead.

**Lo que no apareció:** al acotar el estado por caso no salió ningún defecto
del diccionario ni del blindaje. Las 20 afirmaciones de contenido del archivo
pasan igual que antes, y `real-components.es-ar.test.tsx` —el control positivo
que sostiene la garantía del dueño— no se tocó.
