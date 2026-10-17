# Glosario es-AR para la interfaz de Paperclip

**Versión 2.** Este archivo es **el original**: nació como documento de Paperclip
en CHA-1 y desde CHA-21 (corte 2) vive acá. El documento de Paperclip queda como
registro histórico; lo que manda es este archivo.

**Variante:** español rioplatense (es-AR), voseo, registro informal.

Cómo se usa: las traducciones del overlay (`ui/src/i18n-es-ar/dictionary/`)
salen de acá. Si una pantalla necesita un término que no está en estas tablas, se
decide, se traduce y **se agrega acá en la misma tarea**.

## Cambios respecto de la v1

La v1 se escribió sin acceso al repo: fijaba el registro y los términos de
dominio, pero no los había visto en pantalla. La v2 agrega lo que salió de
traducir la sección Configuración (CHA-21):

- Roles de membresía, estados de membresía y vocabulario de invitaciones (§2, §3).
- Vocabulario de Entornos: plantillas, imagen propia, reservas de sandbox,
  vínculos (§2).
- Vocabulario de Conexiones: modelo de decisión, respuesta rápida (§2).
- §8 nueva: las cadenas partidas y los plurales contados, que son un problema
  del overlay y no del idioma.
- §7 ampliada con los términos técnicos que quedan en inglés en estas pantallas.

## 1. Reglas de estilo

| Regla | Sí | No |
|---|---|---|
| **Voseo en el texto corrido** y en instrucciones | «Aceptá la tarea», «si querés», «tenés que conectar» | «Acepta la tarea», «si quieres», «tienes que» |
| **Botones y acciones en infinitivo** (no voseo) | «Guardar», «Crear tarea», «Conectar» | «Guardá», «Creá» |
| **Mayúscula solo en la primera palabra** (sentence case; el inglés usa Title Case, el español no) | «Nueva tarea», «Configuración de la empresa» | «Nueva Tarea», «Configuración De La Empresa» |
| **Nada de español peninsular** | agregar, archivo, hacer clic, computadora, celular | añadir, fichero, pulsar, ordenador, móvil |
| **Sin voz pasiva ni tercera persona impersonal** cuando se le habla al usuario | «No tenés tareas asignadas» | «El usuario no tiene tareas asignadas» |
| **Concordancia de género con el sustantivo** | «Tarea bloqueada», «Agente contratado» | «Tarea bloqueado» |
| **Fecha y hora** formato local | 17/10/2026, 14:30 | 10/17/2026, 2:30 PM |
| **Números** coma decimal, punto de miles | 1.234,56 | 1,234.56 |
| **Placeholders y variables intactos** | «{count} tareas», «Hola, {name}» | traducir o reordenar la variable sin cuidado |

Dos cosas que conviene tener presentes al aplicar:

- **El español ocupa entre 20 % y 25 % más espacio que el inglés.** Botones,
  encabezados de columna y chips de estado son donde primero se rompe el diseño.
  Si un texto no entra, hay que acortarlo, no dejarlo cortado. En las tablas de
  Configuración eso ya pesó: «Invited by» quedó «Invitó», no «Invitado por».
- **La pluralización no es la misma.** Donde el inglés resuelve con `s`, acá hace
  falta forma para 1 y para el resto: «1 tarea» / «2 tareas». Para cero, mejor
  negar: «No hay tareas» antes que «0 tareas».

## 2. Entidades y navegación

| Inglés | es-AR | Nota |
|---|---|---|
| Company | Empresa | |
| Board | Directorio | «board member» → «miembro del directorio» |
| Agent | Agente | |
| Project | Proyecto | |
| Task / Issue | Tarea | Un solo término en español, aunque el inglés use dos |
| Subtask / Child task | Subtarea | |
| Goal | Objetivo | |
| Plan | Plan | |
| Document | Documento | |
| Work product | Entregable | |
| Comment | Comentario | |
| Thread | Hilo | |
| Card | Tarjeta | |
| Run | Ejecución | |
| Routine | Rutina | |
| Connection | Conexión | |
| Approval | Aprobación | |
| Repository | Repositorio | |
| Adapter | Adaptador | |
| Blocker | Bloqueo | «blocked by» → «bloqueada por» |
| Inbox | Bandeja de entrada | «Bandeja» sola si no entra |
| Mine | Mis tareas | Más claro que «Míos» |
| Dashboard | Panel | |
| Overview | Resumen | |
| Activity | Actividad | |
| Settings | Configuración | |
| Usage | Uso | |
| Cost / Spend | Costo / Gasto | «costo», no «coste» |
| Assignee | Responsable | |
| Reviewer | Revisor | |
| Status | Estado | «State» también → «Estado» |
| Priority | Prioridad | |
| Label | Etiqueta | |
| Agent prompt / instructions | Instrucciones del agente | |
| Heartbeat | Ciclo de actividad | «Latido» es literal y no comunica nada; si el contexto ya es claro, «ciclo» solo |

### Navegación de Configuración (CHA-21)

| Inglés | es-AR | Nota |
|---|---|---|
| General | General | Igual en los dos idiomas: **no entra al diccionario** |
| Profile | Perfil | |
| Members | Miembros | |
| Secrets | Secretos | |
| Environments | Entornos | |
| Connections | Conexiones | «Connectors» (otra pantalla) → «Conectores» |
| Access | Acceso | Singular: es el nombre de la sección, no una lista |
| Export / Import | Exportar / Importar | Son pantallas de acción, van en infinitivo |
| Experimental | Experimental | Igual en los dos idiomas: **no entra al diccionario** |
| Plugins | Plugins | Se usa en inglés; «complementos» es peninsular |
| Adapters | Adaptadores | |
| Back to app | Volver a la app | |

### Membresías, invitaciones y roles (CHA-21)

| Inglés | es-AR | Nota |
|---|---|---|
| Member | Miembro | |
| Membership | Membresía | «Membership status» → «Estado de la membresía» |
| Join request | Pedido de ingreso | Ya venía de la navegación del corte 1 |
| Invite *(sustantivo)* | Invitación | |
| Invite *(verbo)* | Invitar | |
| Invited by | Invitó | Encabezado de columna: «Invitado por» no entra |
| Inviter | Quién invitó | |
| Humans | Personas | Más natural que «Humanos» |
| Viewer | Lector | |
| Operator | Operador | |
| Admin | Administrador | El valor técnico `admin` no se traduce |
| Owner | Dueño | El mismo término que usa el dueño para sí mismo |

### Entornos (CHA-21)

| Inglés | es-AR | Nota |
|---|---|---|
| Environment | Entorno | |
| Environment variable | Variable de entorno | |
| Execution target | Destino de ejecución | |
| Binding | Vínculo | «bindings need attention» → «vínculos necesitan atención» |
| Template | Plantilla | |
| Custom image | Imagen propia | «imagen personalizada» es más largo y no agrega nada |
| Capture | Captura / capturar | |
| Probe | Sondeo | «Environment probe failed» → «Falló el sondeo del entorno» |
| Sandbox lease | Reserva de sandbox | «arrendamiento» es literal y no comunica; «reserva» sí |
| Provider | Proveedor | |
| Known hosts | Hosts conocidos | El bloque `known_hosts` queda en inglés |
| Strict host key checking | Verificación estricta de la clave del host | |
| Stream *(verbo)* | Transmitir | |

### Conexiones (CHA-21)

| Inglés | es-AR | Nota |
|---|---|---|
| Decision model | Modelo de decisión | |
| Fast response | Respuesta rápida | |
| Shared API connection | Conexión de API compartida | |
| Billing | Facturación | |
| Company-sponsored | A cuenta de la empresa | Más claro que «patrocinado por la empresa» |

### General y Perfil (CHA-21)

| Inglés | es-AR | Nota |
|---|---|---|
| Display name | Nombre para mostrar | |
| Appearance | Apariencia | |
| Hiring | Contratación | |
| Danger Zone | Zona de riesgo | |
| Deployment | Despliegue | |
| Backup retention | Retención de los backups | «backup» queda en inglés (§7) |
| Sign out | Cerrar sesión | |

## 3. Estados

Los valores técnicos (`in_review`, `todo`) **no se traducen**: viven en la base y
en la API. Lo que se traduce es la etiqueta que se muestra.

| Valor técnico | Etiqueta es-AR |
|---|---|
| `backlog` | Reserva |
| `todo` | Por hacer |
| `in_progress` | En curso |
| `in_review` | En revisión |
| `done` | Terminada |
| `blocked` | Bloqueada |
| `cancelled` | Cancelada |

### Estados de membresía, de cuenta y de instancia (CHA-21)

Van en masculino porque concuerdan con «estado», que es el sustantivo que los
encabeza en pantalla («Estado de la membresía: Activo»).

| Inglés | es-AR |
|---|---|
| Active | Activo |
| Inactive | Inactivo |
| Pending | Pendiente |
| Suspended | Suspendido |
| Unset | Sin definir |
| Ready | Listo |
| Not ready | No está listo |
| Setup required | Falta configurar |
| Not configured | Sin configurar |

## 4. Prioridades

| Valor técnico | Etiqueta es-AR |
|---|---|
| `critical` | Crítica |
| `high` | Alta |
| `medium` | Media |
| `low` | Baja |

## 5. Acciones y botones

| Inglés | es-AR |
|---|---|
| Save | Guardar |
| Cancel | Cancelar |
| Create | Crear |
| Add | Agregar |
| Edit | Editar |
| Delete | Eliminar |
| Remove | Quitar |
| Close | Cerrar |
| Submit | Enviar |
| Accept | Aceptar |
| Reject | Rechazar |
| Approve | Aprobar |
| Confirm | Confirmar |
| Assign | Asignar |
| Unassign | Quitar asignación |
| Delegate | Delegar |
| Hire | Contratar |
| Archive | Archivar |
| Retry | Reintentar |
| Search | Buscar |
| Filter | Filtrar |
| Sort | Ordenar |
| Refresh | Actualizar |
| Copy | Copiar |
| Download | Descargar |
| Upload | Subir |
| Connect / Disconnect | Conectar / Desconectar |
| Enable / Disable | Activar / Desactivar |
| On / Off | Activado / Desactivado |
| Sign in / Sign out | Iniciar sesión / Cerrar sesión |
| Continue | Continuar |
| Back / Next | Volver / Siguiente |
| Done *(botón)* | Listo |
| Dismiss | Descartar |
| Got it | Entendido |
| Learn more | Más información |
| View all | Ver todo |
| Show more / Show less | Ver más / Ver menos |

### Agregadas en CHA-21

| Inglés | es-AR | Nota |
|---|---|---|
| Test | Probar | «Test connection» → «Probar la conexión» |
| Run test | Probar | |
| Undo | Deshacer | |
| Revert | Revertir | |
| Rollback | Volver atrás | |
| Relink | Volver a vincular | |
| Revoke | Revocar | |
| Reassign | Reasignar | |
| Store as secret | Guardar como secreto | |

Los botones que mandan a otra pantalla llevan artículo: «Abrir Miembros»,
«Administrar la conexión», «Volver a los entornos».

## 6. Estados de carga, vacíos y errores

| Inglés | es-AR |
|---|---|
| Loading… | Cargando… |
| Saving… | Guardando… |
| Saved | Guardado |
| No results | Sin resultados |
| No tasks yet | Todavía no hay tareas |
| Nothing selected | No seleccionaste nada |
| Something went wrong | Algo salió mal |
| Try again | Probá de nuevo |
| Failed to load | No se pudo cargar |
| Required field | Campo obligatorio |
| Are you sure? | ¿Seguro? |
| This can't be undone | Esto no se puede deshacer |
| Unsaved changes | Cambios sin guardar |
| Permission denied | Permiso denegado |
| Not found | No se encontró |

En los mensajes de error conviene decir qué pasó y qué hacer, en ese orden: «No
se pudo guardar la tarea. Revisá la conexión y probá de nuevo» funciona mejor que
«Error al guardar».

Dos moldes que se repiten en Configuración:

- `Failed to <algo>` → **«No se pudo <algo>»**, nunca «Falló al…».
- `Select an organization to <algo>` → **«Elegí una empresa para <algo>»**.
- Los puntos suspensivos se copian **como estén en el código**: `...` y `…` son
  dos claves distintas para el overlay (§7.1 del ADR 0001).

## 7. Lo que NO se traduce

- **Nombres propios:** Paperclip, Claude, Anthropic, GitHub, Gitea, Opus,
  Sonnet, Haiku, OpenAI, OpenRouter, AWS, Apps.
- **Identificadores técnicos:** valores de estado y prioridad en base y API,
  claves de documento, slugs, nombres de variables de entorno, identificadores
  de tareas (CHA-1).
- **Contenido generado:** lo que escriben los agentes o el usuario en
  comentarios, documentos y descripciones. Eso ya nace en español por separado.
- **Términos de Git:** commit, branch, merge, pull request. En la práctica
  argentina se usan en inglés; traducirlos genera más confusión que claridad.
- **Términos técnicos que en es-AR se usan en inglés** (CHA-21): backup, log,
  host, driver, sandbox, plugin, API, SSH, PEM, KMS, JSON, gzip, DNS, IP, LAN,
  VPN, `known_hosts`, prompt, token, CLI.
- **Palabras que son iguales en los dos idiomas** (General, Experimental, Local,
  Sandbox, Host, Driver, Logo, Plugins): no entran al diccionario. Una entrada
  que no cambia nada es ruido y encima suma superficie de sobretraducción.

### Agregadas en CHA-27 (lote compartido: las 494 largas y las 987 cortas)

El lote compartido es el que toca dos o más de las doce pantallas del alcance,
así que estos términos son los que más se repiten en toda la app.

| Inglés | es-AR | Nota |
|---|---|---|
| Workspace | Espacio de trabajo | «Workspaces» solo, cuando no entra → «Espacios» (ya venía del corte 1) |
| Worktree / branch / commit / diff | worktree / branch / commit / diff | Términos de Git: quedan en inglés (§7) |
| Runner | runner | Queda en inglés; «Runner Inspector» → «Inspector del runner» |
| Trace / frame | trace / frame | Quedan en inglés, igual que en CHA-25 |
| Header *(HTTP)* | Encabezado | «header» suelto es jerga; en una etiqueta de formulario no comunica |
| Timeout | Tiempo de espera | «Timeout seconds» → «Segundos de espera» |
| Adapter | Adaptador | Ya venía de §2 |
| Composer | Redactor | El cuadro donde se escribe el mensaje |
| Claim *(sobre un worktree)* | Reserva | «Worktree claimed by» → «Worktree reservado por» |
| Dirty changes | Cambios sin commitear | «sin guardar» es otra cosa: están guardados, no commiteados |
| Break-glass | De emergencia | «Reconcile anyway (break-glass)» → «Reconciliar igual (de emergencia)» |
| Preset | Preajuste | |
| Raw | Crudo | «Raw frames» → «Frames crudos» |
| Redacted | Censurado | «Exact unredacted frame» → «Frame exacto sin censurar» |
| Parked | En reserva | Concuerda con «Reserva» de `backlog` (§3) y evita el género |
| Running | En curso | Mismo criterio: sirve para ejecución, servicio y agente sin género |
| Manager *(de un agente)* | Jefe | «No manager» → «Sin jefe»; «Reports to» → «Reporta a» |
| Parent / child *(tareas)* | Padre / hija | «Enable parent-child nesting» → «Activar el anidado padre-hija» |

Tres reglas que salieron de este lote y valen para todo lo que venga:

1. **`X by` es un verbo en pasado, no un participio.** Es la regla que ya estaba
   en «Invited by → Invitó» y acá se aplica parejo: «Approved by» → «Aprobó»,
   «Rejected by» → «Rechazó», «Proposed by» → «Propuso», «Resolved by» →
   «Resolvió», «Withdrawn by» → «Retiró», «Connected by» → «Conectó». Esquiva
   el género del sujeto, que el overlay no puede saber.
2. **Las etiquetas de estado van en masculino** (§3: concuerdan con «estado»), y
   cuando hay una forma sin género disponible se prefiere esa: «Running» → «En
   curso», «Disconnected» → «Sin conexión», «Unassigned» → «Sin asignar»,
   «Unavailable» → «No disponible».
3. **Una cadena inglesa que necesita dos españoles distintos según la pantalla no
   entra.** El ADR 0001 revisión 2 pide resolverla **por sitio** y ese mecanismo
   todavía no existe en esta rama: el marcado de ADR 0002 emite `__tEs(texto)`
   sin ninguna identidad del sitio, y el único canal que distingue —`tEs(clave,
   inglés)`— cuesta una edición de upstream, con presupuesto cero. Las tres que
   quedaron afuera por esto son `Open`, `Run` y `Comment`, y el motivo de cada
   una está en [CHA-27](CHA-27-lote-compartidos.md). `Review` sí entró, como
   sustantivo («Revisión»), porque se miraron sus sitios y los tres son
   sustantivo.

   **Corrección de CHA-30:** `Review` tiene **17 archivos** con sitio marcado,
   no tres, y en `IssueRunLedger.tsx:750` es **verbo** («Review {ID} for
   recovery context.»), donde «Revisión» se lee mal. La entrada no se tocó
   —cambiarla rompe los sitios donde sí es sustantivo— y queda como cuarto
   candidato a `tEs()`, al lado de `Open`, `Run` y `Comment`. La lección es de
   método: los sitios se cuentan corriendo `markText` sobre todo `ui/src`, no
   grepeando a ojo.

### Agregadas en CHA-30 (lote `tareas`: 154 largas y 386 cortas)

Es la pantalla más cargada del alcance: el detalle de una tarea, su chat, el
visor de archivos, el panel lateral y el libro de ejecuciones.

| Inglés | es-AR | Nota |
|---|---|---|
| Watchdog | Centinela | «Watchdog task» → «Tarea centinela»; «Watchdog agent» → «Agente centinela». «Perro guardián» no entra en una etiqueta |
| Watch / watched | Vigilar / vigilado | «the watched task tree» → «el árbol de tareas vigilado» |
| Goal | Objetivo | Ya venía de §2 |
| Objective | Consigna | Para no escribir «Objetivo del objetivo»: «Goal objective» → «Consigna del objetivo» |
| Steer / steering | Redirigir | «Continued after steering ·» → «Siguió después de redirigir ·» |
| Override *(de modelo)* | Reemplazo | El par del carril es «Primary / Override» → «Principal / Reemplazo» |
| Lane | Carril | «Model lane» → «Carril del modelo» |
| Run ledger | Libro de ejecuciones | |
| Runtime *(duración)* | Tiempo de ejecución | `Runtime {duración}` en el resumen de costos; no es el «runtime» de sistemas |
| Monitor *(sección)* | Monitoreo | Es el sustantivo de la sección, no el verbo |
| Triage | Clasificación | |
| Handoff | Traspaso | «Task handoff» → «Traspaso de la tarea» |
| Subtree | Subárbol | |
| Jobs | Trabajos | Los comandos del espacio de trabajo, no las tareas |
| Schedule *(cron)* | Programación | |
| Lock / Unlock *(documento)* | Bloquear / Desbloquear | |
| Idempotent claim | Reserva idempotente | §7: Claim → Reserva |
| Raw / Rendered | Crudo / Renderizado | |
| Elapsed | Transcurrido | |
| Requester | Quién pidió | Misma forma que «Inviter → Quién invitó» |
| Approvers / Reviewers | Aprobadores / Revisores | |
| Originating | Origen | Encabezado de fila: «Originating» → «Origen», no «Originante» |
| Old / New *(badges de diff)* | Anterior / Nuevo | Ver abajo |
| Hidden follow-up | Seguimiento oculto | |

Estados nuevos, todos en una forma **sin género** o en masculino (§3):

| Inglés | es-AR |
|---|---|
| Queued | En cola |
| In flight | En tránsito |
| Interrupted | Interrumpido |
| Completed | Completado |
| Exhausted | Agotado |
| Unhealthy | Con problemas |
| Out of date | Desactualizado |
| Working now | Trabajando ahora |
| Browsing / Watching | Navegando / Vigilando |

Dos reglas que salieron de este lote:

1. **`Old` / `New` van «Anterior» / «Nuevo», no «Anterior» / «Nueva».** `New` es
   botón en un lugar («Nuevo documento», acortado a «Nuevo» en mobile) y badge
   de diff en cuatro más; «Nuevo» sirve en los dos y «Nueva» sólo en el badge.
   Con «Anterior» el par del diff se lee como se lee un diff en castellano.
2. **Las cadenas que el código arma con una plantilla van por formato, no por
   literal.** El visor de archivos escribe `` `Show rendered ${previewLabel}` ``,
   así que la entrada correcta es la clave `Show rendered {0}`, no
   `Show rendered Markdown`. La medición entrega el literal expandido porque lo
   vio en pantalla; el diccionario tiene que entrar por donde el compilador lo
   vio escrito (ADR 0002 §7.5).

Lo que **no entró** de este lote y conviene no volver a intentar: `Branch`,
`Commit`, `Pull request` y `Diff —` (términos de Git, §7), y `Chat`, `Error`,
`Video`, `Markdown`, `PLAN`, `Tokens`, `CSV ·` (iguales en los dos idiomas).

## 8. Cadenas partidas y plurales contados

Esto no es una regla de idioma: es cómo llega el texto al overlay, y define qué
se puede traducir y qué no. Se verifica compilando el `.tsx` y mirando los hijos
reales del JSX, no leyendo el código a ojo.

- **Una oración cortada por un `<code>`, un nombre o un chip llega como varias
  cadenas.** Cada trozo se traduce por separado y el orden de los trozos no se
  puede cambiar. Si el castellano necesita otro orden, la traducción por trozos
  no sirve y hay que ir por la clave punteada de §7.5.
- **Los espacios al borde los repone el overlay**: la clave del diccionario va
  siempre sin espacios al borde.
- **Los plurales contados (`{n} items`) casi nunca se pueden traducir por
  patrón.** Dos razones:
  1. Muchas veces el número y el sustantivo son **dos hijos distintos** del JSX
     (`{days} days` llega como `" days"`), así que alcanza con el literal
     `"days"` → `"días"`.
  2. Cuando sí llega armado (`${weeks} weeks`), el test de §7.4 pide el literal
     singular y lo deriva cambiando `(\d+)` por `1`, o sea espera
     `"1 weeks"` —que no existe—. Mientras eso siga así, conviene **enumerar**
     si el conjunto es cerrado (los presets de retención de backups son
     `[3,7,14]`, `[1,2,4]`, `[1,3,6]`) y dejar el caso anotado si es abierto.
- **`window.confirm` y `window.alert` no pasan por JSX**: no se traducen nunca.
  Si un texto importante vive ahí, es un pedido para Dev UX/UI, no una entrada
  de diccionario.
