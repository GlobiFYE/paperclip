import type { OverlayLocale } from "./language";

export interface Pattern {
  /** Siempre anclado con `^…$`. Sin flag `g`: `lookup` hace `test` y `replace`. */
  match: RegExp;
  replace: string;
}

/**
 * Cadenas con interpolación, por capa de idioma (ADR 0001 §7.4).
 *
 * Reglas:
 * - Siempre ancladas con `^…$`. Nada que pueda pegar en media cadena.
 * - Los literales se buscan antes que los patrones, y eso resuelve los
 *   plurales: todo patrón con número lleva su literal singular al lado, en el
 *   archivo de diccionario que corresponda.
 * - Techo: ~50 patrones por capa. Si uno se pone difícil de leer, conviene la
 *   clave punteada de §7.5.
 */
export const PATTERNS: Record<OverlayLocale, readonly Pattern[]> = {
  "es-AR": [
    // Molde de estado vacío más repetido de la interfaz: 13 cadenas que sólo
    // cambian en el sustantivo final (diccionario CHA-4 §5.1).
    { match: /^Select an organization to view (.+)\.$/, replace: "Elegí una empresa para ver $1." },
    { match: /^Select a company to view (.+)\.$/, replace: "Elegí una empresa para ver $1." },
    { match: /^Are you sure you want to remove the (.+) adapter\?$/, replace: "¿Seguro que querés quitar el adaptador $1?" },
    { match: /^Are you sure you want to uninstall (.+)\?$/, replace: "¿Seguro que querés desinstalar $1?" },
    { match: /^Invite people to (.+)$/, replace: "Invitar gente a $1" },
    { match: /^Change view — currently (.+)$/, replace: "Cambiar vista — ahora: $1" },
  ],
  es: [],
};
