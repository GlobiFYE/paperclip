# CHA-15 — Un solo nombre por estado en es-AR

Arregla H-1 y H-2 de la pasada visual de CHA-9. Dos entradas de diccionario,
cero archivos de upstream, cero presupuesto nuevo del ADR §7.5.

- Worktree: `/paperclip/workspaces/paperclip-es`, rama `traduccion-es`, sobre `48256efe7`.
- Informe de QA: `doc/i18n-es-ar/CHA-9-pasada-visual.md`.

---

## 1. De dónde salían de verdad las etiquetas

Era el primer paso de la tarea, porque el diagnóstico de QA apuntaba a un mapa
que no es el que alimenta el menú. QA señaló `IssuesList.tsx:141-142`; esas dos
líneas usan la capa explícita y rinden lo que dice la capa explícita, pero el
menú que QA fotografió decía *Listo* y *Blocked*, o sea que no leía de ahí.

**Las etiquetas del menú de cambio de estado y de los encabezados del tablero no
vienen de ningún mapa de etiquetas. Se derivan del valor técnico:**

| Dónde | Qué hace |
| --- | --- |
| `ui/src/components/StatusIcon.tsx:10-12` | `statusLabel(status)` = `status.replace(/_/g," ").replace(/\b\w/g, mayúscula)` |
| `ui/src/components/KanbanBoard.tsx:134-136` | la **misma función, copiada byte a byte** |

`StatusIcon` es el componente que rinde el menú (`:149`, un ítem por estado de
la lista de `:8`) y la etiqueta suelta con `showLabel` (`:106` y `:120`).
`KanbanBoard` rinde los encabezados de columna con su copia (`:207` y `:221`).

Entonces `backlog` → `"Backlog"`, `in_progress` → `"In Progress"`, `done` →
`"Done"`, `blocked` → `"Blocked"`. Son cadenas inglesas construidas en tiempo de
render que cruzan la frontera de JSX como children, así que **las resuelve la
capa literal del diccionario**, nunca `tEs()`. Eso explica la captura de QA
exactamente: `"Done"` tenía entrada literal (`→ Listo`), `"Blocked"` y
`"Backlog"` no, y los otros cuatro sí.

Es el hallazgo 0.1 del diccionario de CHA-4 otra vez, en dos componentes más que
los que lista esa sección. El tercer mapa, `ActivityCharts.tsx:240-248`, sí usa
la capa explícita: es el que alimenta la leyenda del Panel, la otra mitad de la
discordancia.

**Confirmado en el render real,** no por lectura: `real-components.es-ar.test.tsx`
rinde `StatusIcon` de upstream con el overlay puesto para los 7 estados.

## 2. Por qué no era un cambio de una línea

La capa literal indexa por texto, así que no puede distinguir el chip del botón.
Cambiar el literal `"Done": "Listo"` a `"Terminada"` le rompe el sentido a los
seis botones de upstream donde `Done` quiere decir "listo, terminé"
(`AgentMultiSelect.tsx:300`, `MemberMultiSelect.tsx:204`,
`SidebarCompanyMenu.tsx:312` y su gemelo `.production.tsx:312`,
`ExternalAgentInviteDialog.tsx:68`, `editable-sections.production.tsx:588`,
`RemoteMcpConnectionSetup.tsx:142`). **Ésa es la causa de fondo de H-2.**

## 3. La decisión: `done` se dice **Listo** en todas las capas

Decisión del Lead en el enunciado de CHA-15, no de QA ni del Traductor.

- **H-1 · `Blocked`:** se agrega la entrada literal `"Blocked": "Bloqueada"`.
  Coincide con lo que ya decía la capa explícita, así que no crea un segundo
  nombre. Arrastra tres literales colaterales de upstream —el estado de una
  corrida (`IssueRunLedger.tsx:115`), la categoría de un objeto externo
  (`external-objects.ts:84`) y la ventana de uso de una conexión
  (`AiConnectionUsagePanel.tsx:35`)—; los tres concuerdan en femenino, así que
  "Bloqueada" les cae bien.
- **H-1 · `Backlog`:** **no se toca.** Queda en inglés por la decisión 9.3 del
  diccionario (§8.3 del glosario), que está escalada al dueño como pregunta de
  glosario. Hay un test que lo fija, para que agregar la entrada obligue a
  cambiar el documento primero.
- **H-2 · `done`:** la capa **explícita** `issues.status.done` pasa de
  `"Terminada"` a `"Listo"`, y el literal `"Done": "Listo"` queda como estaba.

Por qué `Listo` y no `Terminada`, que es lo que sugería QA: cuesta cero archivos
de upstream y cero presupuesto del §7.5, que está en 36 de ~50 usos. Unificar en
`Terminada` obligaría a meter `tEs()` en cada sitio de literal suelto —las dos
copias de `statusLabel()`, `issue-filters.ts:86-87`, `task-views.ts:67` y la
insignia de `StatusIcon`— y no entra con ese margen. Además `Listo` es la misma
palabra que necesitan los seis botones, así que **el homógrafo deja de existir
en vez de administrarse**.

El contra, dicho: `Listo` queda en masculino al lado de `Cancelada` y
`Bloqueada`. Es una decisión de costo y la firma el Lead.

**El plural no cambia.** `navigation.taskViews.done` y `issues.filter.done`
siguen en `"Terminadas"`: son nombres de vistas y de filtros —colecciones de
tareas—, no el nombre del estado. `Blocked` mantiene el mismo corte:
**Bloqueada** el estado, **Bloqueadas** el filtro.

## 4. Los 7 estados, como se ven ahora en el menú y en el tablero

> Backlog · Por hacer · En curso · En revisión · **Listo** · Cancelada · **Bloqueada**

En el tablero, lo mismo en mayúsculas por CSS (`uppercase`): el texto del DOM es
éste. Y la leyenda del Panel dice **Listo** y **Bloqueada**, igual que el menú:
eso es H-2 cerrado.

## 5. Lo que se tocó

| Archivo | Qué |
| --- | --- |
| `ui/src/i18n-es-ar/dictionary/es-AR/common.json` | `+ "Blocked": "Bloqueada"` |
| `ui/src/i18n-es-ar/dictionary/es-AR/explicit.json` | `issues.status.done`: `Terminada` → `Listo` |
| `ui/src/i18n-es-ar/overlay.dom.test.tsx` | el caso del homógrafo `Done` ahora fija que las dos capas coinciden; dos casos nuevos para `Blocked` y para `Backlog` |
| `ui/src/i18n-es-ar/real-components.es-ar.test.tsx` | los 7 estados sobre `StatusIcon` de upstream, con el overlay puesto |

Cero archivos de upstream. Llamadas a `tEs()`: **36 antes, 36 después.**

Los documentos de CHA-4 —el diccionario (§2, §7.3) y el glosario (§3, §7)—
quedaron actualizados con la misma decisión. La deriva entre lo que dice el
código y lo que dice el documento **es** H-2; arreglar el render sin arreglar el
documento lo trae de vuelta.
