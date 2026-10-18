/**
 * Los sitios de texto: qué literal del código fuente es texto para una persona.
 *
 * Es el archivo que decide qué se puede traducir (ADR 0002 §7.2). Todo lo que no
 * está acá no se marca y por lo tanto **no se puede traducir**: el dato que
 * escribe una persona o un agente no es un literal del código, no pasa por
 * ningún sitio declarado y queda estructuralmente afuera (§4).
 *
 * Las listas son **blancas, nunca negras**: `value`, `className`, `to`, `href`,
 * `type`, `id`, `name` y `data-*` no entran por nada (§7.3). Y crecen agregando
 * un nombre acá, nunca editando un archivo de upstream (§13).
 *
 * Las listas con las que se entrega salen de la medición de §6.3 y §6.7, no de
 * la intuición: con ellas la cobertura del diccionario del corte 2 es de 613 de
 * 624 entradas, y las 11 que faltan están clasificadas una por una en §10.
 */

/** Nombres de atributo de JSX cuyo valor literal es texto para una persona. */
export const TEXT_ATTRS: ReadonlySet<string> = new Set([
  "label", "aria-label", "ariaLabel", "title", "placeholder", "description",
  "message", "hint", "body", "alt", "tooltip", "subtitle", "heading",
  "footnote", "eyebrow", "action", "emptyMessage", "searchPlaceholder",
  "allLabel", "noneLabel", "copiedLabel", "badgeLabel", "errorMessage",
  "error", "approveLabel", "rejectLabel", "requestedAccess",
  // `detail` es la segunda línea de una ficha, debajo de `label`, y es texto en
  // los 35 sitios medidos: ni una clase de Tailwind ni un valor técnico. El
  // nombre **ya estaba** en `TEXT_KEYS` con una excepción por archivo para
  // `TaskChatThread.tsx`, así que esto no es una decisión de producto nueva: es
  // la misma, aplicada a la variante «atributo». Lo pidieron cuatro lotes
  // seguidos (CHA-30, CHA-31, CHA-32, CHA-33).
  "detail",
]);

/**
 * Claves de propiedad de objeto cuyo valor literal es texto para una persona.
 *
 * La lista es **otra** que la de atributos a propósito: los datos dicen que el
 * mismo nombre cambia de naturaleza según dónde esté. `@action` lleva texto 28
 * veces y nunca otra cosa, mientras `.action` lleva clases de Tailwind 113 veces
 * y texto 16 (§7.2).
 */
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
  // Las siete pestañas de Búsqueda. Va **sólo** `SCOPE_LABELS`: declarar
  // además `describeScope` suma una cuarta posición no literal al canal de
  // declaraciones (`return SCOPE_LABELS[scope]` se envuelve entero) y
  // `datos-del-dueno.es-ar.test.tsx` lo para a propósito. Es una decisión del
  // Lead, no de este corte: ver `doc/i18n-es-ar/CHA-39-dos-declaraciones.md`.
  { file: "src/pages/Search.tsx", names: ["SCOPE_LABELS"] },

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
  "&nbsp;": " ",
};
