# CHA-35 — que el worktree del corte 2 pueda construir y arrancar

Receta reproducible del entorno de build de `/paperclip/workspaces/es-ar-corte2`
(rama `es-ar/corte2`, sobre `2a50d3489`). Medido el 2026-10-17 entre las 21:03Z
y las 21:20Z, 8 núcleos.

**Resultado: los tres puntos de la tarjeta cierran.** Las dos configs
construyen, la app carga en el navegador —la de upstream en inglés y la de
es-AR en español, las dos con la pantalla real, no la de error— y los tipos
pasaron de **777 errores a 9** con el comando pelado y a **0** con el
`typecheck` del repo (§4). `pnpm-lock.yaml` **sin una línea de diferencia**,
cero archivos de upstream tocados.

Lo que no cierra y no es nuestro: tres paquetes del monorepo no construyen en
este contenedor porque faltan `cc` y `cargo` (§3.2). Ninguno de los tres está
en el camino de la interfaz.

## 1. Qué estaba roto

Lo diagnosticó QA en [CHA-28 I-1](CHA-28-validacion-corte2.md) y se confirmó
tal cual antes de tocar nada:

```
node_modules    -> /paperclip/workspaces/paperclip-es/node_modules
ui/node_modules -> /paperclip/workspaces/paperclip-es/ui/node_modules
```

`paperclip-es` es el worktree del corte 1, en otro commit. Los enlaces de los
paquetes del workspace son **relativos** y se resuelven por el camino físico,
así que `ui/node_modules/@paperclipai/shared` terminaba en
`paperclip-es/packages/shared`: el código de otra rama. De ahí los 37
`MISSING_EXPORT` y los 777 errores de tipos.

## 2. La receta

### 2.1 El install propio (una sola vez por worktree)

```bash
cd /paperclip/workspaces/es-ar-corte2
rm node_modules ui/node_modules        # ¡sin barra final! son enlaces, y
                                       # `rm -rf node_modules/` vacía el destino
                                       # —el install del corte 1— y deja el enlace
                                       # (probado aparte, no acá)
unset NODE_PATH                        # el runner lo trae apuntando a /app
pnpm install --frozen-lockfile
```

- **1 m 05 s**, `reused 1255, downloaded 82`: el store compartido
  (`/paperclip/.pnpm-store/v3`, el default en este volumen) ya tenía casi todo.
- **`pnpm-lock.yaml` no se movió**: `5c2a609bb9acf97fca47eaac4ce34540` antes y
  después. No hizo falta revertir nada.
- Cuesta **~1 GB** de disco, no los 2,9 GB que muestra `du`: el grueso son
  enlaces duros al store. Quedan 35 GB libres.
- `rm node_modules` **no** tocó el install del corte 1, que sigue entero.
- Las ~20 advertencias `Failed to create bin ... dist/dev-cli.js` son normales:
  son los binarios de paquetes del workspace que todavía no se construyeron.

`unset NODE_PATH` no es un adorno: el runner exporta `NODE_PATH=/app/...`, y con
eso puesto `node` resuelve paquetes del SDK del agente en vez de los del
worktree.

### 2.2 Construir

```bash
cd /paperclip/workspaces/es-ar-corte2 && unset NODE_PATH

# el build de upstream, sólo lo que la interfaz necesita (15 paquetes)
pnpm run preflight:workspace-links && pnpm --filter "@paperclipai/ui..." build
# -> ui/dist

# el build del fork
cd ui && pnpm exec vite build --config vite.config.es-ar.ts --outDir dist-es-ar
# -> ui/dist-es-ar, "✓ built in 22.85s"
```

`--filter "@paperclipai/ui..."` es el comando que conviene usar acá: construye
la interfaz y sus 14 dependencias, y **no** entra en los dos paquetes que este
contenedor no puede construir (§3.2). `pnpm build` a secas sí entra, y termina
en rojo por eso aunque la interfaz esté perfecta.

`ui/dist-es-ar` no lo cubre el `.gitignore` de upstream, así que la exclusión
quedó en `.git/info/exclude` (local, no se commitea), como el resto de los
temporales del equipo.

### 2.3 Tests y tipos

```bash
cd /paperclip/workspaces/es-ar-corte2/ui && unset NODE_PATH
pnpm exec vitest run --config vitest.config.es-ar.ts   # 20 pasan / 20
pnpm exec vitest run src/i18n-es-ar                    # 99 pasan / 19 salteados
pnpm --filter @paperclipai/ui typecheck                # 0 errores
```

Los tres números son idénticos a los que midió QA en CHA-28 §2.2: el install
propio **no cambió** ningún resultado de la suite, sólo destrabó el build.

### 2.4 Levantarla y mirarla

Dos caminos, los dos probados en Chromium:

```bash
# A) los bundles construidos, servidos estáticos
cd /paperclip/workspaces/es-ar-corte2/ui
node /paperclip/workspaces/.cha35-arnes/serve.mjs dist:5274 dist-es-ar:5373

# B) el dev server del fork
cd /paperclip/workspaces/es-ar-corte2/ui && unset NODE_PATH
pnpm exec vite --config vite.config.es-ar.ts --port 5174 --strictPort
#    ojo: escucha en localhost, no en 127.0.0.1 -> usar http://localhost:5174/
```

Y para cargarla:

```bash
export PLAYWRIGHT_BROWSERS_PATH=/paperclip/workspaces/.playwright-browsers
export LD_LIBRARY_PATH=/paperclip/.local/pw-deps/root/usr/lib:/paperclip/.local/pw-deps/root/usr/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=/paperclip/workspaces/.qa-fontconfig/fonts.conf
unset NODE_PATH
node /paperclip/workspaces/.cha35-arnes/arranca.mjs \
  /paperclip/workspaces/es-ar-corte2 \
  http://127.0.0.1:5274/ upstream  http://127.0.0.1:5373/ es-ar
```

El arnés vive en `/paperclip/workspaces/.cha35-arnes/`, fuera de todo worktree,
al lado de `.playwright-browsers` y `.qa-fontconfig`:

| Archivo | Qué es |
| --- | --- |
| `serve.mjs` | servidor estático de los dos builds |
| `mock-api.mjs` | el mock de `/api` de QA (CHA-9), de sólo lectura: todo lo que no sea GET se contesta 405 |
| `extra-corte2.mjs` | las rutas que el corte 2 agregó y el mock de CHA-9 no tenía |
| `arranca.mjs` | carga una URL con el mock puesto y dice si hay app o pantalla de error |

**No hay backend**: la app se abre contra el mock, que es lo que hizo la pasada
del corte 1. El primer argumento es el worktree, y de ahí sale Playwright (el
arnés no tiene install propio).

## 3. Lo que quedó rojo, y por qué no es nuestro

### 3.1 Los `MISSING_EXPORT` se fueron

Cero en el build de upstream y cero en el de es-AR. Era el síntoma del enlace,
como decía QA.

### 3.2 Tres paquetes no construyen en este contenedor

`pnpm -r --no-bail build` (alcance: 35 de los 36 proyectos) deja 32 paquetes en
verde y tres en rojo:

| Paquete | Por qué |
| --- | --- |
| `packages/tailscale-https-broker` | `spawnSync cc` → `ENOENT`: no hay compilador de C para el addon nativo |
| `packages/paperclip-runner` | `sh: 1: cargo: not found`: el binario del runner es Rust |
| `server` | sólo porque arrastra el build de `paperclip-runner` |

No hay `cc`, `gcc`, `clang` ni `cargo` en la imagen. Los tres fallan **en el
árbol de upstream sin tocar**, no tienen nada que ver con la traducción, y
ninguno está en el camino de la interfaz: el cierre de `@paperclipai/ui` son 15
paquetes y no incluye a ninguno. Por eso §2.2 usa el filtro.

Si en algún momento hace falta el server completo (para abrir la app contra
datos de verdad en vez del mock), eso es instalar toolchain en la imagen:
decisión del dueño, no de esta tarjeta.

## 4. Los tipos: 777 → 9 → 0

| Invocación | Antes (enlace al corte 1) | Ahora |
| --- | ---: | ---: |
| `pnpm exec tsc --noEmit` desde `ui/` | **777** | **9** |
| `pnpm --filter @paperclipai/ui typecheck` | — | **0** |

Los 768 que desaparecieron son los que QA atribuyó a `@paperclipai/shared` sin
construir: ahora `packages/shared/dist` existe y es el de **esta** rama.

Los 9 que quedan son todos del mismo archivo, `storybook/support/feature-map/
FeatureOverview.tsx`, y todos del mismo origen: dos `TS2307` por
`generated/catalog.json` y `generated/feature-index.json`, que son **archivos
generados**, más siete `TS7006` (`implicitly any`) que son consecuencia directa
de los dos primeros. El `typecheck` del repo los genera antes de compilar
(`node ../scripts/storybook-catalog.mjs && tsc -b`), y por eso da 0.

O sea: `tsc --noEmit` pelado no es el gate del repo; le falta el paso de
generación. **La línea base que vale es 0**, y cualquier error que aparezca de
ahora en adelante es nuestro.

## 5. La app carga de verdad

Tres cargas, 1440 × 900, con el mock puesto:

| Qué | Elementos en el DOM | `pageerror` | Pantalla |
| --- | ---: | ---: | --- |
| `ui/dist` (upstream), 5274 | 655 | 0 | `Dashboard • Chanchu Labs • Paperclip`, en inglés |
| `ui/dist-es-ar` (fork), 5373 | 656 | 0 | `Panel • Chanchu Labs • Paperclip`, en es-AR |
| `vite dev` con la config es-AR, 5174 | 619 | 0 | ídem, en es-AR |

Capturas en `/paperclip/workspaces/.cha35-arnes/shots/`. Lo que se ve es el
panel completo: barra lateral, tarjetas, los tres gráficos y la tabla de tareas
recientes, con las letras renderizadas (las tres variables de entorno de §2.4
son obligatorias: sin `FONTCONFIG_FILE` el proceso muere).

El único error de consola es el WebSocket de eventos
(`ws://.../events/ws` → 200/403): no hay backend, y es esperable. No viene del
bundle.

**Dos cosas que costaron, y quedan escritas porque van a volver a pasar:**

1. Con el mock de CHA-9 tal cual, la app del corte 2 se cae en el límite de
   error con `Cannot read properties of undefined (reading 'ag-lead')`. No es
   el bundle: el corte 2 está sobre un upstream más nuevo y pide rutas que en
   el corte 1 no existían. `/api/.../resource-memberships/me` devuelve un
   objeto con `agentMemberships` adentro, y el default `{}` del mock deja ese
   campo en `undefined`. Está arreglado en `extra-corte2.mjs`, con
   `primary-agent/me`, que es el otro caso igual.
2. En `vite dev`, el patrón `**/api/**` del mock también atrapa módulos de
   **fuente** (`/src/api/companies-query.ts`) y los contesta con JSON: la app
   muere con un error de MIME y se ve la pantalla de "no arrancó". El mock del
   arnés ahora sólo contesta lo que cuelga de `/api/`.

Las dos fallas se veían iguales desde afuera —pantalla de error— y ninguna de
las dos era del build. Vale la pena mirar siempre `pageErrors` y la lista de
rutas sin mock antes de culpar al bundle.

## 6. Para otros roles

**H-1 · `done` tiene dos nombres otra vez, y ahora se ve en pantalla.** En la
leyenda del gráfico «Tasks by Status» del panel, el estado `done` sale como
**«Listo»**; el glosario ([glosario-es-AR.md](glosario-es-AR.md), tabla de
estados) dice **«Terminada»**, y es la invariante de CHA-15 (un nombre por
estado). La entrada es `"issues.status.done": "Listo"` en
`ui/src/i18n-es-ar/dictionary/es-AR/explicit.json:10`; al lado,
`navigation.taskViews.done` e `issues.filter.done` sí dicen «Terminadas». Es una
línea de diccionario: **Traductor i18n**.

**H-2 · `backlog` queda en inglés.** En la misma leyenda sale «Backlog»; el
glosario dice «Reserva». No hay clave `issues.status.backlog` en el
diccionario. También aparece escrito «Backlog» dentro de una cadena larga ya
traducida (`issues.json:26`), así que puede ser una decisión consciente de
dejarlo como nombre propio — si lo es, le falta la fila en el glosario.
**Traductor i18n**, o **Lead** si es decisión.

**H-3 · El panel está casi todo sin traducir.** «Agents Enabled», «Tasks In
Progress», «Month Spend», «Pending Approvals», «Run Activity», «Tasks by
Status», «Success Rate», «Last 14 days», «RECENT TASKS», «See all agents», «No
recent agent runs.», «Skip to Main Content». No sé si el panel entra en el
alcance del corte 2; lo anoto porque ahora **se puede ver**, que es
exactamente lo que no se podía antes. **Lead** para el alcance.

**Para QA:** con esto se puede hacer la pasada de desbordes que quedó pendiente
(punto 8 de CHA-28). Los dos bundles están construidos y servidos con los
comandos de §2, y el arnés de CHA-9 (`app-overflow.mjs`, `headroom.mjs`,
`functional.mjs`) sirve tal cual apuntando a 5373 y 5274, con la corrección del
mock de §5 ya puesta.

## 7. Lo que se tocó

Un archivo: este. Fuera del worktree, `/paperclip/workspaces/.cha35-arnes/` (el
arnés) y una línea en `.git/info/exclude` para `ui/dist-es-ar/`. **Cero archivos
de upstream**, `pnpm-lock.yaml` intacto, `node_modules` no se commitea.
