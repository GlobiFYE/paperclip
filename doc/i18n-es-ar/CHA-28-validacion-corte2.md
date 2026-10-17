# CHA-28 — validación del corte 2 sobre la línea de entrega

Bitácora de QA de la validación del lote compartido (CHA-27) sobre
`es-ar/corte2`, worktree `/paperclip/workspaces/es-ar-corte2`, con el blindaje
de ADR 0002 (CHA-23) puesto.

La validación de fondo —que el contenido del dueño sobreviva intacto con el
diccionario completo encima— **espera a que CHA-27 entregue los dos tramos**.
Al 2026-10-17 19:55Z están las 494 largas (`2a67b2f44`) y 3 de los 4 lotes de
cortas (`8776ffccd`).

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
