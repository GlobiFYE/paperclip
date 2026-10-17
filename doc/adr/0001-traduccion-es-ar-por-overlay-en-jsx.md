# ADR 0001 — Traducción a es-AR por overlay en la frontera de JSX

- **Estado:** Aceptado
- **Fecha:** 2026-10-17
- **Decide:** Arquitecto (Chanchu Labs)
- **Ejecuta:** Dev UX/UI
- **Alcance:** fork `traduccion-es`, partido de `master` en `bba6a45f0`
- **Contexto previo:** documento *Relevamiento técnico — i18n de la interfaz* (CHA-2)

## 1. Contexto

Este repo es un **fork que sigue a upstream**. Cada archivo de upstream que
tocamos se paga en conflictos en cada `git pull`, para siempre. Ése es el
criterio que manda, y lo puso el dueño.

Lo que hay hoy en `ui/src/i18n/`: i18next cableado, 41 archivos en `locales/`
con **una sola pantalla** cada uno (3 cadenas), `lng` fijo en `"en"` y **ningún
selector de idioma**. De 700 `.tsx` de producción, solo `App.tsx` llama a
`useTranslation()`. La interfaz real tiene entre 8.000 y 15.000 cadenas.

## 2. Problema

`ui/src/i18n/locale-validation.ts` exige que cada archivo de idioma tenga
**exactamente** el mismo conjunto de claves que `en.json`, y
`ui/src/i18n/locales.ts` corre esa validación sobre los 41 locales al importar
el módulo, lanzando excepción si alguno falla. Entonces, agregar una clave a
`en.json` deja a los otros 40 locales incompletos y **la aplicación no arranca**
(no se degrada a inglés: tira error al cargar el módulo).

Con eso, agregar una cadena cuesta tocar 41 archivos a mano.

## 3. Criterio de decisión

En orden, tal como se fijó en CHA-3:

1. Cuántos archivos de upstream tocamos y qué tan probable es el conflicto en
   cada `git pull`.
2. Costo de agregar una cadena nueva en el día a día.
3. Que no quede un segundo mecanismo que haya que explicar.

## 4. El hallazgo que cambia la pregunta

Las tres opciones propuestas (rellenar locales / relajar la validación /
overlay de claves) discuten **2 archivos de upstream contra 0**. Pero las tres
dan por sentado el mismo plan de fondo: externalizar cada cadena, o sea
**editar los 700 `.tsx`** para reemplazar literales por `t("clave")`.

Esos 700 archivos son 291.527 líneas y son el 100% de la interfaz de upstream.
Además hay **684 archivos de test en `ui/src`** que afirman textos en inglés.

Medido contra el criterio 1, la cuenta real es:

| | Archivos de upstream que terminamos tocando |
| --- | --- |
| (a), (b), (c) tal como están planteadas | ~700 `.tsx` + 0 a 41 de i18n |
| Esta decisión | **0** |

Discutir si tocamos `locale-validation.ts` mientras editamos 700 componentes es
optimizar el 0,3% del problema. La pregunta correcta no es *cómo convivimos con
la validación*, es **cómo traducimos sin editar los componentes**. Si no
editamos los componentes, no agregamos claves a `locales/`, y entonces la
validación nunca entra en juego: el problema se disuelve en lugar de
resolverse.

## 5. Opciones evaluadas

### (a) Rellenar los 41 locales por script

Mantiene la validación intacta, pero escribe relleno inglés dentro de 40
archivos que **upstream mantiene y traduce**. Cada pasada nuestra toca 40
archivos que upstream también toca cada vez que externaliza una cadena:
conflicto casi garantizado en cada `pull`, y en archivos donde el merge es a
mano clave por clave. Además miente: deja `ja.json` diciendo que tiene japonés
cuando tiene inglés. **Rechazada** por criterio 1.

### (b) Relajar la validación

Es el cambio más chico y conceptualmente el más limpio: i18next ya cae a
inglés por clave faltante cuando hay `fallbackLng` (verificado, §6.1), así que
la validación estricta es más dura de lo necesario. Pero toca
`locale-validation.ts` **y su test**, que son justo los archivos que upstream
va a seguir editando, y no resuelve nada del costo real: igual hay que editar
los 700 componentes y agregar cada clave a `en.json`. **Rechazada** porque paga
conflicto sin comprar nada contra el criterio 2.

### (c) Overlay de claves fuera de `locales/`

Correcta en el fondo —sacar nuestras claves del alcance de
`assertValidLocaleMessages`— pero incompleta: sigue exigiendo editar los 700
`.tsx` para llamar a `t()`, y además **no funciona sobre la instancia de
i18next de upstream**. Verificado (§6.2): `supportedLngs` no incluye `es-AR`, y
`getFixedT("es-AR", "overlay")` devuelve la cadena en inglés. Para que (c)
funcione hay que tocar `ui/src/i18n/index.ts`. **Rechazada** como estaba
planteada; se adopta su idea central (nuestras claves fuera de `locales/`).

### (d) Overlay en la frontera de JSX — **elegida**

Interceptamos el runtime de JSX. Toda cadena que React esté a punto de
renderizar —como texto de un elemento o como atributo de texto— pasa por un
diccionario `inglés → es-AR` antes de llegar al DOM. La clave es **la cadena en
inglés**, no una clave punteada.

```
<h1>Create your first organization</h1>
        │
        ├─ el compilador de JSX emite:  jsx("h1", { children: "Create your first organization" })
        │
        └─ nuestro shim:  diccionario.get(children) ?? children  →  "Creá tu primera empresa"
```

El componente **no se toca**. No hay clave nueva en `en.json`. No hay
sincronización de 41 archivos. La validación de locales queda exactamente como
está.

Tres propiedades que lo hacen ganar:

1. **Se activa desde una config de build propia**, sin tocar `vite.config.ts`:
   `ui/vite.config.es-ar.ts` importa la config de upstream y le agrega el
   plugin. Resultado: **cero archivos de upstream modificados**, hoy y siempre.
2. **Compone con lo que ya existe.** Si upstream externaliza una cadena a
   `en.json` y su `t()` devuelve inglés, ese inglés igual pasa por el overlay
   camino al DOM. Nos da lo mismo si la cadena vino de un literal o de i18next.
3. **Es inerte en los tests.** `ui/vitest.config.ts` es una config aparte que
   **no** lee `vite.config.ts` y no carga plugins, así que los 684 archivos de
   test siguen viendo inglés y siguen pasando sin que los toquemos.

Y resuelve de taquito el hallazgo 4 del relevamiento (etiquetas duplicadas):
`"Critical"` aparece suelto en 4 archivos y los nombres de estado en 7, pero
hay **una sola entrada de diccionario** para cada uno. No hace falta unificar
nada en un helper traducido; ese refactor habría tocado 7+ archivos de upstream
para no ganar nada acá.

## 6. Qué se verificó

Todo lo que sigue se corrió en `/paperclip/workspaces/paperclip-es`, rama
`traduccion-es`, y los archivos de prueba se borraron después. El árbol quedó
limpio.

**6.1 — i18next ya cae a inglés por clave faltante.** Con un `es` parcial y
`fallbackLng: "en"`, la clave presente se traduce y la faltante devuelve el
inglés. Confirma que la validación estricta es más dura que el runtime (y que
la premisa de (b) era cierta, aunque la opción se rechace por otra razón).

**6.2 — El overlay no puede colgarse de la instancia de i18next de upstream.**
`addResourceBundle("es-AR", "overlay", …)` + `getFixedT("es-AR", "overlay")`
devuelve `"Save"`, no `"Guardar"`, porque `supportedLngs` no lista `es-AR`. Con
instancia propia y `keySeparator: false` / `nsSeparator: false` funciona, pero
eso es una segunda instancia de i18next solo para hacer `Map.get`. Por eso el
overlay de esta decisión usa un `Map` y no i18next.

**6.3 — El shim traduce texto y atributos.** Renderizado con
`react-dom/server` sobre la salida exacta del compilador de JSX:

```
<div title="Guardar"><h1>Creá tu primera empresa</h1><input placeholder="Buscar tareas…"/>Guardar<code>in_review</code></div>
```

Traduce `children` (string y array), `title`, `placeholder`, y deja intacto el
`<code>` con el identificador técnico.

**6.4 — Funciona en build de producción.** Vite 8.2.2 + `@vitejs/plugin-react`
6.1.1 + React 19.2.8. En el bundle, el componente llama al `jsx`/`jsxs` del
shim y el shim recibe el runtime real de React: no hay recursión.

**6.5 — Funciona sobre el código real de upstream, sin modificarlo.** Con el
dev server levantado con `vite.config.es-ar`, `src/App.tsx` y
`src/pages/IssueDetail.tsx` (8.486 líneas, sin una línea cambiada) compilan a:

```js
import { jsxDEV as _jsxDEV, Fragment as _Fragment } from "/.../jsx-runtime.ts";
```

y el shim resuelve a `react_jsx-runtime.js` / `react_jsx-dev-runtime.js`
pre-bundleados. HMR y las ubicaciones de código (`fileName`, `lineNumber`) se
conservan.

**6.6 — La búsqueda en el diccionario.** Literales, patrones con captura,
preservación de espacios al borde y memo: `" Save "` → `" Guardar "`,
`"3 tasks"` → `"3 tareas"`, `"in_review"` → sin cambio.

**6.7 — El código del §8 es el que se corrió.** Los cuatro archivos de la §8 se
escribieron con los nombres y rutas que prescribe este ADR, más un diccionario
de 5 entradas y un patrón. Resultado: `tsc --noEmit -p ui/tsconfig.json` sin un
solo error en nuestros archivos, y un test de `lookup()` con los 7 casos de
§6.6 en **7/7**. Las únicas advertencias de Vite que quedan vienen del
`__dirname` de `vite.config.ts` y `vitest.config.ts` de upstream, no de lo
nuestro. Los archivos se borraron después: la implementación es de Dev UX/UI.

**6.8 — Línea de base intacta.** `vitest run src/i18n/locale-validation.test.ts`
→ **7/7 pasa**. Esta decisión no lo puede romper: no toca `locales/`.

**Nota de entorno:** `vite build` de `ui` **ya falla** en este workspace, con y
sin overlay, por `Rolldown failed to resolve import "zod" from
packages/shared/src/company-import-transfer.ts`. Es porque se instalaron solo
las dependencias de `ui`. No lo causa esta decisión; hay que instalar las
dependencias de `packages/shared` antes de pedirle un build completo a nadie.

## 7. Convención de claves

### 7.1 La clave es la cadena en inglés, exacta

Sensible a mayúsculas, con la puntuación final incluida, y con `…` o `...` tal
como esté en el código. `"Save"`, `"Search tasks…"`, `"In Progress"`.

- Los espacios al borde se preservan: el diccionario guarda la forma sin
  espacios al borde y el overlay los vuelve a pegar.
- No se normaliza nada más. Si no traduce, es que la cadena del código no es la
  que está en el diccionario; se copia del código, no se escribe de memoria.

### 7.2 Dónde vive cada cadena

Todo en `ui/src/i18n-es-ar/`, que es **nuestro** directorio. Diccionario
partido por área para que los diffs se puedan revisar y para que dos personas
puedan trabajar en paralelo sin pisarse:

```
ui/src/i18n-es-ar/
├── dictionary/
│   ├── common.json        ← compartidas: verbos de acción, estados, prioridades,
│   │                        elementos de interfaz, etiquetas de formulario
│   ├── navigation.json    ← barra lateral, bandeja, rutas de navegación
│   ├── issues.json        ← tareas, detalle, kanban, comentarios
│   ├── agents.json        ← agentes, contratación, ejecuciones
│   ├── projects.json
│   ├── connections.json
│   ├── settings.json
│   ├── onboarding.json
│   ├── errors.json        ← mensajes de error y estados vacíos
│   └── explicit.json      ← claves punteadas, solo para el escape de §7.5
├── patterns.ts            ← cadenas con interpolación
├── overlay.ts             ← búsqueda + memo + interruptor
├── jsx-runtime.ts         ← el shim
├── vite-plugin.ts         ← intercepta react/jsx-runtime
└── overlay.test.ts        ← nuestros tests
```

Reglas:

- **Una cadena vive en un solo archivo.** Si aparece en más de una pantalla, va
  a `common.json`.
- **Estados y prioridades van siempre en `common.json`**, con la etiqueta
  inglesa como clave (`"In Progress": "En curso"`, `"Critical": "Crítica"`).
  Eso cubre de una vez los 7 archivos donde upstream las repite.
- Objetos JSON planos, `{"inglés": "español"}`, sin anidar. Sin claves
  punteadas (salvo `explicit.json`).
- Un test nuestro falla si dos archivos definen la misma cadena inglesa con
  traducciones distintas.
- Las traducciones salen del documento **Glosario es-AR** (CHA-2). El glosario
  manda: voseo, infinitivo en botones, sentence case, nada de peninsularismos.

### 7.3 Qué nunca entra al diccionario

- Identificadores técnicos y valores de API: `in_review`, `critical`, `plan`,
  slugs, nombres de campo, variables de entorno.
- Nombres propios: Paperclip, Claude, GitHub, Slack, MCP, JSON, PR.
- Palabras cortas y ambiguas sueltas, si la misma palabra inglesa necesita dos
  traducciones distintas según la pantalla (`"Open"` = "Abrir" o "Abierta").
  Ésas van por §7.5.

El shim además **no traduce** lo que esté dentro de `<code>` ni `<pre>`.

### 7.4 Cadenas con interpolación

Van a `patterns.ts`, como lista **ordenada** de reglas ancladas:

```ts
export const PATTERNS: Array<{ match: RegExp; replace: string }> = [
  { match: /^(\d+) tasks$/, replace: "$1 tareas" },
  { match: /^Updated (\d+)([smhd]) ago$/, replace: "Actualizada hace $1$2" },
];
```

- Siempre ancladas con `^…$`. Sin patrones que puedan pegar en media cadena.
- **Los literales se buscan antes que los patrones**, y eso es lo que resuelve
  los plurales: `/^(\d+) tasks$/` no cubre `"1 task"`, así que el singular se
  agrega como literal (`"1 task": "1 tarea"`). Regla: todo patrón con número
  lleva su literal singular al lado.
- Techo: ~50 patrones. Si uno se pone difícil de leer, mejor el escape de §7.5.

### 7.5 El escape: claves punteadas

Solo para los casos donde la cadena inglesa es ambigua y necesita dos
traducciones distintas, o donde se arma por concatenación antes de llegar a
JSX. Ahí sí se edita el componente, con el costo asumido de un conflicto
posible en ese archivo:

```tsx
import { tEs } from "@/i18n-es-ar/overlay";
// …
<Chip>{tEs("issues.statusChip.open", "Open")}</Chip>
```

`tEs(clave, inglés)` devuelve el español si el overlay está activo y el inglés
si no, así que la app en inglés y los 684 tests no cambian de comportamiento.

Convención de nombre: `area.componente.elemento`, minúsculas, camelCase por
segmento, de lo general a lo particular. El área es la del archivo de
diccionario (`issues`, `agents`, `settings`, …). Las claves punteadas viven en
`dictionary/explicit.json` —**nunca** en `locales/en.json`— y por eso la
validación de locales nunca las ve.

Esto es el último recurso. Si se usa más de ~50 veces en total, hay que volver
a este ADR.

## 8. Instrucciones de implementación

Para Dev UX/UI. Está todo decidido; no hace falta volver a elegir nada. El
código de abajo es el que se verificó en §6, se copia tal cual.

### Fase 1 — La máquina (una sola vez)

**0.** Crear el árbol de §7.2: los archivos de `dictionary/` (aunque arranquen
en `{}`) y `patterns.ts` con la forma de §7.4 (puede arrancar con la lista
vacía). `overlay.ts` importa todos los archivos de diccionario y los funde en
un solo `Map`; cada vez que se agrega un archivo de área hay que agregarle el
`import` ahí, y es lo único que se toca de la máquina.

**1. `ui/src/i18n-es-ar/overlay.ts`**

```ts
import common from "./dictionary/common.json";
import errors from "./dictionary/errors.json";
import explicit from "./dictionary/explicit.json";
import issues from "./dictionary/issues.json";
// …el resto de los archivos de dictionary/
import { PATTERNS } from "./patterns";

const LITERALS = new Map<string, string>(
  Object.entries({ ...common, ...errors, ...issues /* …el resto */ }),
);
const EXPLICIT = new Map<string, string>(Object.entries(explicit));
const memo = new Map<string, string>();

function resolve(value: string): string | undefined {
  const literal = LITERALS.get(value);
  if (literal !== undefined) return literal;
  for (const { match, replace } of PATTERNS) {
    if (match.test(value)) return value.replace(match, replace);
  }
  return undefined;
}

/** Puro y exportado para los tests: no mira el interruptor. */
export function lookup(value: string): string {
  const cached = memo.get(value);
  if (cached !== undefined) return cached;
  let resolved = resolve(value);
  if (resolved === undefined) {
    const trimmed = value.trim();
    if (trimmed !== value && trimmed.length > 0) {
      const inner = resolve(trimmed);
      if (inner !== undefined) {
        const lead = value.slice(0, value.indexOf(trimmed[0]));
        resolved = `${lead}${inner}${value.slice(lead.length + trimmed.length)}`;
      }
    }
  }
  const out = resolved ?? value;
  memo.set(value, out);
  return out;
}

function overlayEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("lang");
  if (fromUrl) return fromUrl !== "en";
  try {
    return window.localStorage.getItem("paperclip.lang") !== "en";
  } catch {
    return true;
  }
}

const ENABLED = overlayEnabled();

export function translate(value: string): string {
  return ENABLED ? lookup(value) : value;
}

/** Escape de §7.5: clave punteada con el inglés como respaldo. */
export function tEs(key: string, english: string): string {
  if (!ENABLED) return english;
  return EXPLICIT.get(key) ?? english;
}
```

**2. `ui/src/i18n-es-ar/jsx-runtime.ts`**

```ts
import { jsx as origJsx, jsxs as origJsxs, Fragment } from "react/jsx-runtime";
import { jsxDEV as origJsxDEV } from "react/jsx-dev-runtime";

import { translate } from "./overlay";

const TEXT_PROPS = new Set(["placeholder", "title", "aria-label", "alt", "label"]);
const OPAQUE_TYPES = new Set(["code", "pre"]);

type Props = Record<string, unknown> | null | undefined;

function translateProps(type: unknown, props: Props): Props {
  if (!props || OPAQUE_TYPES.has(type as string)) return props;
  let out = props;
  const write = (key: string, value: unknown) => {
    if (out === props) out = { ...props };
    (out as Record<string, unknown>)[key] = value;
  };
  for (const key of Object.keys(props)) {
    const value = (props as Record<string, unknown>)[key];
    if (key === "children") {
      if (typeof value === "string") {
        const next = translate(value);
        if (next !== value) write("children", next);
      } else if (Array.isArray(value)) {
        let changed = false;
        const arr = value.map((child) => {
          if (typeof child !== "string") return child;
          const next = translate(child);
          if (next !== child) changed = true;
          return next;
        });
        if (changed) write("children", arr);
      }
      continue;
    }
    if (TEXT_PROPS.has(key) && typeof value === "string") {
      const next = translate(value);
      if (next !== value) write(key, next);
    }
  }
  return out;
}

export const jsx = (type: never, props: Props, key?: never) =>
  origJsx(type, translateProps(type, props) as never, key);
export const jsxs = (type: never, props: Props, key?: never) =>
  origJsxs(type, translateProps(type, props) as never, key);
export const jsxDEV = (
  type: never, props: Props, key: never,
  isStatic: boolean, source: never, self: never,
) => origJsxDEV(type, translateProps(type, props) as never, key, isStatic, source, self);
export { Fragment };
```

Si TypeScript se queja de las firmas, el ajuste de tipos es libre **mientras no
cambie el comportamiento**: `translateProps` corre antes de delegar al runtime
real, y `jsxDEV` reenvía los seis argumentos (sin eso se pierden las
ubicaciones de código en dev).

**3. `ui/src/i18n-es-ar/vite-plugin.ts`**

```ts
import path from "node:path";
import type { Plugin } from "vite";

const SHIM = path.resolve(import.meta.dirname, "jsx-runtime.ts");

export function localeOverlayJsxRuntime(): Plugin {
  return {
    name: "paperclip-es-ar-overlay-jsx-runtime",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "react/jsx-runtime" && source !== "react/jsx-dev-runtime") return null;
      if (importer === SHIM) return null; // el shim necesita el runtime real
      return SHIM;
    },
  };
}
```

El `importer === SHIM` es lo que evita la recursión infinita. No lo saques.

**4. `ui/vite.config.es-ar.ts`** — la activación, sin tocar `vite.config.ts`:

```ts
import { defineConfig, type UserConfig, type UserConfigFnObject } from "vite";

import base from "./vite.config";
import { localeOverlayJsxRuntime } from "./src/i18n-es-ar/vite-plugin";

export default defineConfig(async (env) => {
  const resolved = (await (base as unknown as UserConfigFnObject)(env)) as UserConfig;
  return { ...resolved, plugins: [localeOverlayJsxRuntime(), ...(resolved.plugins ?? [])] };
});
```

Comandos:

```sh
# desarrollo en es-AR
pnpm --filter ui exec vite --config vite.config.es-ar.ts
# build en es-AR (el que va al deploy del fork)
pnpm --filter ui exec vite build --config vite.config.es-ar.ts
```

El `vite build` de siempre sigue produciendo la app en inglés, intacta. Un
árbol de fuentes, dos salidas.

**5. `ui/src/i18n-es-ar/overlay.test.ts`** — mínimo a cubrir:

- `lookup()` sobre literal, patrón, cadena con espacios al borde, identificador
  técnico (sin cambio) y cadena desconocida (sin cambio).
- Todo patrón con número tiene su literal singular (§7.4).
- Ningún par de archivos de `dictionary/` define la misma cadena inglesa con
  traducciones distintas.
- Reglas del glosario sobre los valores: sin "añadir", "fichero", "pulsa",
  "vale", "tú ", "usted"; los `¿` y `¡` de apertura presentes cuando la cadena
  termina en `?` o `!`.

### Fase 2 — Traducir, pantalla por pantalla

Por cada pantalla: levantar el dev server con la config es-AR, recorrerla,
anotar lo que quedó en inglés, agregar las entradas al archivo de área que
corresponda, recargar. **No se edita ningún `.tsx`.** Orden sugerido, de más
visto a menos: navegación y barra lateral → bandeja y lista de tareas →
detalle de tarea → agentes → proyectos → configuración → onboarding →
conexiones.

Lo que no se puede traducir así (queda en inglés y se anota, no se fuerza):
`document.title`, `window.confirm`/`alert`, texto dibujado en canvas, y
cadenas armadas por concatenación que ningún patrón cubre. Si alguna de ésas
importa, va por §7.5.

### Fase 3 — Opcional, cuando haya volumen

Un script propio en `ui/src/i18n-es-ar/tools/` que liste entradas del
diccionario que ya no aparecen en ningún archivo de `ui/src`: son las que
upstream cambió y hay que actualizar.

### Verificación antes de entregar

```sh
pnpm --filter ui exec vitest run src/i18n-es-ar
pnpm --filter ui exec vitest run src/i18n/locale-validation.test.ts   # tiene que seguir 7/7
```

No hace falta `pnpm check:token-gates`: no hay cambios en componentes.

## 9. Costo de agregar una cadena nueva, una vez implementado

**Una línea en un archivo JSON nuestro.** Nada más: no se edita el `.tsx`, no
se agrega clave a `en.json`, no se sincronizan 41 locales, no se corre ningún
script.

Comparación con las opciones rechazadas:

| | Archivos a editar por cadena nueva |
| --- | --- |
| (a) | 1 `.tsx` + `en.json` + 40 locales de relleno |
| (b) | 1 `.tsx` + `en.json` + `es-AR.json` |
| (c) | 1 `.tsx` + overlay |
| **(d)** | **1 archivo de diccionario** |

Y por cada `git pull` de upstream: **0 conflictos** en lo nuestro, porque todos
nuestros archivos son rutas nuevas. El único efecto de un cambio de upstream es
que una cadena inglesa que cambió deja de pegar en el diccionario y esa
pantalla muestra inglés hasta que actualicemos la entrada. Se degrada; no
rompe.

## 10. Riesgos y límites

| Riesgo | Mitigación |
| --- | --- |
| Es máquina nuestra (~150 líneas, 4 archivos) | Verificada en build y en dev sobre el código real (§6.4, §6.5). El contrato del runtime de JSX es estable desde React 17. |
| Una cadena inglesa, dos significados en español | §7.3 (no entra al diccionario) y §7.5 (clave punteada en ese componente). |
| Plurales y concordancia | Literal singular al lado de cada patrón (§7.4). |
| Traducir algo que debía quedar en inglés | `<code>` y `<pre>` excluidos; identificadores técnicos no entran al diccionario; el diccionario es exacto, no difuso. |
| Costo en runtime: un `Map.get` por cadena | Memo por cadena de entrada, O(1) amortizado. Medir una vez en `IssueDetail` (8.486 líneas, la pantalla más cara) antes de cerrar la fase 2. |
| El español no queda cubierto por los tests de upstream | Es el precio de que los 684 tests sigan verdes sin tocarlos. Los nuestros cubren el diccionario; las pantallas se verifican a mano en la fase 2. |
| Algo sale mal en producción | **Interruptor:** `?lang=en` en la URL, o `localStorage["paperclip.lang"] = "en"`. Y a nivel build, volver al `vite build` de siempre deja la app en inglés sin revertir un solo archivo. |

Límite honesto: esto **no se puede contribuir a upstream**. Si alguna vez
queremos aportarles la traducción, el diccionario `inglés → es-AR` es
justamente el insumo que hace falta para llenar un `es-AR.json` por claves una
vez que upstream externalice las cadenas. El trabajo de traducir no se pierde;
el que habría que rehacer es el cableado.

## 11. Lo que no se toca nunca

- `ui/src/i18n/locales/*.json` — ni `en.json`, ni `es.json`, ni los otros 39.
- `ui/src/i18n/locale-validation.ts` y su test.
- `ui/src/i18n/locales.ts`, `ui/src/i18n/index.ts`.
- `ui/vite.config.ts`, `ui/vitest.config.ts`, `ui/package.json`.
- Los 684 archivos de test de `ui/src`.

Si una tarea parece exigir tocar alguno de éstos, no se toca: se vuelve a este
ADR y se discute.
