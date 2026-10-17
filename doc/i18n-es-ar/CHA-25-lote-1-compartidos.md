# CHA-25 — lote 1 del corte 2: las cadenas largas de los componentes compartidos

Traducción del lote `compartidos--largas` (502 cadenas de 4 palabras o más, extraídas
en `/paperclip/workspaces/.i18n-medicion/`). Son los componentes que alcanzan dos o
más de las doce pantallas del alcance, así que cada entrada rinde en varias pantallas
a la vez.

**Entregado: 494 de 502 entradas.** Las 8 restantes se omitieron a propósito (ver §4).
No se tocó ningún archivo de upstream: el presupuesto de `tEs()` del ADR 0001 §7.5
sigue en 36 de ~50.

## 1. Dónde quedó cada cosa

| Archivo | Entradas nuevas | Total | Qué junta |
| --- | --- | --- | --- |
| `connections.json` | 209 | 209 | conexiones, conectores, proveedores, OAuth, secretos y vínculos, apps y herramientas, hojas de Google |
| `issues.json` | 107 | 107 | tareas, bloqueantes, próximo paso, recuperación, borradores y comentarios, espacio de trabajo y worktrees |
| `agents.json` | 45 | 45 | identidad del agente, confianza y contención, modelo y esfuerzo, plantilla de prompt, plantel |
| `common.json` | 32 | 130 | chrome genérico: pestañas, vistas previas, coincidencias de búsqueda, carpetas |
| `traces.json` | 31 | 31 | **archivo nuevo** — traces crudos del proveedor, eventos canónicos de PRP, frames, etapas de interpretación |
| `settings.json` | 29 | 33 | techos de gasto, timeouts, clave de dispositivo, preferencia de compartir votos |
| `errors.json` | 27 | 110 | el molde "No se pudo X" |
| `audit.json` | 10 | 10 | **archivo nuevo** — registro de auditoría y feed de actividad |
| `onboarding.json` | 4 | 4 | primeros pasos |

Los dos archivos nuevos quedaron cableados en `overlay.ts` (el único archivo de la
máquina que se toca, ADR §7.2) y agregados a `ES_AR_AREAS` en `overlay.test.ts`, para
que las reglas de glosario que ya corren por archivo también los cubran.

## 2. Nueve entradas se reusaron textuales de CHA-21

Nueve cadenas de este lote ya estaban traducidas en la rama `es-ar/corte2`
(`settings.json`, diccionario de Configuración de CHA-21). Se copió **el mismo texto,
palabra por palabra**, para que las dos ramas no se contradigan cuando se junten:
`Dismiss — keep this value as plain text`, `Moves the typed value into an encrypted
organization secret and binds`, `Read our terms of service`, `Resolve a stored
organization secret at run start.`, `Resolve the responsible user's own value at run
start.`, `Reverted to text —`, `Store the value inline as plain text.`, `This value
looks sensitive — store it as a secret` y `User secrets resolve from the user
responsible for the run…`.

El lote se filtró contra el diccionario de `traduccion-es` (256 entradas), que no tiene
las 386 de `es-ar/corte2`. Por eso aparecieron repetidas: no es un error de la medición.

## 3. Decisiones de vocabulario que agrega este lote

Todo lo demás sigue el glosario v2 (documento `glosario-es-ar` de CHA-4). Lo que el
glosario no cubría y hubo que cerrar acá:

| Inglés | es-AR | Por qué |
| --- | --- | --- |
| binding / to bind | **vínculo / vincular** | es el objeto que une un secreto con un agente; "enlace" se pisa con link |
| parked work | **trabajo estacionado** | sale de la definición de `Backlog` del glosario 8.3 ("deliberadamente estacionada") |
| raw (frame, value, trace, response) | **crudo** | consistente en las 31 entradas de `traces.json` |
| frame, trace, PRP, pipeline, harness, gateway, pool, sandbox, worktree, token | **sin traducir** | préstamos técnicos, criterio del glosario 8.2 y §10 |
| manager (de un agente) | **manager** | "responsable" ya es `Responsible` y "jefe" no es lo que modela el producto. **Candidato a entrada de glosario** |
| roster | **plantel** | |
| device pairing | **emparejamiento de dispositivos** | |
| containment boundary | **límite de contención** | |
| ancestry proof | **prueba de ascendencia** | |
| failed closed | **falló del lado seguro** | |
| API key | **clave de API** | |
| Memory (la función) | **Memoria** | |

### Regla nueva: cómo se cita un control que todavía está en inglés

Muchas de estas cadenas le dicen a la persona que apriete algo: *"set it to Allowed or
Ask first"*, *"before using Run again"*, *"Select Automatic (isolated)"*. Esos nombres
de control son **cadenas cortas**, que este corte no traduce (esperan la decisión del
dueño). El criterio que se aplicó:

- **Si el control ya está traducido en el diccionario, se cita en español**: `Restablecer`,
  `Compartir`, `Configuración → Experimental`, `Secretos → Mis secretos`, `Por hacer`,
  `En curso`, `Listo`, `Cancelada`, `Conexiones`, `Auditoría`.
- **Si todavía se ve en inglés, se cita en inglés**: `Allowed`, `Ask first`, `Off`, `Run`,
  `Connect`, `Permissions`, `Automatic (isolated)`, `Unfiled`.

Es a propósito: una instrucción que manda a apretar "Permitida" cuando el botón dice
"Allowed" manda a apretar algo que no existe. **Cuando se traduzcan las cortas hay que
volver sobre estas 8 entradas**, que son todas las que citan un control en inglés:

| Archivo | Entrada (clave inglesa, abreviada) | Control citado |
| --- | --- | --- |
| `common.json` | `in this folder won't be deleted…` | Unfiled |
| `connections.json` | `. Existing Off and Ask first choices are preserved.` | Off, Ask first |
| `connections.json` | `After authorizing, check the provider's result…` | Run |
| `connections.json` | `Allow the resume action in Permissions before continuing.` | Permissions |
| `connections.json` | `is signed in. Click Connect to use this account.` | Connect |
| `connections.json` | `— runs immediately when you press Run.` | Run |
| `connections.json` | `— set it to Allowed or Ask first.` | Allowed, Ask first |
| `agents.json` | `This saved Codex mode cannot start or recover…` | Automatic (isolated) |

## 4. Las 8 cadenas que no se tradujeron

Siete son ruido técnico del extractor —listas de clases de Tailwind que el parser
levanta como si fueran texto de interfaz: `col-span-2 w-full sm:col-auto sm:w-auto`,
`h-3.5 w-3.5 sm:h-3 sm:w-3 sm:mr-1`, `hidden h-8 shrink-0 px-2 text-xs sm:inline-flex`,
`mx-auto max-w-6xl p-4 text-foreground sm:p-8`, `w-(--sz-calc-10) …` y las dos
`max-h-(--sz-28dvh) …`. Traducirlas rompería el estilo. Es el ~3,2 % de ruido que el
`LEEME.md` de la medición ya anticipaba.

La octava es `You are agent {{ agent.name }}. Your role is {{ agent.role }}...`: es el
placeholder de la plantilla de prompt, o sea **texto que va al modelo, no a la persona**.
Entra en "contenido" del ADR 0002, no en interfaz.

## 5. Cadenas ambiguas: ninguna necesitó `tEs()`

No apareció ninguna cadena de este lote que necesite dos españoles distintos según la
pantalla. Eran todas de 4 palabras o más, y a ese largo el texto ya trae su propio
contexto. El presupuesto de ediciones de upstream queda intacto en 36.

Lo que sí quedó señalado para el Arquitecto (CHA-24): varias de estas cadenas son
**fragmentos de oración** (empiezan con `.`, `,`, `?` o terminan sin punto) porque el JSX
las parte alrededor de un `<strong>` o un nombre interpolado. Se traducen bien una por
una, pero el orden de las palabras en español no siempre permite partir la oración en el
mismo lugar. Dos casos concretos:

- `? Plain text won't notify or assign an agent.` → el `¿` de apertura vive en el
  fragmento anterior, que no está en este lote. Hasta que se traduzca, la pregunta
  queda sin signo de apertura.
- `ago · Press cancel to stop` → en español el "atrás" va después del número, igual que
  en inglés, así que este anduvo; pero no hay garantía de que pase siempre.
