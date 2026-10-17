# CHA-37 — H-1: que el diccionario es-AR no viaje en el build de upstream

Bitácora de la decisión. **La decisión está en
[ADR 0003](../adr/0003-la-capa-es-ar-fuera-del-build-de-upstream.md)**; acá
queda el resumen, los números y lo que le toca a cada rol.

Es un ADR nuevo y no una revisión de 0001/0002 porque no cambia **nada** de la
semántica de traducción: no toca el diccionario, ni `lookup`, ni el marcado, ni
la invariante del dato de ADR 0002 §4. Es una decisión de empaquetado, y
mezclarla con 0002 habría vuelto a abrir una discusión que está cerrada.

## Las tres respuestas

1. **Sí se puede, y sin `import()` dinámico.** La causa de H-1 no es cuándo se
   carga el diccionario: es que `overlay.ts` es **un solo módulo**, así que los
   12 archivos de upstream que sólo quieren `tEs()` o la bandera se traen las
   3.882 entradas. Partiéndolo en tres (`active-locale.ts`, `explicit.ts`,
   `overlay.ts`), el build por defecto deja de tener una arista hacia el
   diccionario y no lo incluye. **`lookup()` sigue sincrónico y ningún sitio de
   llamada cambia.**
2. **Cuesta cero archivos nuevos de upstream y cero líneas nuevas.** Los mismos
   12 que ya están tocados; 11 cambian el destino de un `import` que ya existe.
   El presupuesto de ADR 0001 §7.5 queda igual: 36 gastadas, 14 disponibles.
3. **Recomendación: hacerlo, y ahora.** Medio día de Dev UX/UI, entero dentro de
   `ui/src/i18n-es-ar/`, verificable con un `grep` sobre `ui/dist`. No es
   urgente ni es un defecto de corrección: si hay que elegir entre esto y más
   diccionario, gana el diccionario. El arreglo es una frontera de módulo y no
   se encarece con las entradas que se agreguen mientras espera.

**Y la que el enunciado esperaba al revés:** no, esto **no** hace que sobren las
36 llamadas a `tEs()`, y la limpieza de ADR 0002 §9 **no** resuelve H-1 —si se
revirtieran las 36 quedaría en pie `ProfileSettings.tsx` → `LanguageSelector` →
`overlay.ts`, con las 266 KB enteras. El corte de módulo resuelve H-1 solo: es
necesario y suficiente. La limpieza de §9 sigue valiendo la pena, por el
presupuesto de conflictos, y va en su propia tarea porque arrastra una decisión
de traducción (el chip de estado contra los seis botones *Done*, ADR 0002
§10.5).

## Los números, verificados aparte de QA

| | `500bd7604` (lo que midió QA) | `46f07a032` (hoy) |
| --- | ---: | ---: |
| entradas del diccionario | 1.986 | **3.882** |
| diccionario serializado | 137.364 B (134 KiB) | **266.325 B (260 KiB)** |
| comprimido (gzip -9) | 45.298 B | **85.719 B** |

De los 1.084 valores únicos de más de 20 caracteres del diccionario de
`500bd7604`, están **1.084 de 1.084** dentro de
`ui/dist/assets/BreadcrumbContext-DZWt7WIy.js`, que es un chunk **precargado**
del build de upstream. En dos horas de trabajo el peso muerto se multiplicó por
1,94, y faltan ~2.060 cadenas del alcance.

Las cuatro formas posibles se construyeron con el Vite del repo (8.2.2 /
Rolldown) y el diccionario de hoy, fuera del repo
(`$PAPERCLIP_SCRATCH_DIR/h1`): la de hoy deja 270.069 B con español en el build
por defecto, el corte de módulo deja **741 B sin una palabra en español**, y las
dos variantes con `import()` también sacan el diccionario pero le cuestan un
chunk aparte y un viaje de red al build es-AR, que es el que el dueño usa. La
tabla completa está en ADR 0003 §4.2.

Dato que cierra la elección: en `ui/dist-es-ar` el diccionario **ya** está en su
propio chunk (`overlay-GBfMcSG2.js`, 197 KB, precargado). Para el build es-AR el
corte de módulo no cambia el reparto de chunks: no le cuesta nada al lado que
importa.

## Convivencia con CHA-38

El mapa por sitio está a medio implementar en este worktree mientras se escribe
esto (sin commitear, así que no entra en los números de arriba). No hay nada que
coordinar: `por-sitio.ts` y su `dictionary/por-sitio/` cuelgan de `overlay.ts`,
o sea que quedan del lado es-AR de la frontera y el corte los alcanza solo. Y si
CHA-38 termina reemplazando las 36 llamadas a `tEs()`, `explicit.ts` se queda
sin consumidores de upstream y el build por defecto baja a cero bytes en
español.

## Para otros roles

- **Dev UX/UI:** la implementación es ADR 0003 §9, seis pasos. Tres archivos
  nuestros nuevos o cambiados, dos líneas del plugin, 15 `import` repuntados y
  un test de frontera (§6.5). Ninguna traducción se toca.
- **QA:** la verificación es ADR 0003 §10: cuatro chequeos sobre los artefactos
  emitidos, con el canario `"El almacenamiento del navegador no está
  disponible; copiá tu texto antes de salir."`. No hay que volver a medir la
  invariante del dato ni la cobertura: este cambio no las puede mover.
- **Traductor i18n:** nada. El diccionario no cambia de forma ni de contenido.
- **Lead:** queda una tarea pendiente aparte, que no es ésta y no la bloquea: la
  limpieza de ADR 0002 §9 (revertir las 36 llamadas, cubrir esos mapas por
  `TEXT_DECLS`). Devuelve 33 líneas de presupuesto, deja el build por defecto en
  cero bytes en español y habilita la decisión de §10.5 (dos traducciones
  distintas para el chip y para el botón). Pide QA de T2/T3 de ADR 0002 §11.2.
