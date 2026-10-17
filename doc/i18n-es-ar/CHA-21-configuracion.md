# CHA-21 — Diccionario es-AR de la sección Configuración (corte 2)

Bitácora de la tarea: qué entró al diccionario, qué quedó afuera y por qué, y
las cadenas riesgosas que CHA-20 (Arquitecto) y QA necesitan como casos de
prueba.

Worktree `/paperclip/workspaces/es-ar-corte2`, branch `es-ar/corte2`.

## 1. Cómo se sacaron las cadenas

Las cadenas **no** se leyeron a ojo del `.tsx`: se compiló cada archivo con
esbuild (`loader: tsx`, `jsx: automatic`) y se leyeron los hijos reales del JSX
y los props de texto que traduce el shim (`children`, `placeholder`, `title`,
`aria-label`, `alt`, `label`). Eso importa porque el JSX parte las oraciones:

- `{days} days` llega como `" days"` (el número es otro hijo), así que la
  entrada correcta es el literal `"days"`, no un patrón con número.
- `… remove the <code>x</code> key from the …` llega como cuatro cadenas, cada
  una traducida por separado y en ese orden.
- Los espacios al borde los repone el overlay; la clave va sin ellos.

Después, un chequeo inverso confirma que **cada una de las 386 claves agregadas
aparece como cadena real** en el código compilado de las pantallas entregadas.
Las únicas cuatro que no aparecen literalmente son las etiquetas de retención
(`"2 weeks"`, `"4 weeks"`, `"3 months"`, `"6 months"`), que se arman en JS a
partir de conjuntos cerrados de presets; ver §4.

## 2. Qué se entregó

Pantallas completas, en el orden de prioridad de la tarea:

| Pantalla | Puntos de entrada |
|---|---|
| Navegación de Configuración | `components/CompanySettingsSidebar.tsx` |
| General | `pages/CompanySettings.tsx`, `pages/InstanceGeneralSettings.tsx` |
| Profile | `pages/ProfileSettings.tsx`, `components/InboxAgentPolicyControl.tsx` |
| Members y Access | `pages/CompanyAccess.tsx`, `components/access/InvitesSection.tsx`, `components/PageTabBar.tsx` |
| Connections | `pages/CompanyConnections.tsx`, `components/decision-models/DecisionModelSettings.tsx`, `components/fast-responses/FastResponseSettings.tsx` |
| Environments | `pages/CompanyEnvironments.tsx`, `components/environment-variables-editor/*` |

Entradas agregadas, por archivo de diccionario:

| Archivo | Entradas |
|---|---|
| `settings.json` | 276 |
| `connections.json` | 48 |
| `errors.json` | 32 |
| `common.json` | 30 |
| **Total** | **386** |

`patterns.ts`: 3 patrones nuevos (ver §4). `explicit.json`: sin cambios (no hizo
falta ninguna clave punteada nueva para lo entregado).

Palabras que son iguales en los dos idiomas **no se agregaron a propósito**:
General, Experimental, Plugins, Local, Sandbox, Host, Driver, Logo. Una entrada
que no cambia nada es ruido y encima suma superficie de sobretraducción.

## 3. Qué quedó sin traducir

Pantallas de Configuración que no se tocaron, con el conteo de **candidatos
crudos** del extractor (incluye ruido: valores técnicos, clases de CSS que se
cuelan, fragmentos; la parte realmente traducible ronda el 70 %):

| Pantalla | Candidatos | Nota |
|---|---|---|
| Secrets | 412 | La más grande y la más partida: proveedores, vaults, AWS discovery, y muchas oraciones cortadas por chips y nombres (`"Permanently removes"` + nombre + `". Active bindings will fail…"`, `"View references ("`, `"place"`/`"places"`, `"match"`/`"matches"`). Necesita una pasada propia. |
| Experimental | 164 | |
| Import | 87 | |
| Plugins | 81 | |
| Adapters | 77 | Incluye `components/PathInstructionsModal.tsx`. |
| Export | 41 | |

Componentes compartidos que aparecen en Configuración pero son de otra área
(configuración de agentes), así que corresponden a un corte de Agentes:
`agent-config-primitives.tsx` (57), `JsonSchemaForm.tsx` (20),
`SecretBindingPicker.tsx` (19).

Cadenas sueltas dentro de lo entregado que **se dejaron en inglés a propósito**,
porque traducirlas por literal rompe la pantalla:

1. **`Archive {nombre} and move active assignments…`** (`CompanyAccess.tsx`:507).
   El primer trozo es `"Archive"`, que ya está en `common.json` como
   «Archivar» (botón). La oración queda «Archivar Juan y reasignar…»: le falta
   la «a». El resto de la oración sí se tradujo. Para que quede bien hace falta
   §7.5 en esa línea.
2. **`{n} more task{s}`** (`CompanyAccess.tsx`:559). Llega como tres hijos:
   número, `" more task"` y `"s"`. En castellano el plural no se arma pegando
   una `s` al final, así que no hay traducción por literal que funcione.
   Necesita §7.5.
3. **`Reassign {agent|agents} to`** (`CompanyEnvironments.tsx`:2562). Llega
   partido en `"Reassign"`, `"agent"`/`"agents"` y `"to"`. Traducir `"agent"` y
   `"to"` como literales globales es inaceptable (pegarían en toda la
   interfaz). Necesita §7.5.
4. **`including {lista de temas}`** (`InstanceGeneralSettings.tsx`:117). El
   fragmento es la palabra sola `" including "`, y la lista que sigue se arma
   en JS con etiquetas que no pasan por el diccionario, así que traducir sólo
   «including» deja la oración mezclada.
5. **`{n} sandbox leases`, `{n} sandbox`, `{n} candidates`** y otros plurales
   contados: ver §4.
6. **`window.confirm("Archive organization \"X\"? …")`**
   (`CompanySettings.tsx`:400). No pasa por JSX: el overlay no lo ve y no se
   puede traducir por diccionario. Si importa, es un cambio de Dev UX/UI.

Y dos nits de concordancia que quedan visibles, por si QA los ve y los reporta
como bug: en General → «Invitación de arranque» el valor muestra «Activo» /
«Ninguno» (masculino, porque esos literales son globales y en Members
concuerdan con «miembro» y con «estado»). Lo correcto ahí sería «Activa» /
«Ninguna», y la única salida limpia es §7.5 con clave punteada.

## 4. Patrones y plurales contados

Patrones nuevos en `patterns.ts` (los tres con captura de texto libre):

```
/^(.+) is archived$/                              → "$1 quedó archivada"
/^Switched to (.+)\.$/                            → "Pasaste a $1."
/^Stored in Paperclip file storage for (.+)\.$/   → "Guardado … para $1."
```

**Ningún patrón con número**, y no por olvido. El test de §7.4
(`overlay.test.ts`, «todo patrón con número tiene su literal singular al lado»)
deriva el singular cambiando `(\d+)` por `1` **sin despluralizar**: para
`/^(\d+) weeks$/` espera el literal `"1 weeks"`, que no existe en el código. O
sea que, como está, el test no deja pasar ningún patrón con número —y el propio
ejemplo del ADR 0001 §7.4 (`/^(\d+) tasks$/` con literal `"1 task"`) tampoco
pasaría.

Para la retención de backups eso se esquivó **enumerando**, porque los presets
son conjuntos cerrados en `packages/shared/src/types/instance.ts`:
`[3,7,14]` días, `[1,2,4]` semanas, `[1,3,6]` meses. De ahí salen las cuatro
claves que no aparecen literalmente en el código. Si upstream agrega un preset,
esa etiqueta va a aparecer en inglés.

Para los plurales contados abiertos (`{n} sandbox leases`, `{n} agents`,
`{n} candidates`, `{n} places`, `{n} matches`) no hay salida por diccionario
hasta que se resuelva lo del test. **Pedido para el Arquitecto**: decidir si se
corrige la derivación del test o si los contados pasan a ser §7.5 por regla.

## 5. Cadenas riesgosas (casos de prueba para CHA-20 / QA)

El overlay traduce cualquier texto que pase por JSX, incluido el que escriben
las personas y los agentes. Estas son las entradas que agregué de **una o dos
palabras que alguien podría razonablemente escribir** como nombre de proyecto,
nombre de agente o título de tarea. Están **todas en el diccionario a
propósito**: la pantalla las necesita. La lista es para que QA pruebe el
blindaje, no para sacarlas.

### Nivel 1 — una sola palabra (riesgo alto)

`Access` → Acceso · `Action` → Acción · `Active` → Activo · `Adapters` →
Adaptadores · `Admin` → Administrador · `Appearance` → Apariencia ·
`Connections` → Conexiones · `Copied` → Copiado · `Current` → Actual · `Daily`
→ Diario · `days` → días · `Disable` → Desactivar · `Disconnect` → Desconectar
· `Environments` → Entornos · `Export` → Exportar · `Finished` → Terminó ·
`For` → Para · `Hiring` → Contratación · `Humans` → Personas · `Import` →
Importar · `Inactive` → Inactivo · `Invites` → Invitaciones · `Members` →
Miembros · `Monthly` → Mensual · `Operator` → Operador · `Owner` → Dueño ·
`Pending` → Pendiente · `Port` → Puerto · `Provider` → Proveedor · `Ready` →
Listo · `Relink` → Volver a vincular · `Requirement` → Requisito · `Revert` →
Revertir · `Revoke` → Revocar · `Rollback` → Volver atrás · `Saved` → Guardado
· `Secrets` → Secretos · `State` → Estado · `Suspended` → Suspendido · `Test`
→ Probar · `Undo` → Deshacer · `Unset` → Sin definir · `Username` → Usuario ·
`Value` → Valor · `Version` → Versión · `Viewer` → Lector · `Weekly` → Semanal

Los que más probable es que peguen en contenido real: **Secrets, Access,
Members, Environments, Connections, Export, Import, Adapters, Owner, Admin,
Operator, Viewer, Active, Pending, Ready, Test, Value, State**.

### Nivel 2 — dos palabras que suenan a nombre propio

`Active template` · `Add connection` · `Add environment` · `Add variable` ·
`Assigned team` · `Backup retention` · `Billing problem` · `Browser terminal`
· `Custom image` · `Danger Zone` · `Decision model` · `Default environment` ·
`Display name` · `Disruption score` · `Environment variables` · `Fast
response` · `Hide value` · `Invite history` · `Join request` · `Known hosts` ·
`Leave unassigned` · `Membership status` · `Not configured` · `Not ready` ·
`Open terminal` · `Organization Members` · `Organization name` · `Organization
role` · `Organization secret` · `Page section` · `Private key` · `Run test` ·
`Secret name` · `Secret value` · `Secret version` · `Setup required` · `Show
value` · `SSH host` · `Task reassignment` · `Template setup` · `Test
connection` · `Test provider` · `Test response` · `Text value` · `Unsupported
provider` · `User secret` · `Value source` · `Variable name` · `Variable
value` · `View usage`

### Nivel 3 — patrones que capturan texto libre

No son entradas de una o dos palabras, pero son el peor caso: le pegan a
**cualquier** cadena con esa forma, venga de la interfaz o de una persona. Una
tarea titulada «Deploy is archived» se muestra «Deploy quedó archivada».

```
/^(.+) is archived$/                              (nuevo en este corte)
/^Switched to (.+)\.$/                            (nuevo en este corte)
/^Stored in Paperclip file storage for (.+)\.$/   (nuevo en este corte)
/^Select an organization to view (.+)\.$/         (corte 1)
/^Are you sure you want to uninstall (.+)\?$/     (corte 1)
/^Invite people to (.+)$/                         (corte 1)
/^Change view — currently (.+)$/                  (corte 1)
```

La lista completa de las 169 entradas nuevas de una o dos palabras —incluidas
las que descarté como poco probables— se puede reproducir comparando las claves
agregadas contra `HEAD` en los cuatro archivos de diccionario.

## 6. Verificación

```sh
cd /paperclip/workspaces/es-ar-corte2/ui
./node_modules/.bin/vitest run src/i18n-es-ar src/i18n/locale-validation.test.ts
# 54 pasan, 8 skipped — igual que la línea base
```
