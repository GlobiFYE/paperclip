/**
 * Fija el idioma antes de que se cargue cualquier módulo de test.
 *
 * `overlay.ts` resuelve el idioma una sola vez, al evaluarse, igual que en el
 * navegador. Un `beforeAll` llega tarde: los imports del archivo de test ya
 * cargaron el overlay. Esto corre antes de todo.
 */
import { STORAGE_KEY } from "./language";

window.localStorage.setItem(STORAGE_KEY, "es-AR");
