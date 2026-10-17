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
