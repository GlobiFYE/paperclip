# ADR 0001 — Traducción a es-AR por overlay en la frontera de JSX

- **Estado:** Aceptado · **revisión 2** (CHA-24), §12 en adelante · §14.2
  **implementado** y §14.3 **obsoleto** (CHA-38)
- **Fecha:** 2026-10-17 (revisión 1) · 2026-10-17 (revisión 2)
- **Decide:** Arquitecto (Chanchu Labs)
- **Ejecuta:** Dev UX/UI
- **Alcance:** fork `traduccion-es`, partido de `master` en `bba6a45f0`
- **Contexto previo:** documento *Relevamiento técnico — i18n de la interfaz* (CHA-2)

> **Cómo leer este documento.** Las secciones 1 a 11 son la revisión 1: la
> decisión con la que se hizo el corte 1 y que sigue siendo la base. La
> **revisión 2 (§12 a §21)** la corrige en dos puntos para poder escalar al
> corte 2: agrega una capa de resolución **en compilación** y **angosta** el
> shim de runtime. Donde la revisión 2 reemplaza algo, la sección vieja lo
> dice. Lo que no está marcado, sigue vigente tal cual.
>
> **Estado de la revisión 2 al cerrar CHA-38.** El mapa por sitio de **§14.2
> está implementado** y en uso para 8 cadenas. De lo demás: **§14.3 quedó
> obsoleto** —el shim de runtime no se angostó, se **borró** (ADR 0002 / CHA-23),
> y QA midió en CHA-28 que por ahí no entra contenido del dueño; sigue sin
> existir y no se resucita—; la capacidad de **§14.4** para dejar Configuración
> en inglés **está disponible pero no implementada**, porque el dueño aceptó
> (05:57Z) traducir Configuración y ese trabajo ya está en la rama; y el revert
> de las 36 llamadas a `tEs()` que pide **§17 no se hizo** y no era de CHA-38.
> Cada una de las tres está anotada en su sección.

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

> **Reemplazada por §15 (revisión 2).** `tEs()` deja de ser el escape para la
> ambigüedad: lo hace el mapa por sitio de §14.2, que no edita upstream. Las 36
> llamadas que hay hoy se revierten (§17). El techo de ~50 queda sin efecto
> porque la cuenta pasa a ser cero. Lo que sigue es el registro de la revisión 1.

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
| Una cadena inglesa, dos significados en español | §7.3 (no entra al diccionario) y §7.5 (clave punteada en ese componente). **Revisión 2: lo resuelve el mapa por sitio, §14.2.** |
| Plurales y concordancia | Literal singular al lado de cada patrón (§7.4). |
| Traducir algo que debía quedar en inglés | `<code>` y `<pre>` excluidos; identificadores técnicos no entran al diccionario; el diccionario es exacto, no difuso. **Revisión 2: además el contenido del dueño queda fuera por construcción, §13.** |
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

---

# Revisión 2 — escalar al corte 2 (CHA-24)

- **Fecha:** 2026-10-17
- **Decide:** Arquitecto (Chanchu Labs)
- **Ejecuta:** Dev UX/UI
- **Insumo:** medición del Lead en `/paperclip/workspaces/.i18n-medicion/`
  (`LEEME.md`, `report-completo.json`, `spread.json`, `lotes/`)
- **Línea de base:** `3a32cb640`, diccionario es-AR con 256 entradas

## 12. Por qué hay que volver al ADR

El corte 1 fueron 256 entradas. El alcance que pidió el dueño (doce pantallas,
Configuración afuera) son **3.549 cadenas pendientes**, ~15.600 palabras. A esa
escala, dos cosas de la revisión 1 dejan de cerrar.

**12.1 El presupuesto de `tEs()` no alcanza, y no es por el número 50.**
Hay 36 llamadas usadas, repartidas en **11 archivos de upstream**: quedan 14
antes del techo de §7.5. Contra eso, en el alcance nuevo hay 102 cadenas de
dos palabras o menos que aparecen en 3 o más archivos, y esas 102 son
**552 sitios de literal** en `ui/src`. Si se cuentan todas las cortas que
aparecen en más de un archivo son 345 cadenas y **1.233 sitios**.

No hace falta estimar qué porcentaje de esos sitios necesita un español
distinto, y es mejor no estimarlo: con 14 llamadas de presupuesto, alcanza con
que **el 2,5 %** de los 552 sitios calientes divergan para romper el techo, o
el **1,1 %** de los 1.233. Cualquier número plausible está muy arriba de eso.

Y hay un segundo motor de divergencia que el corte 1 ya mostró y que no es
homografía sino **concordancia de género**, que es por definición por sitio:
`"Active"` ya es "Activas" para tareas y "Activos" para agentes, y `"New"` va a
ser "Nueva" o "Nuevo" según el sustantivo que tenga al lado. De las 18 claves
punteadas que existen hoy, **3 son género** y no ambigüedad de sentido. Con 526
cadenas de una sola palabra en el alcance nuevo, muchas de ellas adjetivos y
participios, este motor pesa.

**12.2 La colisión con el contenido del dueño cambia de naturaleza.**
El shim traduce cualquier cadena que React vaya a renderizar y sólo excluye
`<code>` y `<pre>` (`jsx-runtime.ts`), así que no distingue una etiqueta de
interfaz del título de una tarea. Con 256 entradas el dueño aceptó el riesgo.
El alcance nuevo mete **2.328 cadenas de 3 palabras o menos, 526 de una sola
palabra**: a esa escala casi cualquier título corto en inglés que escriba el
dueño o un agente se traduce solo. Esa aceptación no se estira, y hay que
dejar de pedirle que se estire.

Las dos cosas tienen la misma causa: **el diccionario se aplica mirando el
texto que sale, no de dónde vino.** Por eso no puede distinguir ni el contexto
(problema 1) ni el origen (problema 2). La revisión 2 cambia *dónde* se aplica.

## 13. La frontera entre interfaz y contenido existe, y es la fuente

La pregunta de CHA-24 era si se puede distinguir, en la frontera del JSX, la
cadena que viene de un literal del código de la que viene de datos del
servidor. En la frontera del JSX, **no**: ahí las dos son un `string` y no hay
nada que las diferencie. Ése fue el hallazgo de la revisión 1 y sigue siendo
cierto.

Pero la frontera existe **un paso antes**: en el momento de compilar. Un
literal del código está en el texto del archivo; un título de tarea no está en
ningún archivo. Si el diccionario se aplica ahí, el contenido del dueño queda
afuera **por construcción**, no por una lista de exclusiones que haya que
mantener.

### 13.1 El contraejemplo de CHA-9 sigue en pie — verificado

CHA-9 descartó "traducir sólo literales" porque `StatusIcon.tsx:10-12`
**derivaba** la etiqueta del valor técnico y llegaba a children igual que un
título de tarea. CHA-24 pedía verificar si CHA-15 lo había arreglado con
`tEs()`. **No lo arregló.** CHA-15 arregló el *síntoma* agregando la entrada
literal `"Blocked"` al diccionario; la derivación sigue intacta:

```
ui/src/components/StatusIcon.tsx:11
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
```

Y no es un caso aislado: **36 archivos de producción** de `ui/src` derivan una
etiqueta humana de un valor técnico con `replace(/_/g, " ")`. Son estados,
prioridades, estados de corrida, tipos de aprobación. Ninguna de esas cadenas
existe como literal en ninguna parte, así que una capa de compilación no las
ve. El contraejemplo vale y hay que pagarlo.

### 13.2 Cuánto cubre la frontera, medido sobre el corte 1

El corte 1 es la mejor prueba disponible, porque son 238 entradas literales que
QA ya vio en español en pantalla. Clasifiqué la posición sintáctica de cada
literal de interfaz de todo `ui/src` de producción y la crucé contra esas 238:

| | entradas |
| --- | --- |
| Alcanzables por la lista blanca de posiciones (§14.1) | **220 (92 %)** |
| Necesitan el escape `forzar` de §14.2 | 10 |
| Son nuestras (`LanguageSelector.tsx`, ya en español) | 4 |
| No existen como literal en producción | 4 |

Las 4 últimas son la frontera mordiendo, y conviene mirarlas de cerca porque
son el tipo de caso que se pierde: `"Failed to fetch"` (la tira el navegador),
`"The company spending limit was reached."` (la tira el servidor),
`"Main company nav"` y `"Couldn't open My Skills"` (con apóstrofo curvo: la
entrada del diccionario no coincide con ningún literal del código, o sea que
**ya hoy no traduce nada** y es peso muerto).

Dicho de otra forma: de las 238 que funcionan hoy, la capa de compilación llega
a 230 **sin tocar un archivo de upstream** (220 solas, 10 con una entrada en un
JSON nuestro), y las 8 que quedan son 4 nuestras y 4 que vienen de afuera del
fork.

En el alcance nuevo la cobertura es del 100 % por construcción: el extractor
del Lead sólo cuenta literales en posición JSX, así que **las 3.549 pendientes
son todas literales de la fuente**.

Y hay una comprobación independiente, hecha después y sobre trabajo que no
escribí yo: las **494 entradas largas** que CHA-25 commiteó en `deff36b50`
caen **494 de 494** en la lista blanca de posiciones, sin una sola que necesite
`forzar` (416 `JSXText`, 110 ramas de ternario, 68 atributos de texto). Es el
lote que ya está traducido, y pasa entero.

## 14. Decisión: resolución en compilación, por sitio

Se agrega una capa que, en el `transform` de Vite, reescribe cada literal de
interfaz de **nuestra** fuente a un ternario sobre una bandera global:

```
<h1>Save</h1>                 ->  <h1>{__ES?"Guardar":"Save"}</h1>
label="Status"                ->  label={__ES?"Estado":"Status"}
toast.error("Failed to save") ->  toast.error((__ES?"No se pudo guardar":"Failed to save"))
```

Nada de esto toca un archivo de upstream en el disco: el reemplazo pasa en
memoria y se activa sólo desde `vite.config.es-ar.ts`. Siguen siendo **cero
archivos de upstream modificados**, igual que la revisión 1 — y ahora también
cero por ambigüedad, que antes costaba 11.

La bandera la pone un `<script>` que el plugin inyecta en `index.html` antes de
cualquier módulo, leyendo `?lang=` y `localStorage` con la misma lógica de
`language.ts`. El interruptor de §10 se conserva.

### 14.1 Qué posiciones se traducen

Una cadena se reescribe si **está en el diccionario** y **está en una posición
de la lista blanca**. Las dos condiciones, siempre.

Lista blanca (las posiciones donde una cadena es texto para la persona):

- `JSXText` fuera de `<code>`/`<pre>`.
- Literal dentro de `{…}` en JSX, incluidas las dos ramas de un ternario.
- Atributo JSX con nombre de texto: `placeholder`, `title`, `aria-label`,
  `alt`, `label`, `message`, `description`, `hint`, `action`, `heading`,
  `emptyMessage`, `tooltip`, `subtitle`, … (la lista vive en el código).
- Propiedad de objeto cuya **clave** es uno de esos nombres (`{ label: "Done" }`).
- Valor por defecto de parámetro (`moreLabel = "Show more"`, el caso de
  `FoldCurtain.tsx`).
- `return "…"`.
- Argumento de una llamada de texto: `toast.*`, `window.confirm`,
  `window.alert`.

Lista negra **dura** — ahí la cadena es dato o lógica y traducirla rompe la
aplicación, así que no se reescribe nunca, ni con `forzar`:

- Operando de comparación, `case` de un `switch`.
- Fuente de un `import`/`export`, atributo de import.
- **Clave** de objeto, propiedad de un `MemberExpression`.
- Posición de tipo (`TSLiteralType`, `TSTypeReference`, `TSEnumMember`).
- Atributo estructural: `className`, `id`, `key`, `to`, `href`, `src`, `type`,
  `role`, `name`, `path`, `value`, `variant`, `size`, `status`, `kind`,
  `data-*`, `aria-*` que no sea `aria-label`.

### 14.2 El mapa por sitio: lo que reemplaza a `tEs()`

Además del diccionario global de §7.2, que no cambia de formato, hay un mapa
por archivo:

```json
{
  "components/IssuesList.tsx":  { "Open": "Abierta" },
  "pages/apps/AppDetail.tsx":   { "Open": "Abrir" },
  "components/ActivityCharts.tsx": { "To Do": { "es": "Por hacer", "forzar": true } }
}
```

- La forma corta cambia la traducción en ese archivo y nada más. La lista
  blanca de posiciones sigue aplicando. Es la forma que alcanza para 220 de las
  238 entradas del corte 1 y para 22 de las 36 llamadas a `tEs()` que hay hoy.
- La forma larga con `forzar: true` **además** habilita posiciones que la lista
  blanca no cubre: mapas de etiquetas indexados por el valor técnico
  (`{ todo: "To Do", in_progress: "In Progress" }`), elementos de un array de
  textos. Nunca habilita una posición de la lista negra dura.
- La clave es `archivo + inglés`, no la línea: no se mueve cuando upstream
  edita el archivo arriba. Si upstream **renombra** el archivo, la entrada deja
  de pegar y esa cadena vuelve al español del diccionario global, o al inglés.
  Se degrada; no rompe.

Esto es el contexto que pedía CHA-24, y cuesta **cero ediciones de upstream**.

> **Implementado en CHA-38.** El mapa vive en
> `ui/src/i18n-es-ar/dictionary/por-sitio/es-AR.json` y lo cargan
> `ui/src/i18n-es-ar/por-sitio.ts` (datos y búsqueda), `overlay.ts`
> (`lookupPorSitio`) y `mark-text.ts` (que le pasa el sitio a `__tEs`). Cinco
> cosas que el diseño no decía y la implementación tuvo que fijar:
>
> 1. **La ruta es relativa a `ui/src/`**, como en los ejemplos de arriba
>    (`components/IssuesList.tsx`). El marcado recibe la ruta relativa a `ui/` y
>    le saca el `src/`; una clave que empiece con `src/` no pegaría nunca, así
>    que el cargador la rechaza con un error en vez de ignorarla.
> 2. **El sitio se le pasa a `__tEs` sólo donde el mapa tiene una entrada.**
>    Donde no, la llamada sale con un solo argumento, igual que antes. Así
>    agregar el mapa no cambia la salida en los ~8.000 sitios restantes y el
>    conteo de posiciones que reciben algo que no es literal estático —el test de
>    la garantía del dueño, CHA-28— no se mueve: sigue en 3.
> 3. **Los espacios del borde se recortan y se vuelven a pegar**, igual que en
>    §7.1. Sin esto `Installed · {n}` no se podría escribir en el mapa: su nodo
>    de texto es `"Installed · "`, con el espacio final adentro.
> 4. **Un archivo, un español por cadena.** Si el mismo inglés tiene dos
>    sentidos *dentro del mismo archivo*, la clave `archivo + inglés` no los
>    puede separar y la salida correcta es **no poner la entrada**: se degrada al
>    inglés, que es legible, en vez de a una oración mal escrita. Pasó en dos de
>    los ocho casos y está documentado en `doc/i18n-es-ar/CHA-38-mapa-por-sitio.md`.
> 5. **No llega al canal de declaraciones.** `TEXT_DECLS` envuelve el `return`
>    entero de una función, así que lo que se busca ahí no es un literal del
>    archivo y no hay dónde colgarle el sitio. Es un límite y a la vez la razón
>    de ser del mapa: `statusLabel("open")` devuelve `"Open"`, así que una
>    entrada **global** de `Open` le cambiaría la etiqueta al glifo de estado.
>    Por eso las 7 cadenas nuevas viven sólo en el mapa por sitio.
>
> **La forma larga con `forzar: true` no está implementada.** Habilitar
> posiciones que la lista blanca no cubre toca `text-sites.ts` y es una decisión
> aparte; ninguna de las 8 cadenas la necesitó. El cargador **falla fuerte** si
> encuentra un `forzar`, para que no quede aceptado y sin efecto.

### 14.3 El shim de runtime se queda, angostado

> **OBSOLETO (CHA-38).** Esta sección no se implementó y no se va a
> implementar. El shim de `jsx-runtime.ts` no se angostó: ADR 0002 (CHA-23) lo
> **borró**, y QA midió en CHA-28 que por ese camino no entra contenido del
> dueño. `derived.json` no existe y no hace falta. Las etiquetas derivadas de
> §13.1 las alcanza el **canal de declaraciones** (`TEXT_DECLS`), con la lista
> de 3 funciones revisadas una por una. Que siga sin existir: resucitarlo
> reabre la superficie de colisión que el corte 1 cerró.

El shim de `jsx-runtime.ts` no se saca: es lo único que puede alcanzar las
etiquetas derivadas de §13.1. Lo que cambia es **qué diccionario le damos**.

- Hoy: el diccionario completo. Mañana serían 3.549 entradas, y cualquier
  título corto del dueño que coincida se traduce.
- Con la revisión 2: un archivo propio y chico, `dictionary/es-AR/derived.json`,
  con **sólo** el vocabulario de enumeración que los 36 archivos derivan —los 7
  estados, las 4 prioridades, los estados de corrida que QA encuentre— más las
  3 cadenas que upstream sirve por i18next (`locales/en.json` tiene exactamente
  3 claves, todas en `App.tsx`).

La superficie de colisión pasa de 256 entradas a unas 20, **menos de lo que el
dueño ya aceptó para el corte 1**. Por eso la aceptación del corte 1 alcanza y
no hay que volver a pedirla. Regla de política: `derived.json` tiene techo de
**60 entradas** y cada entrada tiene que ser una etiqueta de enumeración; si
hace falta más, se vuelve acá.

### 14.4 Lo que se gana de arriba

- **Configuración puede quedar en inglés de verdad.** El límite 2 del `LEEME.md`
  del Lead (el diccionario es global por texto, así que un botón compartido
  traducido para Tareas también se traduce dentro de Configuración) se levanta:
  el transform sabe en qué archivo está, así que una lista de rutas excluidas
  deja las pantallas de Configuración sin tocar, y los componentes compartidos
  siguen traducidos en el resto de la app.

  > **Capacidad disponible, NO implementada (CHA-38).** El mapa por sitio le da
  > al transform la identidad del archivo, así que la lista de rutas excluidas
  > es ahora escribible. **No se escribió, a propósito:** el dueño aceptó
  > (05:57Z) traducir Configuración y ese trabajo ya está en la rama. Queda
  > anotado para el día que se quiera dar vuelta, y ese día es una lista de
  > rutas, no un mecanismo nuevo.
- **Pone al alcance cosas que la revisión 1 declaraba imposibles** (§8, fase 2):
  `document.title`, `window.confirm`/`alert`, el texto que se dibuja en canvas y
  los pedazos de una concatenación. Son literales de la fuente como cualquier
  otro. Ojo que "al alcance" no es "gratis": `window.confirm`/`alert` ya están
  en la lista blanca, pero `document.title = "…"` y un `ctx.fillText("…")`
  necesitan que se agregue esa posición a la lista blanca o una entrada
  `forzar`. Lo que cambia es que dejan de ser imposibles.
- **No pasa por TypeScript.** `tEs()` tenía que tipar dentro de archivos de
  upstream; el transform corre después de `tsc` y no lo ve. `tsc -b` no cambia.

## 15. El techo de 50: qué recomiendo

CHA-24 pedía elegir entre subir el techo con fundamento o proponer un mecanismo
de contexto. **Recomiendo el mecanismo de contexto (§14.2), y no subir el
techo.** Más: recomiendo bajarlo a **cero**.

Subir el techo no es un arreglo, es una postergación, y por tres razones:

1. **El número no es el costo.** El costo es que cada llamada deja una edición
   permanente en un archivo que upstream sigue editando, y eso es un conflicto
   en cada `pull`, para siempre. Ése es el criterio 1 de §3, el que puso el
   dueño. Subir el techo es aceptar más conflicto permanente a cambio de nada
   estructural.
2. **No hay techo que alcance.** La población de sitios candidatos son 552 para
   las 102 cadenas calientes y 1.233 para las 345 cortas multi-archivo. Un
   techo de 100, de 200 o de 500 se discute cada dos semanas.
3. **El mecanismo de contexto es estrictamente mejor en las tres dimensiones de
   §3**: 0 archivos de upstream contra 11, una línea en un JSON nuestro contra
   una edición de un `.tsx` de upstream, y **un** mecanismo menos que explicar,
   porque `tEs()` desaparece en vez de convivir.

Con §14.2 en pie, las 36 llamadas a `tEs()` se revierten a literales planos y
las 18 claves de `explicit.json` pasan al mapa por sitio. Las ediciones de
upstream por traducción quedan en **0**, y el techo de §7.5 queda sin objeto.

`tEs()` se conserva como función exportada, sin llamadas, para el único caso que
el mapa por sitio no cubre: una cadena que se arma por concatenación en runtime
y que ningún patrón agarra. Si vuelve a aparecer una llamada, es señal de que
hay que volver a este ADR.

## 16. Qué se verificó

Todo se corrió en `/paperclip/workspaces/paperclip-es`, rama `traduccion-es`,
sobre la línea de base `3a32cb640`. Los archivos del prototipo se borraron:
lo único que esta revisión agrega al repo es este documento. La implementación
es de Dev UX/UI.

Las cuentas sobre el diccionario (238 entradas literales, 256 en total) son
contra `3a32cb640`. Mientras esto se escribía, CHA-25 entró con el lote 1 del
corte 2 (`deff36b50`): 494 entradas nuevas, **todas de 4 palabras o más**,
ninguna corta. O sea que el portón de §18.2 está intacto y las cuentas de
arriba no se mueven.

**16.1 — El parser sale de `vite`, así que no hay dependencia nueva.** Era el
riesgo que podía voltear todo el diseño: un transform necesita parsear TS+JSX, y
`ui/package.json` no se toca (§11). `vite` exporta `parseSync` (Oxc), que parsea
`.tsx` con anotaciones de tipo sin una sola dependencia agregada. Corrido sobre
los **1.173 archivos de producción de `ui/src` (13,9 MB): 0 errores de parseo**.

**16.2 — El costo de parsear.** 777 ms para el árbol completo, **0,66 ms por
archivo**. Es el peor caso: una pasada en frío sobre todo `ui/src`. En dev
Vite transforma por módulo y cachea, así que se paga por módulo cargado. Un
prefiltro por texto no sirve y lo medí para descartarlo: con 3.549 claves, el
**99 %** de los archivos contiene al menos una.

**16.3 — La frontera aguanta, sobre componentes reales de upstream.** Con el
transform puesto y `EmptyState.tsx` de upstream sin una línea cambiada: el
literal del archivo que llama sale en español
(`"Select an organization to view artifacts."` → "Elegí una empresa para ver
los artefactos.", `action="New task"` → "Nueva tarea") y el título de tarea que
llega por prop valiendo exactamente `"Open"` **sigue diciendo "Open"**. Es el
caso que hoy se da vuelta, y con esto no se da vuelta.

**16.4 — Dos españoles para la misma cadena inglesa, sin editar upstream.**
`"Open"` → "Abierta" en un archivo y "Abrir" en otro, con el mapa de §14.2 y
cero `tEs()`.

**16.5 — La lógica no se toca.** En el mismo archivo donde `"Open"` se traduce
como texto, `nombre === "Open"` sigue dando `true`. Y sobre `StatusIcon.tsx` de
upstream, pidiéndole al transform que traduzca `in_progress` (elemento del
array `allStatuses`), `text-sm` (clase) y `react` (import): **no toca ninguno**,
ni con `forzar: true`.

**16.6 — El mapa de etiquetas indexado por el valor técnico.** Sobre
`ActivityCharts.tsx` de upstream, `{ todo: "To Do" }` no se toca sin `forzar` y
sí con `forzar`, y la clave `todo:` queda intacta. Es el patrón que hoy consume
**14 de las 36** llamadas a `tEs()` (las de la forma `critical: tEs(…)`,
`done: tEs(…)`); las otras 22 son `label: tEs(…)` o `label={tEs(…)}` y las
cubre la lista blanca sin `forzar`.

**16.7 — La etiqueta derivada NO se alcanza, y está medido.** Sobre
`StatusIcon.tsx`, `"In Progress"` no aparece entre los literales reescritos
—la produce `statusLabel()` en runtime— y `"Blocked"` sí, porque ahí hay un
literal en `blockedAttentionLabel`. Es §13.1 en un test, y es la razón por la
que §14.3 mantiene el shim.

**16.8 — Prototipo: 9 de 9.** Los casos de 16.3 a 16.7 más el de costo, con una
config de vitest propia que es la única que instala el transform.

**16.9 — Línea de base intacta.** `vitest.config.es-ar.ts` → 7/7.
`src/i18n/locale-validation.test.ts` → 7/7. Esta revisión no cambió ni un
archivo de producción: el prototipo vivía en archivos propios y en una config
de vitest aparte.

**16.10 — El prototipo pidió un cambio de diseño.** La primera versión hacía el
mapa por sitio autoritativo en cualquier posición. Falló contra
`StatusIcon.tsx`: reescribió `in_progress` dentro del array `allStatuses`. De
ahí salen el `forzar` explícito de §14.2 y la lista negra dura de §14.1. Vale
anotarlo porque es la parte del diseño que no se puede deducir leyendo: sale de
chocar contra el código real.

**Nota de entorno:** `vite build` de `ui` sigue fallando en este workspace por
las dependencias de `packages/shared` que no están instaladas, igual que en la
revisión 1 (§6, nota). Así que §16 verifica el transform en vitest sobre el
código real, no en un build completo. **Antes de cerrar la fase de
implementación hay que correr un `vite build --config vite.config.es-ar.ts` de
verdad**, en un workspace con las dependencias completas.

## 17. Instrucciones de implementación

> **Lo que efectivamente se hizo, y dónde (CHA-38).** Estas instrucciones son de
> antes de ADR 0002, así que los nombres no coinciden: el marcado en compilación
> ya existía (`ui/src/i18n-es-ar/mark-text.ts` + `vite-plugin.ts`, CHA-23), con
> edición por rangos y relleno de saltos de línea tal como pide el paso 1. Lo
> que CHA-38 agregó encima es **sólo** el mapa por sitio: `por-sitio.ts` y
> `dictionary/por-sitio/es-AR.json`, no `compile-overlay/` ni `sites/es-AR.json`.
> No hay bandera en `index.html`: el interruptor es constante de build
> (`OVERLAY_IN_BUNDLE`, reescrita por el plugin).
>
> **El revert de las 36 llamadas a `tEs()` no se hizo, y no era de CHA-38.**
> Siguen siendo 36 y siguen funcionando: `tEs()` no se tocó. Darlas vuelta una
> por una es trabajo de traducción sobre archivos de upstream, no del mecanismo,
> y el mapa por sitio ya cubre lo que ellas cubrían para las cadenas nuevas.
> Queda para el Lead decidir si se hace y cuándo.

Para Dev UX/UI, en este orden. Los pasos 1 a 3 son una tarea; el 4 y el 5 son
tareas aparte y el 5 no se empieza sin el 3 cerrado.

**1. La máquina.** `ui/src/i18n-es-ar/compile-overlay/` con tres archivos:

- `rewrite.ts` — la función pura `rewrite(code, rutaRelativa, dict, sites)`.
  Parsea con `parseSync` de `vite`, junta los reemplazos, los aplica **de atrás
  para adelante** por desplazamiento de carácter. No se reimprime el AST: se
  empalma texto, así que 291.527 líneas de upstream pasan de largo sin riesgo
  de que un *pretty-printer* les cambie algo.
  **Cuidado con los números de línea:** un `JSXText` largo viene partido en
  varias líneas en el fuente y el reemplazo es de una sola, así que se come
  saltos y corre las líneas de abajo. Hoy pasa en **51** de los 1.221 `JSXText`
  que pegan en el diccionario, y con las cadenas largas del corte 2 va a pasar
  más. Se arregla rellenando: se cuentan los `\n` del tramo consumido y se
  emiten esos mismos `\n` **dentro** del ternario, antes de la llave de cierre
  (`{__ES?"…":"…"\n\n}`, verificado que parsea). Con eso los números de línea de
  dev quedan donde estaban y no hace falta sourcemap.
- `vite-plugin.ts` — el plugin con `enforce: "pre"`, que salta los archivos de
  test, los nuestros y las rutas excluidas de §14.4, y que inyecta en
  `index.html` el `<script>` de la bandera.
- `sites/es-AR.json` — el mapa de §14.2. Arranca vacío.

Se engancha en `ui/vite.config.es-ar.ts`, que ya existe. `vite.config.ts` de
upstream no se toca.

**2. Los tests.** `compile-overlay.test.ts` tiene que cubrir, como mínimo, los
casos 16.3 a 16.7 de arriba, más tres guardas que son las que evitan que esto
se degrade con el uso:

- Ninguna clave del diccionario global es un identificador técnico: nada que
  haga `/^[a-z0-9_.-]+$/` sin espacios.
- Ninguna clave del diccionario aparece en `ui/src` **sólo** en posiciones de
  la lista negra dura. Si eso pasa, la entrada es peso muerto o está mal
  escrita, y hay que verla.
- `derived.json` no pasa de 60 entradas (§14.3).

**3. Angostar el shim.** `overlay.ts` deja de fundir todos los archivos de
área en el `Map` del runtime y funde **sólo** `derived.json`. Los archivos de
área pasan a ser el insumo del transform. Los 7 estados de CHA-15 tienen que
seguir dando `Backlog · Por hacer · En curso · En revisión · Listo ·
Cancelada · Bloqueada` en `real-components.es-ar.test.tsx`, que es la prueba de
que no se rompió nada de lo que QA ya firmó.

**4. Revertir `tEs()`.** Las 36 llamadas en los 11 archivos de upstream vuelven
a literales planos, y las 18 claves de `explicit.json` pasan a `sites/es-AR.json`
con el archivo donde estaban. Es una reversión a mano, archivo por archivo,
comparando contra `git show bba6a45f0:<archivo>` para dejarlos **idénticos** a
upstream. Al terminar, `git diff bba6a45f0 -- ui/src --stat` no tiene que
mostrar nada fuera de `ui/src/i18n-es-ar/`, que es nuestro directorio.

**5. Seguir traduciendo.** Según §18.

### Verificación antes de entregar

```sh
pnpm --filter ui exec vitest run --config vitest.config.es-ar.ts
pnpm --filter ui exec vitest run src/i18n-es-ar
pnpm --filter ui exec vitest run src/i18n/locale-validation.test.ts   # 7/7
pnpm --filter ui exec tsc -b
# y en un workspace con las dependencias completas, lo que falta de §16:
pnpm --filter ui exec vite build --config vite.config.es-ar.ts
```

## 18. El orden de los lotes

**18.1 Las 1.221 largas siguen ahora mismo, sin esperar nada.** Son 4 palabras
o más: no tocan ninguno de los dos problemas de §12. Y no hay retrabajo: el
transform lee **el mismo** `dictionary/es-AR/*.json` con el mismo formato
`{"inglés": "español"}`. Todo lo que se traduzca hoy sirve igual mañana, y eso
está medido y no supuesto: las 494 entradas largas de `deff36b50` (CHA-25)
entran **494 de 494** sin tocarlas (§13.2).

**18.2 Las 2.328 cortas no entran al diccionario hasta que estén los pasos 1 a 3
de §17.** Esto es un portón, no una sugerencia. Mientras el shim de runtime
tenga el diccionario completo, agregar 2.328 cadenas cortas **es** la explosión
de colisiones de §12.2, con decisión nueva o sin ella: el riesgo que el dueño no
aceptó se materializa igual. El paso 3 (angostar el shim) es lo que lo cierra, y
tiene que estar antes.

**18.3 Con los pasos 1 a 3 cerrados, el orden de las cortas no importa para el
riesgo**, porque la colisión ya no existe por construcción. Queda el orden por
rendimiento, y ahí el del Lead está bien: `compartidos` primero, que rinde en
las doce pantallas a la vez.

**18.4 El mapa por sitio se llena cuando QA lo pide, no antes.** Las 345 cortas
multi-archivo van primero al diccionario global con **un** español, y sólo
cuando la pasada visual encuentre un género o un sentido equivocado se agrega
la entrada por sitio. Escribir 1.233 entradas por sitio a mano por si acaso es
trabajo tirado: la mayoría de esas cadenas (`"Copied"`, `"Connecting…"`,
`"API key"`, `"Download file"`) necesita un solo español.

## 19. Riesgos de la revisión 2

| Riesgo | Mitigación |
| --- | --- |
| Más máquina nuestra (~200 líneas más) | Verificada sobre los 1.173 archivos de producción (§16.1, §16.2). El parser es el que `vite` ya usa para su propio pipeline. |
| Un literal de lógica reescrito rompe la app | Lista negra dura que `forzar` no puede abrir (§14.1), más las guardas del paso 2 de §17. Verificado sobre `StatusIcon.tsx` (§16.5). Es el riesgo nuevo real de esta revisión y por eso tiene dos cercos. |
| Las etiquetas derivadas quedan en inglés | Se queda el shim con `derived.json` (§14.3). Es el contraejemplo de CHA-9, que sigue vivo (§13.1) y ahora está medido: 36 archivos. |
| Una cadena del servidor que sí queríamos traducir | Queda en inglés y se anota (§13.2: 4 casos en el corte 1). Si alguna importa, entra a `derived.json` contra el techo de 60. |
| El transform agrega tiempo al build | 0,66 ms por archivo, 777 ms el árbol completo (§16.2). Medir el `vite build` real antes de cerrar. |
| `upstream` cambia el formato de salida de `parseSync` | Es la API pública de `vite`, que ya es dependencia de `ui`. Si cambia, lo dice un test, no la producción. |
| Dos capas que hay que explicar | Es el costo honesto contra el criterio 3 de §3. Se paga porque la regla de corte es de una línea: **literal de nuestra fuente → compilación; etiqueta derivada en runtime → `derived.json`**. Nada vive en las dos. |

## 20. Lo que no se toca nunca (revisión 2)

Sigue la lista de §11, y se le agrega:

- `ui/src/i18n/locales/en.json` no se usa como insumo del transform. Las 3
  cadenas que upstream sirve por i18next van a `derived.json`.
- Los 11 archivos de upstream que hoy tienen `tEs()` vuelven a ser idénticos a
  upstream (paso 4 de §17) y no se vuelven a tocar.
- El mapa por sitio **no** es un lugar para meter traducciones de cadenas
  técnicas. Si una entrada necesita `forzar` y la cadena parece un
  identificador, está mal: se vuelve acá.

## 21. Qué queda para el Lead y para el dueño

Nada de esta revisión necesita una decisión del dueño antes de empezar, y eso es
a propósito: la superficie de colisión **baja** respecto del corte 1 (§14.3), así
que la aceptación que ya dio alcanza. Lo que sí tiene que decidir alguien:

1. **Para el Lead, decisión de alcance:** si se hace el paso 4 de §17 (revertir
   las 36 llamadas a `tEs()`). Es trabajo que no agrega una sola traducción
   nueva; lo que compra es dejar el fork en cero archivos de upstream tocados,
   que es el criterio 1 de §3. Mi recomendación es hacerlo, pero después de los
   pasos 1 a 3 y antes de empezar las cortas, porque si no hay que mantener los
   dos mecanismos a la vez.
2. **Para el dueño, sólo si quiere:** §14.4 habilita dejar Configuración en
   inglés **de verdad**, con sus 681 cadenas propias y también los botones
   compartidos que hoy se traducirían igual. Hoy eso no se puede y el `LEEME.md`
   del Lead lo anota como límite. No lo doy por pedido: el pedido original fue
   "Configuración queda en inglés", y esto lo cumpliría más de cerca. Si no
   contesta, el comportamiento es el mismo de hoy.
3. **Para el Lead, antes de cerrar la implementación:** conseguir un workspace
   con las dependencias de `packages/shared` instaladas para correr el
   `vite build --config vite.config.es-ar.ts` que §16 no pudo correr. Es lo
   único de esta decisión que queda sin verificar en un build real.
