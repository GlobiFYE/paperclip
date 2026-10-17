# ADR 0002 — Marcar el texto de la interfaz en tiempo de compilación

- **Estado:** Aceptado
- **Fecha:** 2026-10-17
- **Decide:** Arquitecto (Chanchu Labs)
- **Ejecuta:** Dev UX/UI
- **Alcance:** fork `es-ar/corte2`, sobre `es-ar/deploy-2cc79923` (overlay del
  corte 1 sobre `2cc79923`, el commit que corre la instancia del dueño)
- **Reemplaza:** la frontera de traducción de [ADR 0001](0001-traduccion-es-ar-por-overlay-en-jsx.md)
  (§5d y §8 fase 1). Todo el resto de ADR 0001 sigue vigente, en particular
  **§7 (convención de claves)** y **§11 (lo que no se toca nunca)**.
- **Tarea:** CHA-20, dentro de CHA-19 (corte 2). Pedido del dueño en CHA-1.

## 1. Contexto

El corte 1 está en producción y traduce bien. Al ofrecerle el corte 2 al dueño
se le avisó, textual:

> «la limitación que aceptaste para el corte 1 **no se estira sola**: el overlay
> traduce cualquier texto que pase por React, incluido lo que escribís vos o un
> agente si coincide con una entrada del diccionario. Hoy pasa con 7 de 26
> nombres probados. Con la interfaz completa el diccionario tendría 891 palabras
> sueltas, y ahí casi cualquier título corto en inglés se da vuelta.»

Eligió el corte 2 con esa advertencia a la vista. Éste es el ADR de esa
decisión. El plan del corte 2 ([corte2.md](../i18n-es-ar/corte2.md)) pone esta
pieza **antes** de seguir traduciendo pantallas, y el motivo es aritmético:
traducir más entradas sin blindar es agrandar el defecto a propósito.

## 2. El problema, con precisión

`ui/src/i18n-es-ar/jsx-runtime.ts` intercepta el runtime de JSX: toda cadena que
React está a punto de renderizar pasa por el diccionario. En ese punto, una
etiqueta del componente y un dato de la API son **indistinguibles**: las dos
llegan como `string` en la misma propiedad del mismo objeto de props.

```
<span>{agent.name}</span>        →  jsx("span", { children: "Search" })
<span>Search</span>              →  jsx("span", { children: "Search" })
                                            └── el shim ve exactamente lo mismo
```

El resultado medido es el de CHA-9: un agente que se llama *Search* aparece como
*Buscar* en su propia tarjeta.

Importante: **no es un problema de cobertura del diccionario, es de posición.**
No se arregla sacando palabras del diccionario, porque las palabras que colisionan
(*Search*, *Done*, *Open*, *Settings*) son justamente las que más hay que
traducir. Y empeora solo: cuanto mejor el diccionario, peor el defecto.

Hay un segundo portador del mismo defecto, y es peor que los literales:
`patterns.ts`. Un patrón anclado como `/^Invite people to (.+)$/` convierte una
sola regla en infinitas cadenas de usuario traducibles — cualquier título de
tarea que tenga esa forma se da vuelta.

## 3. Criterio de decisión

El mismo de ADR 0001 §3, en el mismo orden, más uno nuevo que impuso el pedido:

1. **Cuántos archivos de upstream tocamos.** Tope de ~50 líneas de ADR 0001;
   gastadas **36 líneas en 12 archivos**; quedan **14**.
2. Costo de agregar una cadena nueva en el día a día (hoy: una línea en un JSON
   nuestro; no puede empeorar).
3. Que no quede un segundo mecanismo que haya que explicar.
4. **La garantía tiene que ser estructural, no estadística.** Una lista negra que
   «casi nunca» se equivoca no sirve: el dueño vería el nombre de su empresa
   traducido una vez cada tanto, sin poder predecir cuándo.

## 4. La pregunta correcta

El runtime no puede distinguir etiqueta de dato. **El compilador sí**, y gratis:
la etiqueta está escrita en el archivo `.tsx` y el dato no existe hasta que
contesta la API. Toda la decisión sale de ahí:

> El overlay deja de traducir «toda cadena que pasa por React» y pasa a traducir
> **«toda cadena que está escrita en el código fuente de la interfaz»**.

La invariante que compra, y que es la razón de ser de este ADR:

> **Sólo se traduce una cadena que está escrita, carácter por carácter, en el
> código fuente de `ui/src`, en un sitio declarado como sitio de texto.** El
> contenido que escribe una persona o un agente llega en tiempo de ejecución, no
> es un literal del código, no pasa por ningún sitio marcado y por lo tanto **no
> se puede traducir**. No es un filtro que acierta casi siempre: es que el dato
> nunca entra a la máquina.

## 5. Opciones evaluadas

### (a) Lista negra en runtime: no traducir lo que «parece un dato»

Heurísticas sobre la cadena (mayúsculas, largo, que no tenga espacios) o sobre
el componente que la rinde. **Rechazada por el criterio 4**: no hay heurística
que separe el agente llamado *Search* del botón *Search*, porque son la misma
cadena. Y falla en las dos direcciones a la vez (deja datos traducidos y deja
interfaz sin traducir), lo que la hace imposible de verificar para QA.

### (b) Higiene del diccionario: sacar las palabras peligrosas

Prohibir en el diccionario toda cadena corta y ambigua, y mandarla al escape
`tEs()` de ADR 0001 §7.5. Es lo que ADR 0001 §7.3 ya dice en chico.
**Rechazada**: el escape cuesta una edición de upstream por sitio. Medido sobre
el diccionario de hoy, las entradas que colisionan con contenido plausible son
decenas; el presupuesto que queda es de 14 líneas. Y no cierra: ninguna lista de
«palabras peligrosas» puede anticipar cómo va a llamar el dueño a su próximo
agente.

### (c) Marcar los datos en vez del texto

Enganchar la capa HTTP y juntar en un `Set` toda cadena que vino de la API; el
overlay se niega a traducir lo que esté en ese `Set`. Se puede hacer sin tocar
upstream. **Rechazada por el criterio 4**: el idioma de la interfaz pasaría a
depender de los datos. La barra lateral diría *Buscar* hasta que exista un agente
llamado *Search*, y a partir de ahí *Search*, sin que nadie cambie una línea.
Imposible de verificar y peor de explicar.

### (d) `tEs()` en todos lados (ADR 0001 §7.5 a escala)

Externalizar a mano cada etiqueta. Es correcto y es exactamente lo que ADR 0001
§4 rechazó: son los 700 `.tsx` de upstream otra vez. **Rechazada por el criterio
1.**

### (e) Marcado en tiempo de compilación — **elegida**

Un plugin de Vite nuestro reescribe el código fuente **antes** de que Vite lo
compile, y envuelve los literales de cadena que upstream escribió como texto de
interfaz:

```tsx
// lo que está escrito en el archivo de upstream (no se toca)
<div title="Save"><h1>Create your first organization</h1><span>{agent.name}</span></div>

// lo que compila Vite en el build es-AR
<div title={__tEs("Save")}><h1>{__tEs("Create your first organization")}</h1><span>{agent.name}</span></div>
```

`agent.name` no es un literal: no hay dónde ponerle la llamada. El dato queda
estructuralmente afuera.

Tres propiedades que la hacen ganar, además de resolver el problema:

1. **Cero ediciones de upstream, hoy y siempre.** Igual que ADR 0001: se activa
   desde `ui/vite.config.es-ar.ts`, que ya existe y **no cambia**. Y va más
   lejos: las 36 líneas ya gastadas en 12 archivos de upstream quedan
   recuperables (§9).
2. **Sacamos la máquina del camino de render de React.** Hoy somos una función
   que corre en cada `jsx()` de cada render; después del cambio no corremos en
   render: el costo es de build y la cadena ya viene resuelta. `jsx-runtime.ts`
   se borra, con su hack de `resolveId` y su guarda de recursión.
3. **La cobertura crece sin tocar upstream.** Lo que se puede traducir está
   declarado en **un archivo nuestro** (`text-sites.ts`). Ampliar cobertura en
   el corte 2 es agregarle un nombre a ese archivo, no editar un componente.

## 6. Qué se verificó

Todo lo que sigue se corrió el 2026-10-17 sobre el worktree
`/paperclip/workspaces/es-ar-corte2`, en el estado del commit `9c2d1cd12`, que ya
incluye el diccionario de Configuración de CHA-21. **Los archivos de prueba se
escribieron fuera del repo** (`$PAPERCLIP_SCRATCH_DIR`) y el árbol del worktree
quedó intacto: la implementación es de Dev UX/UI.

Las mediciones no son de un prototipo aparte: el recolector que las produce
implementa las reglas de §7 y las listas de §8/1 tal como están escritas, así que
**cualquiera de estos números se vuelve a sacar** corriendo el reporte de
§8/fase 3 una vez implementado. Donde un número dependa del diccionario, que se
está escribiendo en paralelo, está dicho.

**6.1 — Corrección a un dato del enunciado: acá no hay Babel.** El enunciado de
CHA-20 daba por verificado que `@vitejs/plugin-react` es Babel y que por eso una
transformación de compilación es posible. La conclusión es correcta; el medio,
no. La versión instalada es **`@vitejs/plugin-react` 6.1.1 sobre Vite 8.2.2**, que
es la variante **oxc**: sus tipos (`dist/index.d.ts`) exponen `include`,
`exclude`, `jsxImportSource`, `jsxRuntime`, `reactRefreshHost` y `compiler`, y
**no** hay opción `babel` ni el hook `api.reactBabel` de la v4. `@babel/core`
resuelve sólo por acarreo del store de pnpm, no está declarado en
`ui/package.json`, y `ui/package.json` no se toca (§11 de ADR 0001). O sea: el
camino «le pasamos un plugin de Babel al plugin de React» **no existe** en este
repo.

**6.2 — El parser sale de una dependencia que ya está declarada.** `vite` exporta
`parseAst` (el parser de oxc), y `vite ^8.2.2` está en `devDependencies` de
`ui/package.json` (que no se toca: se usa lo que ya está declarado). Se parsearon
**los 2.023 archivos `.ts`/`.tsx` de `ui/src`** (1.211 `.tsx` + 812 `.ts`) con
`parseAst(code, { lang })`: **0 fallos**. Los offsets `start`/`end` son índices de
cadena de JavaScript (UTF-16), así que `code.slice(start, end)` es exacto y se
puede editar por rangos —lo confirma §6.4, que reescribe 737 archivos reales,
llenos de acentos y de comillas tipográficas, y los vuelve a parsear sin un solo
fallo. Resultado: **cero dependencias nuevas** y el mismo parser que usa el
bundler.

**6.3 — El universo de literales, medido.** Sobre los 1.268 archivos que el
plugin marca (§8/3: sin tests, sin stories, sin `src/fixtures/`, sin nuestro
propio directorio salvo `LanguageSelector.tsx`):

| | |
| --- | ---: |
| ocurrencias de texto de JSX con contenido | 8.564 |
| …distintas | 5.649 |
| literales de cadena en atributos de JSX | 33.994 |
| …nombres distintos de atributo | 326 |
| de ésos, `className` solo | 21.526 |
| nombres (de atributo o de propiedad) con ≥4 valores que son texto | 137 |

La lectura que importa: **no se puede marcar «todo literal»** (`className` sola
es el 60 % de los literales de atributo, y están los `fetch("/api/…")`, los
`queryKey`, los valores de API). Marcar tiene que ser por **sitio declarado**.

**6.4 — El marcado corre sobre el código real y no lo rompe.** El transform de §8,
con las listas con las que se entrega (§8/1), sobre todo `ui/src`:

| | |
| --- | ---: |
| archivos vistos | 1.268 |
| archivos con ediciones | 737 |
| sitios marcados | **19.547** |
| textos salteados por una entidad desconocida | **0** |
| fallos al reparsear la salida | **0** |
| archivos con corrimiento de números de línea | **0** |

Por tipo de sitio: texto de JSX 8.448 · atributos 3.371 · propiedades de objeto
3.073 · literales dentro de un `{…}` en JSX 3.165 · llamadas 186 · declaraciones
(§7.2) 134 · formatos (plantillas con interpolación) 1.161. La tabla de entidades
de §8/1 cubre las que existen hoy en `ui/src`, así que no quedó ni un texto sin
marcar por ese motivo. Tiempo: 10 s para los 1.268 archivos **incluyendo**
escribir y reparsear cada salida, que es trabajo de la prueba y no del build; en
`vite dev` se paga por archivo cargado.

**6.5 — El render sale idéntico, y el dato se salva.** Se escribió un componente
con todos los tipos de sitio, se lo marcó con el transform, se compiló con esbuild
(JSX automático) y se rindió con `react-dom/server`, contra el mismo componente
sin marcar. **20 de 20 comprobaciones pasan.** Los datos del caso están elegidos
para colisionar a propósito: el agente **se llama `Search`** y la tarea **se
titula `Save`**, que son dos entradas del diccionario.

El render completo, lado a lado, recortado donde importa:

```
inglés:  <h1>Search</h1><span>Search</span><input placeholder="Search tasks…" aria-label="Search" value="Save"/>
es-AR:   <h1>Buscar</h1><span>Search</span><input placeholder="Buscar tareas…" aria-label="Buscar" value="Save"/>
              │              └── el agente se llama "Search": queda          └── el título de la tarea: queda
              └── la etiqueta de interfaz: se traduce
```

Es el ADR entero en una línea: **la misma palabra, `Search`, se traduce como
etiqueta y no se traduce como dato, en el mismo render**. Lo mismo con `Save`:
`title="Save"` pasa a `title="Guardar"` mientras `value="Save"` queda intacto.

Lo demás que quedó probado en ese render: `value="Done"` (valor de API) intacto
mientras el texto `Done` del mismo `<option>` pasa a `Listo`; `<code>` y `<pre>`
anidado intactos; `className` y `data-kind` intactos; el espacio entre
`<b>a</b> <i>b</i>` conservado; el literal de una rama de `?:` traducido; la
propiedad `label` de un objeto traducida; la plantilla con interpolación traducida
conservando el valor interpolado (`Invitar gente a Search`, con el nombre sin
tocar); el valor por defecto de un prop desestructurado traducido; las entidades
decodificadas y traducidas (`Tasks &amp; Projects &rarr; Done` →
`Tareas y Proyectos → Listo`); y la **estructura de etiquetas idéntica** a la del
inglés, comparando sin texto y sin valores de atributo.

**6.6 — La prueba en negativo.** En el mismo render, un mapa de etiquetas local
(`statusLabels`) que **no** está declarado en `TEXT_DECLS` queda en inglés
(`<b>In Progress</b>`). Es la verificación de que el canal de declaraciones hace
falta de verdad y de que nada se marca por accidente: si ese mapa saliera
traducido sin haberlo declarado, querría decir que el transform está marcando más
de lo que dice §7.2. Es también la forma exacta de la pérdida de §10.5, y la
razón por la que `statusLabel` está seedeado en §8/1.

**6.7 — Cuánto del diccionario de hoy sigue traduciéndose.** Se juntaron todas las
cadenas que el transform marca y se cruzaron con el diccionario es-AR del árbol de
trabajo (624 entradas, todas literales), aplicando la regla de espacios al borde de
ADR 0001 §7.1. Dos corridas: con las listas **mínimas** (sólo los nombres que la
medición de §6.3 pedía) y con las listas **que se entregan** en §8/1, que ya
incluyen todo lo que §10 prescribe:

| | listas mínimas | listas de §8/1 |
| --- | ---: | ---: |
| cadenas distintas marcadas | 11.080 | 11.173 |
| formatos distintos | 773 | 788 |
| entradas del diccionario **cubiertas** | 588 | **613** |
| no cubiertas | 36 | **11** |

O sea: **el 98,2 % del diccionario del corte 2 se traduce con el esquema nuevo**, y
las 25 entradas que separan una columna de la otra se recuperaron **agregando
nombres y declaraciones a un archivo nuestro, sin tocar un solo archivo de
upstream**. Las 11 que quedan están clasificadas una por una en §10: **sólo una es
una pérdida real**, y dos más son deliberadas.

Un dato que vale más que el total, porque el diccionario se está escribiendo en
paralelo (CHA-21) y creció mientras se medía: entre la primera corrida y la última
pasó de **472 a 624 entradas**, y las entradas nuevas quedaron cubiertas casi todas
solas, sin agregar un nombre. El esquema no sólo sostiene la cobertura de hoy:
absorbe el corte 2 a medida que se escribe. Los números absolutos son una foto; el
que se queda es el reporte de §8/fase 3, que los vuelve a sacar cuando haga falta.

**6.8 — La regla de la comparación cuesta 0,56 %.** El riesgo nuevo del marcado
en compilación es que el valor traducido exista **antes** de la lógica y rompa una
comparación (`item.label === "Done"`). Medido: **10 entradas del diccionario**
aparecen además como operando de comparación en `ui/src` (*Delete*,
*None*, *Paused*, *Revoke*, *Inbox*, *unread*, *Tasks*, *Organization*, *Home*,
*Review request*). La regla de §7.4 (no marcar, en un archivo, una cadena que ese
mismo archivo compara) bloquea **104 de 18.477 marcas literales = 0,56 %**, en 75
cadenas distintas, y casi todas son identificadores técnicos que nunca van a estar
en el diccionario (`latest`, `routine`, `stdout`, `init`). Se adopta: elimina una
clase entera de rotura por medio punto porcentual de cobertura.

**6.9 — Línea de base.** Lo que no puede cambiar y por qué este ADR no lo toca:
`vitest run src/i18n/locale-validation.test.ts` sigue 7/7 porque no se toca
`locales/`; los 684 archivos de test de upstream siguen en inglés porque
`ui/vitest.config.ts` no carga plugins y el transform es un plugin; y §8 excluye
explícitamente los `*.test.tsx` del marcado, así que una fixture inglesa sigue
siendo inglesa incluso bajo la config es-AR.

## 7. El diseño

### 7.1 Qué queda y qué se va

| | Antes (ADR 0001) | Después |
| --- | --- | --- |
| Dónde se traduce | runtime, en cada `jsx()` | build, en el literal |
| Qué puede traducirse | toda cadena que pasa por React | sólo literales en sitios declarados |
| Datos del usuario | traducibles por colisión | **imposibles de traducir** |
| `jsx-runtime.ts` | el shim | **se borra** |
| `resolveId` de `react/jsx-runtime` | necesario | **se borra** |
| Clave del diccionario | la cadena inglesa exacta | **igual** (ADR 0001 §7.1) |
| Archivos de `dictionary/` | por área | **igual** |
| `tEs()` (§7.5) | el escape | **igual** |
| Costo por cadena nueva | una línea en un JSON | **igual** |

El diccionario **no cambia de forma**. Es la razón principal por la que esta
opción se puede ejecutar en paralelo con CHA-21: el Traductor no se enterá.

### 7.2 Los cuatro sitios de texto

Viven en `ui/src/i18n-es-ar/text-sites.ts`, que es nuestro. Cada uno sale de la
medición de §6.3 y §6.7, no de la intuición.

| Sitio | Qué marca | Cubre |
| --- | --- | ---: |
| **texto de JSX** | el texto escrito entre etiquetas, y los literales dentro de un `{…}` en posición de hijo | 11.613 literales |
| **nombres** | el literal cuyo **nombre de atributo de JSX** o **clave de propiedad de objeto** está en la lista de nombres de texto | 6.444 |
| **llamadas** | los literales en los argumentos de las llamadas listadas (`window.confirm`, `toast.error`, `setActionError`, …) | 186 |
| **declaraciones** | los literales dentro de declaraciones nombradas de archivos listados: los mapas indexados por valor técnico y las funciones que derivan etiquetas | 134 |

Más **1.161 formatos** (§7.5), repartidos entre los mismos cuatro sitios. Total
medido: 19.547 marcas (§6.4).

El mismo nombre sirve para atributo de JSX y para propiedad de objeto, pero las
listas son **dos**, porque los datos dicen que el mismo nombre cambia de
naturaleza según dónde esté: `@action` lleva texto 28 veces y nunca otra cosa,
mientras `.action` lleva clases de Tailwind 113 veces y texto 16.

### 7.3 Lo que nunca se marca

- Toda cadena que no sea un literal del código. Es la invariante de §4.
- Claves de objeto (`{ "Search": … }`), fuentes de `import`/`export`, y todo
  nombre de atributo o propiedad que no esté en las listas — o sea `className`,
  `to`, `href`, `type`, `value`, `id`, `name`, `data-*`, `path`, `variant`,
  `size`, `role`: no hay lista negra, hay lista blanca, y la lista blanca es
  nuestra.
- Nada dentro de `<code>` ni de `<pre>`, a **cualquier** profundidad (el shim
  miraba sólo el elemento inmediato; esto es más estricto).
- Los argumentos de funciones que no estén en la lista de llamadas. En
  particular no se entra en `t("clave")`, `cn("flex")` ni `fetch("/api/…")`.
- Las cadenas que §7.4 bloquea.

### 7.4 La regla de la comparación

> Si una cadena aparece en un archivo como operando de `===`, `!==`, `==`, `!=`,
> de un `case`, o de `.includes/.indexOf/.startsWith/.endsWith/.has/.get`,
> **en ese archivo no se marca en ningún sitio**.

Es la mitigación del único riesgo nuevo que trae mover el marcado al build: que
el español llegue antes que la lógica. Cuesta 0,56 % de cobertura (§6.8) y se
degrada a inglés, que es la dirección segura. No hay lista de excepciones a mano
que haya que mantener: la regla la aplica el transform.

### 7.5 Interpolación: formatos en vez de patrones

Las plantillas con interpolación en un sitio de texto se marcan por su **forma
estática**, que es lo único que el compilador vio:

```tsx
<p>{`Invite people to ${company}`}</p>
// marcado:
<p>{__tEsFmt(["Invite people to ", ""], [company])}</p>
// clave de diccionario:  "Invite people to {0}"  →  "Invitar gente a {0}"
```

El valor interpolado **nunca** pasa por el diccionario: se pega después. Las
entradas de formato viven en los mismos archivos de área que las literales (una
clave es de formato si contiene `{0}`, `{1}`, …), así que no hay archivo nuevo ni
forma nueva para el Traductor.

Esto reemplaza a `patterns.ts`, y es media razón de ser de este ADR: un patrón
`/^Invite people to (.+)$/` que corre contra cualquier cadena del runtime es la
forma más peligrosa del defecto de §2 —una sola regla vuelve traducibles
infinitas cadenas de usuario—. **`patterns.ts` queda congelado**: sigue
funcionando (corre dentro de `lookup`, ahora sólo contra cadenas marcadas) pero no
recibe entradas nuevas.

Los **9 patrones de hoy** (6 de CHA-4 más 3 de CHA-21), cruzados contra lo que el
transform marca:

| Patrón | Qué le pasa |
| --- | --- |
| `Select an organization to view …`, `Invite people to …` | tienen **las dos** formas: 19 y 3 cadenas completas como literales, y además el formato. Quedan cubiertos dos veces |
| `Change view — currently …`, `… is archived`, `Switched to …`, `Stored in Paperclip file storage for …` | se migran a **formato**, uno a uno |
| `Select a company to view …` | las 7 cadenas que puede producir están escritas completas en el código: queda cubierto como **literal**, el patrón sobra |
| `Are you sure you want to remove the … adapter?`, `… you want to uninstall …?` | **nunca pegaron y no van a pegar.** La oración está partida en tres hijos de JSX (`…remove the <strong>{tipo}</strong> adapter?`), así que al runtime nunca le llegó entera y el patrón anclado no podía matchear. Son letra muerta hoy |

Migrar los seis es trabajo de diccionario, del Traductor, no de Dev UX/UI.

**Los contados abiertos (`{n} agents`, `{n} places`): respuesta a la pregunta del
Lead** (bitácora del corte 2, «pendiente de respuesta del Arquitecto»).

Van por **formato, no por patrón**, y con eso el problema de
`overlay.test.ts:247` deja de existir: ese test deriva el singular de un patrón
cambiando `(\d+)` por `1` sin despluralizar, así que ningún patrón con número lo
pasaría. No hace falta arreglarlo ni relajarlo —**hoy pasa en vacío, porque
ninguno de los 9 patrones tiene `\d`**, y con `patterns.ts` congelado no va a
haber un décimo. El test se queda como guarda del conjunto congelado.

La razón de fondo es que con el marcado **no hay que derivar nada**: la clave es
lo que el compilador vio escrito, y el plural ya viene resuelto por el código.
Las dos formas que existen en `ui/src`, medidas:

1. **El código elige la palabra entera.**
   `weeks === 1 ? "1 week" : \`${weeks} weeks\`` produce **dos claves
   independientes**: el literal `"1 week"` y el formato `"{0} weeks"`. No hay
   derivación posible ni necesaria, y el Traductor ve las dos. Es el caso de
   §10.2.
2. **El código interpola el sufijo.** `` `${n} item${n === 1 ? "" : "s"} found.` ``
   da la clave `"{0} item{1} found."`, donde `{1}` vale `""` o `"s"`. **52
   formatos tienen esta forma** (26 empiezan con el número). Se traducen
   reusando el hueco: `"{0} ítem{1} encontrado{1}"`, que funciona porque el
   español también pluraliza con `-s`. Donde no alcance —plural irregular, o
   concordancia de género— el escape es `tEs()` (§7.5 de ADR 0001).

O sea: los contados **sí tienen salida por diccionario**, y no cuestan ni una
línea de upstream. Lo que sí hay que agregar, cuando se implemente, es una
validación propia de formatos en el test de diccionario —que los huecos de la
traducción sean un subconjunto de los de la clave—, porque la regla vieja del
singular al lado no aplica a esta forma.

## 8. Instrucciones de implementación

Para Dev UX/UI. Está todo decidido; no hace falta volver a elegir nada. El código
de abajo es el que se corrió en §6.4–§6.6, con los nombres y las rutas que
prescribe este ADR.

### Fase 1 — La máquina

**Archivos, en este orden.** Los cinco primeros son nuestros y nuevos o
modificados; ninguno es de upstream.

#### 1. `ui/src/i18n-es-ar/text-sites.ts` (nuevo)

Las listas salen de la medición de §6.3/§6.7. Se seedean así y crecen agregando
nombres, nunca editando upstream.

```ts
/** Nombres de atributo de JSX cuyo valor literal es texto para una persona. */
export const TEXT_ATTRS: ReadonlySet<string> = new Set([
  "label", "aria-label", "ariaLabel", "title", "placeholder", "description",
  "message", "hint", "body", "alt", "tooltip", "subtitle", "heading",
  "footnote", "eyebrow", "action", "emptyMessage", "searchPlaceholder",
  "allLabel", "noneLabel", "copiedLabel", "badgeLabel", "errorMessage",
  "error", "approveLabel", "rejectLabel", "requestedAccess",
]);

/** Claves de propiedad de objeto cuyo valor literal es texto para una persona. */
export const TEXT_KEYS: ReadonlySet<string> = new Set([
  "label", "title", "description", "body", "message", "hint", "detail", "text",
  "tooltip", "tagline", "short", "subtitle", "heading", "placeholder",
  "runningLabel", "completedLabel", "failedLabel", "interruptedLabel",
  "managedLabel", "moreLabel", "lessLabel", "eyebrow", "gets", "reason",
]);

/** Llamadas cuyos argumentos literales son texto para una persona. */
export const TEXT_CALLS: ReadonlySet<string> = new Set([
  "window.confirm", "confirm", "alert",
  "toast", "toast.error", "toast.success", "toast.info", "toast.warning",
  "errorMessage", "reportSkillError",
  "setError", "setActionError", "setOpenError", "setSelectionError",
  "setAnnouncement",
  // Acumuladores de texto: el literal es argumento de `.push`, no inicializador,
  // así que no lo alcanza `TEXT_DECLS` (§10, tabla de recuperadas).
  "deleteImpactNotes.push",
]);

/**
 * Declaraciones nombradas de upstream cuyos literales (o cuyo retorno) son
 * etiquetas. Es el canal para los mapas indexados por valor técnico y para las
 * funciones que derivan una etiqueta de un valor de API: la lista vive acá, así
 * que cubrirlos cuesta **cero ediciones de upstream**.
 *
 * `file` es relativo a `ui/`. Si un nombre no aparece en el archivo, el plugin
 * **falla el build**: un `git pull` que lo renombre se tiene que ver como error,
 * no como media pantalla en inglés.
 */
export interface TextDecl {
  file: string;
  names: readonly string[];
}

export const TEXT_DECLS: readonly TextDecl[] = [
  // Las etiquetas del menú de estado y de los encabezados del tablero no salen
  // de ningún mapa: se derivan del valor técnico. Es el hallazgo de CHA-15.
  { file: "src/components/StatusIcon.tsx", names: ["statusLabel"] },
  { file: "src/components/KanbanBoard.tsx", names: ["statusLabel"] },
  { file: "src/components/ActivityCharts.tsx", names: ["statusLabels"] },

  // Mapas indexados por un valor técnico: la clave es del API, el valor es
  // etiqueta. Son los que ADR 0001 cubría con `tEs()` dentro de upstream.
  { file: "src/components/decision-models/DecisionModelSettings.tsx", names: ["failureMessages"] },
  { file: "src/components/task-chat/composer-run-settings.ts", names: ["EFFORT_LABELS"] },
  { file: "src/components/onboarding/Stepper.tsx", names: ["ONBOARDING_STEP_LABELS"] },

  // Declaraciones locales que arman una etiqueta antes de que llegue al JSX.
  { file: "src/pages/InstanceGeneralSettings.tsx", names: ["label", "visibleActionError"] },
  { file: "src/components/SidebarAccountMenu.production.tsx", names: ["secondaryLabel"] },
  { file: "src/pages/ProfileSettings.tsx", names: ["uploadHint"] },
  { file: "src/components/TaskChatThread.tsx", names: ["detail"] },
  { file: "src/components/WorkspaceFileBrowser.tsx", names: ["announcement"] },

  // Función que devuelve el motivo por el que no se puede borrar un entorno.
  { file: "src/pages/CompanyEnvironments.tsx", names: ["environmentDeleteBlockMessage"] },
];

/** Elementos cuyo contenido es código: no se marca nada adentro (ADR 0001 §7.3). */
export const OPAQUE_ELEMENTS: ReadonlySet<string> = new Set(["code", "pre"]);

/**
 * Las 13 entidades HTML que hoy aparecen en el texto de JSX de upstream
 * (medidas), más `&lsquo;` y `&nbsp;` por las dudas. Hay que decodificarlas para
 * que la cadena marcada sea igual a la que React rinde. Una entidad fuera de esta
 * tabla y de las numéricas (`&#NNN;`, `&#xHH;`) hace que ese texto **no se
 * marque**, y el reporte de la fase 3 lo lista.
 */
export const ENTITIES: Readonly<Record<string, string>> = {
  "&apos;": "'", "&amp;": "&", "&quot;": '"', "&gt;": ">", "&lt;": "<",
  "&ldquo;": "“", "&rdquo;": "”", "&lsquo;": "‘",
  "&rsquo;": "’", "&rarr;": "→", "&rsaquo;": "›",
  "&middot;": "·", "&hellip;": "…", "&times;": "×",
  "&nbsp;": " ",
};
```

#### 2. `ui/src/i18n-es-ar/mark-text.ts` (nuevo)

El transform. Función pura `markText(code, lang)`: devuelve el código marcado o
`null` si no hubo nada que marcar. Reglas que **no** se pueden cambiar sin volver
a este ADR:

- **Edición por rangos, nunca reimpresión del AST.** Se juntan las ediciones
  `{start, end, text}`, se descartan las anidadas y se aplican en una pasada. Así
  el código sale igual al de upstream salvo en los puntos marcados.
- **Toda edición conserva la cantidad de saltos de línea del rango que
  reemplaza** (se rellena con `\n` al final del reemplazo si hace falta). Es lo
  que mantiene los números de línea, que es lo que mantiene el stack trace y el
  `lineNumber` de React en dev. Verificado: 0 corrimientos en los 737 archivos que se reescriben.
- **El `import` se inyecta en el offset 0, sin salto de línea**, y sólo si hubo
  al menos una edición.
- Los literales se emiten con `JSON.stringify`.

```ts
import { parseAst } from "vite";

import {
  ENTITIES, OPAQUE_ELEMENTS, TEXT_ATTRS, TEXT_CALLS, TEXT_DECLS, TEXT_KEYS,
} from "./text-sites";

const IMPORT =
  'import { translate as __tEs, formatted as __tEsFmt } from "@/i18n-es-ar/overlay";';

/**
 * El valor de un texto de JSX: lo que React termina rindiendo. Las líneas
 * posteriores a la primera pierden la sangría, las anteriores a la última pierden
 * el espacio final, las vacías se caen y el resto se une con un espacio. Sin
 * esto, marcar texto de varias líneas cambiaría lo que se ve.
 */
export function jsxTextValue(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] as string;
    if (i > 0) line = line.replace(/^[ \t]+/, "");
    if (i < lines.length - 1) line = line.replace(/[ \t]+$/, "");
    if (line !== "") parts.push(line);
  }
  return parts.join(" ");
}

/** Decodifica las entidades de la tabla y las numéricas. `undefined` si aparece
 *  una que no conoce: ahí ese texto no se marca. */
export function decodeEntities(value: string): string | undefined {
  let out = "";
  let at = 0;
  for (const m of value.matchAll(/&[#\w]+;/g)) {
    const found = ENTITIES[m[0]] ?? numeric(m[0]);
    if (found === undefined) return undefined;
    out += value.slice(at, m.index) + found;
    at = (m.index as number) + m[0].length;
  }
  return out + value.slice(at);
}

function numeric(entity: string): string | undefined {
  const dec = /^&#(\d+);$/.exec(entity);
  if (dec) return String.fromCodePoint(Number(dec[1]));
  const hex = /^&#x([0-9a-f]+);$/i.exec(entity);
  if (hex) return String.fromCodePoint(Number.parseInt(hex[1] as string, 16));
  return undefined;
}
```

El recorrido, con la forma exacta del prototipo verificado:

- `wrap(node, kind, braces)` — envuelve un literal:
  - `Literal` de cadena no vacía → `__tEs("…")`, entre llaves si el nodo es el
    valor directo de un atributo de JSX (`label="Save"` → `label={__tEs("Save")}`;
    sin las llaves el archivo no compila).
  - `TemplateLiteral` **con** interpolación → `__tEsFmt([quasis], [exprs])`
    (§7.5). Sin interpolación lo cubre el caso literal.
  - Nodos de paso, donde el literal puede estar en una rama:
    `ConditionalExpression` (las dos ramas), `LogicalExpression` (los dos lados),
    paréntesis, secuencia (el último).
  - **Nada más.** No se entra en llamadas, objetos ni arreglos: es lo que deja
    afuera los literales técnicos.
- `JSXElement` → nombre del elemento; si él o algún ancestro está en
  `OPAQUE_ELEMENTS`, no se marca nada del subárbol.
  - atributos: si el nombre está en `TEXT_ATTRS`, `wrap` del valor (literal con
    llaves, o la expresión de adentro del `{…}`).
  - hijos: `JSXText` → `jsxTextValue` + `decodeEntities`; si queda vacío o sólo
    espacios, no se toca; si `decodeEntities` devuelve `undefined`, no se toca y
    se cuenta. Si queda texto, se reemplaza **todo el rango** del `JSXText` por
    `{__tEs("…")}`.
  - hijos `{…}` → `wrap` de la expresión.
- `Property` no computada con clave en `TEXT_KEYS` → `wrap` del valor. **Si el
  valor es un `AssignmentPattern`** —o sea un prop desestructurado con valor por
  defecto, `{ moreLabel = "Show more" }`— se envuelve el lado derecho, no el
  patrón. Es una forma de sitio fácil de pasar por alto y que sí lleva texto:
  sin esta línea, `FoldCurtain` se queda en inglés (§10, tabla de recuperadas).
- `CallExpression` cuyo callee (`foo`, `foo.bar`) está en `TEXT_CALLS` → `wrap`
  de cada argumento.
- `TEXT_DECLS`: para el archivo en curso, por cada nombre listado se busca la
  declaración o binding con ese nombre (de cualquier nivel):
  - `const`/`let` → se envuelven los literales del inicializador a cualquier
    profundidad, **nunca las claves**;
  - `function` → se envuelve el argumento de cada `return` de su cuerpo (no de
    las funciones anidadas);
  - parámetro con valor por defecto → se envuelve el valor por defecto.
  - Si el nombre no está en el archivo: `throw`, con la ruta y el nombre.
- **Regla de la comparación (§7.4):** antes de marcar, se junta el conjunto de
  cadenas que ese archivo usa como operando de comparación; ninguna edición puede
  marcar una cadena de ese conjunto.

#### 3. `ui/src/i18n-es-ar/vite-plugin.ts` (cambia)

Se renombra a `paperclipEsArTextMarking()` (nombre del plugin:
`"paperclip-es-ar-marcado-de-texto"`), **se borra el hook `resolveId`** completo
—ya no hay shim que inyectar— y se agrega el marcado al `transform`, que conserva
tal cual la reescritura de la marca `in-bundle` de `overlay.ts`.

```ts
const MARK = /\.tsx?$/;

function marks(id: string): boolean {
  if (!MARK.test(id)) return false;
  if (!id.includes("/src/")) return false;
  if (/\.test\.tsx?$|\.stories\.|\/src\/fixtures\//.test(id)) return false;   // ← fixtures y tests son datos
  if (id.includes("/i18n-es-ar/") && !id.endsWith("LanguageSelector.tsx")) return false;
  return true;
}
```

Y en `transform(code, id)`: primero el caso de `overlay.ts` (igual que hoy,
incluido el `throw` si falta la marca), y si no, `if (!marks(id)) return null;` y
`return markText(code, id.endsWith("x") ? "tsx" : "ts")`.

Por qué cada exclusión:

- `*.test.tsx` y `src/fixtures/**`: en un test, un literal inglés es una
  **fixture**, o sea un dato. Marcarlo haría que el test se mintiera a sí mismo.
  Dejándolos afuera, los tests de es-AR prueban justamente lo que hay que probar:
  que el dato no se traduce.
- `i18n-es-ar/**`: si se marcara `overlay.ts` se marcaría a sí mismo. Se deja
  afuera todo el directorio salvo `LanguageSelector.tsx`, que es interfaz y se
  traduce como cualquier otra.

#### 4. `ui/src/i18n-es-ar/overlay.ts` (cambia)

Tres cambios, nada más:

```ts
/** Acepta cualquier valor y devuelve lo que no sea cadena sin tocar: el canal de
 *  declaraciones envuelve retornos, que pueden no ser cadenas. */
export function translate<T>(value: T): T {
  if (typeof value !== "string") return value;
  const { locale, chain } = active();
  if (chain.length === 0) return value;
  return lookup(value, locale) as unknown as T;
}

/**
 * Formatos (§7.5). La clave es la forma estática; los valores interpolados no
 * pasan por el diccionario.
 */
export function formatted(shape: readonly string[], values: readonly unknown[]): string {
  const raw = () =>
    shape.map((s, i) => s + (i < values.length ? String(values[i]) : "")).join("");
  const { chain } = active();
  if (chain.length === 0) return raw();
  const key = shape.map((s, i) => (i < shape.length - 1 ? `${s}{${i}}` : s)).join("");
  for (const locale of chain) {
    const tpl = LAYERS[locale].formats.get(key);
    if (tpl !== undefined) return tpl.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? ""));
  }
  return raw();
}
```

Y en `layer()`: una entrada de un archivo de área va a `formats` si su clave
contiene `/\{\d+\}/`, y a `literals` si no. Nada más cambia: ni los archivos de
diccionario, ni `lookup`, ni el memo, ni `tEs`, ni el interruptor, ni
`OVERLAY_IN_BUNDLE`.

`markOverlayInstalled()` **se queda** y se sigue exportando, pero ahora su único
llamador son los tests (antes era el shim). `isOverlayInstalled()` no cambia, así
que el selector de idioma sigue escondiéndose en el build de upstream.

#### 5. `ui/src/i18n-es-ar/jsx-runtime.ts` — **se borra**

Con él se va el hack de `resolveId`, la guarda `importer === SHIM` y el costo por
render. En `ui/vite.config.es-ar.ts` y `ui/vitest.config.es-ar.ts` sólo cambia el
nombre importado (`localeOverlayJsxRuntime` → `paperclipEsArTextMarking`); son
archivos nuestros y el resto queda igual.

#### 6. Tests nuestros

- `ui/src/i18n-es-ar/mark-text.test.ts` (nuevo), sobre `markText` como función
  pura. Mínimo a cubrir, con los casos que se corrieron en §6.5/§6.6:
  - texto de JSX, atributo de la lista, atributo fuera de la lista (sin marcar),
    propiedad de la lista, llamada de la lista, literal en rama de `?:`,
    plantilla con interpolación;
  - `<code>` y `<pre>`, también anidados, sin marcar;
  - `className`, `to`, `value`, `type`, clave de objeto y fuente de `import`, sin
    marcar;
  - una expresión que **no** es literal (`{agent.name}`) queda intacta;
  - la regla de la comparación: una cadena que el archivo compara no se marca;
  - texto de varias líneas: el valor marcado es el que rinde JSX y la cantidad de
    líneas del archivo no cambia;
  - la salida vuelve a parsear con `parseAst` en los 1.268 archivos que el plugin marca
    (test lento: marcarlo y dejarlo en el mismo archivo).
  - Si `parseAst` no arranca en el entorno jsdom de upstream, el archivo lleva
    `// @vitest-environment node`.
- `ui/src/i18n-es-ar/real-components.es-ar.test.tsx` (crece): además de lo que ya
  prueba, **el caso del dueño**: rendir un componente real de upstream con una
  fixture cuyo nombre o título sea `"Search"`, `"Done"` u `"Open"` y afirmar que
  sale **sin traducir**, en el mismo render donde la etiqueta de interfaz
  homónima sí se tradujo. Es la prueba de la invariante de §4 y la que no puede
  volver a romperse.
- `ui/src/i18n-es-ar/overlay.test.ts` (crece): `formatted()` con formato presente,
  ausente (vuelve a armar el inglés), con el valor interpolado intacto, y con la
  capa `es` de respaldo.
- `ui/src/i18n-es-ar/overlay.dom.test.tsx` (cambia): donde importaba
  `./jsx-runtime` para simular el overlay puesto, ahora llama a
  `markOverlayInstalled()`. Los casos del build de upstream (sin overlay) no
  cambian.

### Fase 2 — Confirmar la cobertura

Con las listas de §8/1 tal como están escritas arriba, la cobertura medida es
**613 de 624** entradas del diccionario (§6.7). La fase 2 **no es agregar
nombres**: eso ya está hecho y verificado. Es confirmar que da lo mismo después
de implementar, corriendo el reporte de la fase 3 y comparando contra §10:

- si el reporte lista exactamente las 11 de §10, la fase 1 está bien;
- si lista alguna más, falta un nombre y §10 dice cuál es el canal;
- si el build falla con «falta la declaración X en el archivo Y», upstream
  renombró algo desde el 2026-10-17 y hay que actualizar esa entrada de
  `TEXT_DECLS`. Es el comportamiento buscado, no un bug.

**Ninguna de esas 11 pide tocar un archivo de upstream**, y 4 de ellas son
trabajo de diccionario, del Traductor, no de Dev UX/UI (§10.1).

### Fase 3 — El reporte

`ui/src/i18n-es-ar/tools/report-text-sites.ts`, un script nuestro que corre
`markText` sobre todo `ui/src` y lista:

1. entradas del diccionario que **ningún** sitio marcado produce (cobertura
   perdida, con el nombre o la declaración que la recuperaría);
2. nombres de atributo y de propiedad que llevan literales de texto y **no** están
   en las listas, por cantidad (es la cola de la que sale la cobertura del corte
   2 y de los que vengan);
3. textos de JSX salteados por una entidad fuera de la tabla;
4. cadenas que la regla de la comparación bloqueó;
5. entradas del diccionario que parecen técnicas (sin espacios y con `_`, `/` o
   `.`, o todo en minúsculas), que es una violación de ADR 0001 §7.3 — hoy hay al
   menos una, `"unread"` en `navigation.json`.

Es la herramienta que hace que ampliar cobertura sea mirar una lista y no leer
700 componentes. Reemplaza a la fase 3 de ADR 0001.

### Verificación antes de entregar

```sh
cd /paperclip/workspaces/es-ar-corte2/ui
./node_modules/.bin/vitest run src/i18n-es-ar src/i18n/locale-validation.test.ts   # locale-validation sigue 7/7
./node_modules/.bin/vitest run --config vitest.config.es-ar.ts                      # los componentes reales en es-AR
./node_modules/.bin/tsc --noEmit -p tsconfig.json                                   # sin errores en lo nuestro
```

La primera corrida de la segunda línea puede dar timeout por caché fría del
transform: hay que volver a correrla antes de reportar una falla.

## 9. Presupuesto de ediciones a upstream

**Esta decisión gasta 0 de las 14 líneas que quedan.** No toca un solo archivo de
upstream: el transform es un plugin que se activa desde `vite.config.es-ar.ts`,
que ya existe y no cambia. Es la misma propiedad que hizo ganar a ADR 0001 §5d, y
es la razón por la que ésta es la única opción de §5 que entra en el presupuesto.

Y lo devuelve. Las **36 líneas en 12 archivos** que gastó el corte 1 son, todas,
`tEs()` en mapas de etiquetas que corren en el cuerpo del módulo
(`attention.ts`, `PriorityIcon.tsx`, `task-views.ts`, `issue-filters.ts`,
`IssuesList.tsx`, `LegacyIssuesList.tsx`, `ActivityCharts.tsx`,
`DecisionsToolbar.tsx`, `Sidebar.tsx`, `Sidebar.production.tsx`, `Agents.tsx`) más
un `import` y un `<LanguageSelector />` en `ProfileSettings.tsx`. El canal de
declaraciones de §7.2 cubre exactamente esos mapas **desde un archivo nuestro**,
así que 11 de los 12 archivos se pueden volver a dejar idénticos a upstream.

No es parte de esta tarea y no es precondición de nada: es una limpieza con su
propio QA, y el orden correcto es después de validar las fases 1 y 2. Queda
anotada acá para que no se pierda, y el único archivo de upstream que seguiría
tocado sería `ProfileSettings.tsx` (3 líneas: el selector de idioma tiene que
entrar en alguna pantalla).

| | Líneas de upstream |
| --- | ---: |
| Tope de ADR 0001 | ~50 |
| Gastadas por el corte 1 | 36 |
| **Gasta ADR 0002** | **0** |
| Recuperables después de la limpieza | −33 |

## 10. Qué se pierde, y cómo se recupera

Lo que hoy se traduce y después de este cambio **no**. Medido entrada por
entrada, no estimado (§6.7).

El punto de partida, con las listas mínimas, eran **36 de 624** entradas sin
cubrir. Las listas que se entregan en §8/1 ya recuperan **25 de esas 36**, y la
recuperación **está verificada corriendo el transform otra vez**, no supuesta:
la columna derecha de §6.7 es esa segunda corrida. Lo que sigue es, primero, qué
se hizo con esas 25, y después las 11 que quedan, una por una.

**Las 25 recuperadas, y por qué canal:**

| Qué | Cuántas | Cómo |
| --- | ---: | --- |
| `failureMessages` de `DecisionModelSettings.tsx`: 10 mensajes de error indexados por el código de falla del API | 10 | `TEXT_DECLS` |
| `const` locales que arman una etiqueta antes del JSX: `label` ×2 y `visibleActionError` (`InstanceGeneralSettings.tsx`), `secondaryLabel` ×2 (`SidebarAccountMenu.production.tsx`), `uploadHint` (`ProfileSettings.tsx`), `detail` (`TaskChatThread.tsx`) | 7 | `TEXT_DECLS` |
| `EFFORT_LABELS` (`composer-run-settings.ts`) y `ONBOARDING_STEP_LABELS` (`Stepper.tsx`), mapas indexados por valor técnico | 2 | `TEXT_DECLS` |
| `environmentDeleteBlockMessage()` (`CompanyEnvironments.tsx`): devuelve el motivo, sin pasar por ninguna variable | 1 | `TEXT_DECLS` sobre la función |
| `announcement` (`WorkspaceFileBrowser.tsx`): literal adentro del callback de un `useMemo` | 1 | `TEXT_DECLS` sobre el `const` que lo envuelve |
| `deleteImpactNotes.push("…")`: el literal es argumento, no inicializador, así que `TEXT_DECLS` no lo alcanza | 1 | nombre en `TEXT_CALLS` |
| `.reason` de `capabilityState()` (`CompanyEnvironments.tsx`), ×2 | 2 | nombre en `TEXT_KEYS` |
| `moreLabel = "Show more"` (`FoldCurtain.tsx`): valor por defecto de un prop desestructurado | 1 | forma de sitio nueva en §8/2 |

Ninguna de las ocho filas toca un archivo de upstream: todas son una línea en
`text-sites.ts`, que es nuestro.

### 10.1 Las 4 que son trabajo de diccionario, no de arquitectura

Aparecieron al cruzar, y ninguna es una pérdida del esquema: son entradas que
**nunca deberían haber estado así en el diccionario**. El reporte de §8/fase 3
las detecta solo. Van al Traductor, no a Dev UX/UI:

- `"Main company nav"` y `"The company spending limit was reached."` — **no
  existen en el código de producción**. La primera sólo aparece en
  `Layout.test.tsx`, la segunda sólo en `DispositionRecoveryNotice.test.tsx`. Son
  cadenas de test que se colaron al diccionario; hay que **borrarlas**. Que hoy
  "se traduzcan" no significa nada: no hay pantalla donde se vean.
- `"Couldn’t open My Skills"` — con apóstrofo tipográfico (`’`). El código
  (`CompanySkills.tsx:4925`) escribe `"Couldn't open My Skills"` con apóstrofo
  recto, y `errors.json` **tiene las dos**. La recta ya está cubierta; la
  tipográfica es un duplicado que no pegó nunca y hay que **borrarla**. Es el
  tipo de error que el esquema viejo escondía y éste muestra.
- `"This cannot be undone."` — en producción esa oración nunca aparece sola:
  está adentro de seis oraciones completas (`"Delete this attachment? This cannot
  be undone."`, `"Delete this organization and all its data? This cannot be
  undone."`, y cuatro más), **y las seis sí se marcan**. La entrada suelta sólo
  pegaba contra la fixture `previewMarkdown`, o sea contra un dato. Hay que
  **recortarla distinto**: seis entradas completas en lugar de un fragmento.

### 10.2 Las 4 de `{0} weeks` / `{0} months`

`"2 weeks"`, `"4 weeks"`, `"3 months"` y `"6 months"` no existen como literal:
`InstanceGeneralSettings.tsx` las arma con
`const label = weeks === 1 ? "1 week" : \`${weeks} weeks\``. Con la entrada de
`TEXT_DECLS` sobre `label` (§8/1) el transform ya emite **los dos formatos**
—verificado: `"{0} weeks"` y `"{0} months"` están en la salida— y los literales
`"1 week"` y `"1 month"` quedan cubiertos como literales.

Lo que falta es del Traductor: reemplazar las cuatro entradas expandidas por dos
de formato (§7.5), `"{0} weeks"` → `"{0} semanas"` y `"{0} months"` →
`"{0} meses"`. Eso además **arregla un agujero**: hoy el diccionario sólo tiene
las cuatro que están en los presets; con el formato quedan cubiertos todos los
valores, incluso los que upstream agregue mañana.

### 10.3 Las 2 que no se recuperan a propósito

`"Not ready"` y `"Setup required"` llegan por un atributo `value`
(`InstanceGeneralSettings.tsx:142` y `:146`, dentro de un `StatusBox`). `value`
es el nombre de atributo más técnico que hay —es el valor de un `<input>`, el de
un `<option>`, una clave de API— y **no entra a la lista blanca por nada**: es
justamente la clase de sitio que este ADR existe para no marcar. En la misma
pantalla, el `label="Auth readiness"` del mismo componente sí se traduce.

Si esas dos etiquetas importan, el camino es `tEs()` en el sitio (§7.5 de ADR
0001), y ahí cuesta presupuesto de upstream: 2 líneas. **No se hace por
defecto**; es una decisión del PM sobre dos etiquetas de una pantalla de
diagnóstico, no una decisión de arquitectura.

### 10.4 La única pérdida real: `"Failed to fetch"`

Es el `message` de un `TypeError` del navegador cuando `fetch` no llega a salir
—lo dice el comentario de `src/api/auth.ts:72`, que ya distingue el "Load failed"
de Safari del "Failed to fetch" de Chrome—. **No es una cadena nuestra ni de
upstream: es del navegador**, y encima cambia según cuál sea.

Hoy se traduce **por accidente**, porque el mensaje pasa por JSX y el overlay
atrapa todo lo que pasa por JSX. Es exactamente el defecto de §2 funcionando a
favor por casualidad. No hay forma honesta de marcarla y no se va a recuperar:
queda en inglés, igual que el "Load failed" de Safari queda en inglés hoy. Si
algún día molesta, se arregla donde corresponde —mapeando el error a un mensaje
propio en `src/api/`, que es una edición de upstream y una decisión aparte.

### 10.5 Las etiquetas derivadas de un valor técnico

Es la pérdida que el enunciado pedía nombrar, y la que más se vería si no se
atendiera. `statusLabel(status)` de `StatusIcon.tsx:10` y su copia byte a byte de
`KanbanBoard.tsx:134` arman `"In Progress"` con dos `.replace()`; no hay literal.
Eso es el menú de cambio de estado y los encabezados del tablero, o sea H-1 y H-2
de CHA-9, arreglados hace horas por CHA-15. **Se recupera con las dos entradas de
`TEXT_DECLS` que ya están seedeadas en §8/1**, envolviendo el retorno: cero
ediciones de upstream, y `real-components.es-ar.test.tsx` ya rinde `StatusIcon`
real para los 7 estados, así que la regresión queda cubierta por un test que ya
existe. Por eso no figura entre las 11 de §6.7: está cubierta, pero es la que
hay que mirar primero en QA (§11.2, T2).

Nota para el Lead, no decisión mía: este canal **destraba** lo que CHA-15 tuvo
que dejar atado. Hoy `done` tiene que decir *Listo* en todas las capas porque la
capa literal no puede distinguir el chip de estado de los seis botones *Done* de
upstream. Con el marcado, el chip pasa por `statusLabel` (canal de declaraciones)
y los botones por sus literales: son dos sitios distintos y pueden tener dos
traducciones distintas. Si el PM quiere *Terminada* en el chip, ahora se puede.

### 10.6 Lo demás

- **La salida de `t()` de i18next.** ADR 0001 §5d.2 lo contaba como propiedad: si
  upstream externalizaba una cadena, el inglés que devolvía `t()` igual pasaba por
  el overlay. Eso se termina: `t("clave")` es una llamada, y no se entra en las
  llamadas. Alcance real hoy: `App.tsx` es el único `useTranslation()` de 700
  componentes de producción, con 3 cadenas. Si upstream alguna vez externaliza en
  serio, hay que volver a este ADR (§12).
- **6 de los 9 patrones de `patterns.ts`** (§7.5): migran a formatos. Es trabajo
  del Traductor. Otros 2 ya eran letra muerta y 1 sobra.
- **Las oraciones partidas en varios hijos de JSX.** `…remove the
  <strong>{tipo}</strong> adapter?` llega al diccionario como dos fragmentos
  (`"Are you sure you want to remove the"` y `"adapter?"`), que en español no se
  pueden ordenar bien. **No es una pérdida de este ADR** —el overlay viejo veía
  exactamente los mismos fragmentos, y por eso los dos patrones anclados que
  intentaban cubrirlo nunca pegaron (§7.5)—, pero sí es el límite que queda sin
  resolver. La salida, cuando una de estas oraciones importe, es `tEs()` en el
  sitio, y eso cuesta presupuesto de upstream. Es la misma forma que el Lead ya
  anotó para Secrets al dejarlo fuera del corte 2.
- **El texto de JSX con una entidad fuera de la tabla de 13.** Hoy 0 casos,
  medido (§6.4): la tabla cubre las que existen. Si upstream mete una nueva, esa
  cadena queda en inglés y el reporte la lista.
- **0,56 % de los sitios, por la regla de la comparación** (§7.4). Precio pagado a
  propósito.

Todas las pérdidas tienen la misma forma: **se degradan a inglés y se ven**.
Ninguna rompe la pantalla, ninguna es silenciosa para el reporte, y ninguna
traduce nada que no debería.

**El resumen de §10, en una línea:** de 624 entradas, 613 se traducen; de las 11
que no, 4 son errores del diccionario que este esquema sacó a la luz, 4 se
arreglan mejor como formato, 2 son una decisión deliberada de no marcar un
atributo `value`, y **una sola es una pérdida real, y es un mensaje del
navegador**.

## 11. Cómo lo verifica QA

El método es el de CHA-9 §1 y hay que repetirlo igual, porque es lo que aísla la
variable: **la misma pantalla, del mismo bundle, con los mismos datos, dos veces**
—una en es-AR y otra con `?lang=en`—. Lo único que cambia entre las dos cargas es
el idioma.

### 11.1 Lo que tiene que **dejar** de traducirse

Con el diccionario del corte 2 puesto, y con datos elegidos para colisionar a
propósito:

| # | Caso | Qué tiene que pasar |
| --- | --- | --- |
| D1 | Un agente llamado **Search**, otro **Done**, otro **Open**, otro **Settings** | el nombre sale tal como se escribió, en la tarjeta del agente, en la lista de la barra lateral, en el chip de responsable y en el menú de asignación — **en la misma pantalla donde la etiqueta de interfaz homónima sí está en español** |
| D2 | La prueba de CHA-9: los 26 nombres de agente | **0 de 26** traducidos (era 7 de 26) |
| D3 | Tareas tituladas **Save**, **New Task**, **Done**, **In Progress** | el título sale igual en la lista, en el detalle, en la tarjeta del tablero, en la bandeja y en la paleta de comandos |
| D4 | Un proyecto llamado **Costs** y una empresa llamada **Connections** | el nombre sale igual, incluida la miga de pan y el selector de empresa |
| D5 | Un comentario y una salida de ejecución cuyo texto sea exactamente **Save** | sale igual |
| D6 | Una tarea titulada **Invite people to the launch party** | sale igual (es el patrón interpolado que ya no corre) |

D1 y D3 son los que hay que mirar lado a lado: la gracia no es que el dato quede
en inglés, es que quede en inglés **mientras la interfaz está en español**.

### 11.2 Lo que tiene que **seguir** traduciéndose

| # | Caso | Evidencia de que no se rompió |
| --- | --- | --- |
| T1 | Barra lateral, bandeja, lista de tareas, detalle, tablero, Panel, Configuración | la pasada visual de CHA-9, repetida |
| T2 | Menú de cambio de estado y encabezados del tablero | §10.5: es el canal de declaraciones. Es la regresión más probable de toda esta tarea: **hay que mirarla primero** |
| T3 | Chips de prioridad, leyenda del gráfico del Panel, vistas de tareas | mapas de etiquetas, por declaraciones o por `tEs` |
| T4 | Estados vacíos, mensajes de error, textos de `window.confirm`, `placeholder`, `aria-label`, `title` | canales de nombres y de llamadas |
| T5 | Los 6 puntos funcionales F1–F6 de CHA-9 (selector, persistencia, `?lang=en`, `localStorage`, navegador en español) | sin cambios: el interruptor y `resolveUiLocale()` no se tocaron |
| T6 | `<code>` y `<pre>` con identificadores técnicos (`in_review`) | intactos, ahora también anidados |
| T7 | El build de upstream (`vite.config.ts`) con el navegador en español | **100 % en inglés** y **sin selector de idioma** en el perfil (CHA-9 §5) |
| T8 | Los 684 tests de upstream y `locale-validation.test.ts` | verdes, 7/7 |
| T9 | `FoldCurtain`: el botón **Ver más** / **Ver menos** | es el valor por defecto de un prop desestructurado (§8/2). Si queda en inglés, falta esa forma de sitio |
| T10 | Pantalla de entornos: el motivo por el que no se puede borrar un entorno, y el `.reason` de un proveedor sin captura | canal de declaraciones y `TEXT_KEYS`/`reason` (§10) |

### 11.3 Las 11 que tienen que quedar en inglés, y está bien

No son hallazgos: son el residuo medido de §10, y QA tiene que **confirmarlos**,
no reportarlos. Si alguna de éstas aparece en español, *eso* sí es hallazgo,
porque significa que algo se está traduciendo fuera de un sitio marcado.

| # | Caso | Qué tiene que pasar |
| --- | --- | --- |
| R1 | Diagnóstico de instancia: los recuadros **Auth readiness** y **Bootstrap status** | el rótulo del recuadro en español, el valor (*Not ready*, *Setup required*, *Ready*) **en inglés**: es un atributo `value` (§10.3) |
| R2 | Cortar la red y provocar un error de `fetch` | el mensaje del navegador (*Failed to fetch*) queda en inglés (§10.4) |
| R3 | Presets de retención de backups: **2 weeks**, **4 weeks**, **3 months**, **6 months** | quedan en inglés **hasta que el Traductor cargue los formatos** `{0} weeks` / `{0} months`. Después tienen que decir *2 semanas*, *4 semanas*… incluso en valores que no están en el diccionario de hoy (§10.2) |
| R4 | Los diálogos de borrado (*Delete this attachment?…*) | la oración **completa** en español. Si quedó en inglés, falta recortar la entrada (§10.1) |

### 11.4 Lo que hay que medir además

- **Desbordes de texto**: el barrido de CHA-9 §2, en 1440 px y 1024 px. La
  cobertura cambia, así que hay texto nuevo en español que antes no estaba.
- **Tamaño del bundle es-AR** contra el del corte 1. El marcado agrega ~19.500
  llamadas al código; la expectativa es un aumento chico y muy comprimible, pero
  **nadie lo midió todavía** y hay que reportarlo con número. Si el aumento sin
  comprimir pasa el 10 %, es hallazgo.
- **El reporte de `report-text-sites`** adjunto al informe de QA: es el estado de
  cobertura, y es lo que el Lead necesita para decidir si abre otra tanda de
  diccionario.
- **Nada de esto se mide en la instancia del dueño.** Como en CHA-9: builds
  estáticos, `/api` simulado de sólo lectura, y el arnés contesta 405 a cualquier
  método que no sea GET.

## 12. Riesgos y límites

| Riesgo | Mitigación |
| --- | --- |
| La máquina crece: el transform es más código que el shim | Pero sale del camino de render y se borra el shim con su `resolveId`. Verificado sobre los 2.023 archivos reales de `ui/src`: 0 fallos de parseo, y sobre los 737 que se reescriben, 0 fallos de reparseo y 0 corrimientos de línea (§6.2, §6.4) |
| Marcar en el build hace que el español exista antes que la lógica y rompa una comparación | La regla de §7.4, automática, por 0,56 % de cobertura (§6.8) |
| Un cambio de upstream renombra una declaración de `TEXT_DECLS` | El plugin **falla el build** con la ruta y el nombre. Es la única forma de que no se degrade en silencio |
| Un cambio de upstream renombra un prop de texto | Esa cadena queda en inglés y el reporte la lista. Se degrada, no rompe |
| Marcar un literal que no es texto | Lista blanca de nombres, nunca lista negra; no se entra en llamadas, objetos ni arreglos; y el diccionario sigue siendo exacto, así que marcar de más sólo cuesta una llamada que devuelve lo mismo |
| Una cadena técnica en el diccionario sí rompería algo marcado | ADR 0001 §7.3 ya lo prohíbe; el reporte de fase 3 lo detecta (hoy: `"unread"`) |
| `parseAst` es API de `vite`, no un contrato estable | `vite ^8.2.2` es dependencia declarada de `ui/package.json` (verificado) y es el parser que el propio bundler usa. Si cambia de forma, falla el build de es-AR, no el de upstream |
| Costo de build | 1.268 archivos en 10 s **con** el reparseo de la prueba incluido; en dev se paga por archivo cargado (§6.4). Medir el bundle en QA (§11.4) |
| El español sigue sin cobertura de los tests de upstream | Igual que ADR 0001: es el precio de que los 684 sigan verdes. Los nuestros cubren el transform y los componentes reales |
| Algo sale mal en producción | El interruptor de ADR 0001 §10 no cambia: `?lang=en`, `localStorage["paperclip.lang"] = "en"`, y a nivel build el `vite build` de siempre sigue dando la app en inglés sin revertir un archivo |

**Cuándo volver a este ADR:**

- si upstream externaliza las cadenas a `en.json` en serio (ahí `t()` pasa a ser
  el sitio de texto principal y el transform tiene que entrar en esa llamada);
- si upstream reemplaza `@vitejs/plugin-react` por algo que no deje correr un
  `transform` previo;
- si `tEs()` pasa de ~50 usos (el techo de ADR 0001 §7.5), que sería la señal de
  que los sitios declarados no alcanzan;
- si el reporte muestra que la cola de nombres sin cubrir no baja a medida que
  crece el diccionario.

**Límite honesto, el mismo de ADR 0001:** esto no se puede contribuir a upstream.
El diccionario sí es el insumo que haría falta el día que upstream externalice.

## 13. Lo que no se toca nunca

§11 de ADR 0001 sigue vigente, entera, y este ADR no pide ninguna excepción:

- `ui/src/i18n/locales/*.json` — ni `en.json`, ni `es.json`, ni los otros 39.
- `ui/src/i18n/locale-validation.ts` y su test.
- `ui/src/i18n/locales.ts`, `ui/src/i18n/index.ts`.
- `ui/vite.config.ts`, `ui/vitest.config.ts`, `ui/package.json`.
- Los 684 archivos de test de `ui/src`.

Y se le agrega una línea, que es nueva de este ADR:

- **Ningún archivo de upstream.** ADR 0002 se ejecuta entero dentro de
  `ui/src/i18n-es-ar/` más los dos archivos de config propios. Si la
  implementación parece pedir una edición de upstream, no se edita: es que falta
  un nombre en `text-sites.ts` o una entrada en `TEXT_DECLS`.
