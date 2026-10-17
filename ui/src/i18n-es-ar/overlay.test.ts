import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_UI_LOCALE,
  localeChain,
  localeFromBrowserTags,
  OVERLAY_LOCALES,
  parseUiLocale,
} from "./language";
import { clearOverlayMemo, layerEntries, lookup, tEs, translate } from "./overlay";
import { PATTERNS } from "./patterns";

import agentsEsAr from "./dictionary/es-AR/agents.json";
import commonEsAr from "./dictionary/es-AR/common.json";
import connectionsEsAr from "./dictionary/es-AR/connections.json";
import errorsEsAr from "./dictionary/es-AR/errors.json";
import issuesEsAr from "./dictionary/es-AR/issues.json";
import navigationEsAr from "./dictionary/es-AR/navigation.json";
import onboardingEsAr from "./dictionary/es-AR/onboarding.json";
import projectsEsAr from "./dictionary/es-AR/projects.json";
import settingsEsAr from "./dictionary/es-AR/settings.json";

const ES_AR_AREAS: Record<string, Record<string, string>> = {
  "common.json": commonEsAr,
  "navigation.json": navigationEsAr,
  "errors.json": errorsEsAr,
  "settings.json": settingsEsAr,
  "issues.json": issuesEsAr,
  "agents.json": agentsEsAr,
  "projects.json": projectsEsAr,
  "connections.json": connectionsEsAr,
  "onboarding.json": onboardingEsAr,
};

beforeEach(() => {
  clearOverlayMemo();
});

describe("lookup", () => {
  it("traduce un literal del diccionario", () => {
    expect(lookup("Cancel", "es-AR")).toBe("Cancelar");
    expect(lookup("In progress", "es-AR")).toBe("En curso");
  });

  it("traduce por patrón cuando no hay literal", () => {
    expect(lookup("Select an organization to view pipelines.", "es-AR")).toBe(
      "Elegí una empresa para ver pipelines.",
    );
    expect(lookup("Are you sure you want to uninstall Slack?", "es-AR")).toBe(
      "¿Seguro que querés desinstalar Slack?",
    );
  });

  it("los literales ganan sobre los patrones", () => {
    // El patrón dejaría el sustantivo en inglés; el literal lo traduce entero.
    expect(lookup("Select an organization to view agents.", "es-AR")).toBe(
      "Elegí una empresa para ver los agentes.",
    );
  });

  it("preserva los espacios al borde", () => {
    expect(lookup(" Save ", "es-AR")).toBe(" Guardar ");
    expect(lookup("\n  Cancel\n", "es-AR")).toBe("\n  Cancelar\n");
  });

  it("deja los identificadores técnicos sin tocar", () => {
    for (const value of ["in_review", "in_progress", "critical", "backlog", "plan"]) {
      expect(lookup(value, "es-AR")).toBe(value);
    }
  });

  it("deja las cadenas desconocidas sin tocar", () => {
    expect(lookup("A string nobody translated", "es-AR")).toBe("A string nobody translated");
    expect(lookup("", "es-AR")).toBe("");
  });

  it("devuelve el mismo resultado desde el memo", () => {
    expect(lookup("Cancel", "es-AR")).toBe("Cancelar");
    expect(lookup("Cancel", "es-AR")).toBe("Cancelar");
  });

  it("en inglés es la identidad: no consulta ninguna capa", () => {
    expect(lookup("Cancel", "en")).toBe("Cancel");
    expect(lookup("In progress", "en")).toBe("In progress");
  });
});

describe("la cadena de respaldo es-AR → es → en", () => {
  it("es-AR consulta su capa y después la neutra", () => {
    expect(localeChain("es-AR")).toEqual(["es-AR", "es"]);
  });

  it("es consulta sólo la capa neutra", () => {
    expect(localeChain("es")).toEqual(["es"]);
  });

  it("en no consulta ninguna capa: el inglés ya está en el código", () => {
    expect(localeChain("en")).toEqual([]);
  });

  it("una clave que falta en toda la cadena cae al inglés sin tocar", () => {
    expect(lookup("Untranslated upstream string", "es-AR")).toBe("Untranslated upstream string");
  });

  it("una entrada de es-AR no se filtra a la capa neutra: `es` cae al inglés", () => {
    // Esto es lo que prueba la cadena con los datos que hay hoy. La capa `es`
    // está vacía a propósito (lo entregado por CHA-4 es es-AR), así que pedir
    // `es` tiene que recorrer sólo la capa neutra, no pegar, y devolver el
    // inglés sin tocar: es-AR → es → en, con el último paso visible.
    const [english, translated] = [...layerEntries("es-AR").literals][0] as [string, string];
    expect(lookup(english, "es-AR")).toBe(translated);
    expect(lookup(english, "es")).toBe(english);
  });

  // La herencia desde la capa neutra sólo se puede probar con datos cuando esa
  // capa tenga entradas. Mientras esté vacía, este caso se saltea en vez de
  // pasar en falso recorriendo una lista de cero elementos.
  it.skipIf(layerEntries("es").literals.size === 0)(
    "es-AR hereda de la capa neutra lo que no define",
    () => {
      for (const [english, translated] of layerEntries("es").literals) {
        const own = layerEntries("es-AR").literals.get(english);
        expect(lookup(english, "es-AR")).toBe(own ?? translated);
        expect(lookup(english, "es")).toBe(translated);
      }
    },
  );
});

describe("resolución del idioma", () => {
  it("una elección explícita es estricta", () => {
    expect(parseUiLocale("es-AR")).toBe("es-AR");
    expect(parseUiLocale("es-ar")).toBe("es-AR");
    expect(parseUiLocale("es")).toBe("es");
    expect(parseUiLocale("en")).toBe("en");
    expect(parseUiLocale("fr")).toBeUndefined();
    expect(parseUiLocale("")).toBeUndefined();
    expect(parseUiLocale(null)).toBeUndefined();
  });

  it("un navegador en español arranca en español", () => {
    expect(localeFromBrowserTags(["es-AR"])).toBe("es-AR");
    expect(localeFromBrowserTags(["es"])).toBe("es-AR");
    expect(localeFromBrowserTags(["es-ES", "en"])).toBe("es-AR");
    expect(localeFromBrowserTags(["es-MX"])).toBe("es-AR");
  });

  it("cualquier otro navegador arranca en inglés", () => {
    expect(localeFromBrowserTags(["en-US"])).toBe("en");
    expect(localeFromBrowserTags(["fr-FR", "de"])).toBe(DEFAULT_UI_LOCALE);
    expect(localeFromBrowserTags([])).toBe(DEFAULT_UI_LOCALE);
  });

  it("gana el primer idioma reconocido de la lista del navegador", () => {
    expect(localeFromBrowserTags(["de", "es-AR", "en"])).toBe("es-AR");
    expect(localeFromBrowserTags(["de", "en", "es-AR"])).toBe("en");
  });
});

describe("fuera del navegador", () => {
  it("translate es la identidad en los tests de node, así upstream no cambia", () => {
    // `resolveUiLocale()` devuelve `en` sin `window`, que es el entorno de los
    // 684 archivos de test de upstream.
    expect(translate("Cancel")).toBe("Cancel");
    expect(tEs("issues.status.done", "Done")).toBe("Done");
  });
});

describe("integridad del diccionario", () => {
  it("ningún par de archivos de un área define la misma cadena con traducciones distintas", () => {
    const seen = new Map<string, { file: string; value: string }>();
    const clashes: string[] = [];
    for (const [file, dict] of Object.entries(ES_AR_AREAS)) {
      for (const [english, translated] of Object.entries(dict)) {
        const previous = seen.get(english);
        if (previous && previous.value !== translated) {
          clashes.push(
            `"${english}": ${previous.file} dice "${previous.value}", ${file} dice "${translated}"`,
          );
        }
        seen.set(english, { file, value: translated });
      }
    }
    expect(clashes).toEqual([]);
  });

  it("una cadena vive en un solo archivo", () => {
    const owners = new Map<string, string[]>();
    for (const [file, dict] of Object.entries(ES_AR_AREAS)) {
      for (const english of Object.keys(dict)) {
        owners.set(english, [...(owners.get(english) ?? []), file]);
      }
    }
    const duplicated = [...owners.entries()].filter(([, files]) => files.length > 1);
    expect(duplicated).toEqual([]);
  });

  it("ninguna traducción es idéntica al inglés: esas entradas son ruido", () => {
    const identity: string[] = [];
    for (const [file, dict] of Object.entries(ES_AR_AREAS)) {
      for (const [english, translated] of Object.entries(dict)) {
        if (english === translated) identity.push(`${file}: "${english}"`);
      }
    }
    expect(identity).toEqual([]);
  });

  it("no entran identificadores técnicos ni valores de API", () => {
    const technical = /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/;
    const offenders: string[] = [];
    for (const [file, dict] of Object.entries(ES_AR_AREAS)) {
      for (const english of Object.keys(dict)) {
        if (technical.test(english)) offenders.push(`${file}: "${english}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("las claves punteadas son las únicas con puntos y siguen la convención", () => {
    const dotted = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){2}$/;
    for (const locale of OVERLAY_LOCALES) {
      for (const key of layerEntries(locale).explicit.keys()) {
        expect(key, `clave punteada inválida: ${key}`).toMatch(dotted);
      }
    }
  });
});

describe("patrones", () => {
  it("todos están anclados con ^…$", () => {
    for (const locale of OVERLAY_LOCALES) {
      for (const { match } of PATTERNS[locale]) {
        expect(match.source.startsWith("^"), `sin ancla inicial: ${match}`).toBe(true);
        expect(match.source.endsWith("$"), `sin ancla final: ${match}`).toBe(true);
      }
    }
  });

  it("ninguno usa el flag g: lookup hace test y después replace", () => {
    for (const locale of OVERLAY_LOCALES) {
      for (const { match } of PATTERNS[locale]) {
        expect(match.global, `patrón con flag g: ${match}`).toBe(false);
      }
    }
  });

  it("todo patrón con número tiene su literal singular al lado", () => {
    const literals = layerEntries("es-AR").literals;
    for (const { match } of PATTERNS["es-AR"]) {
      if (!match.source.includes("\\d")) continue;
      const singular = match.source
        .replace(/^\^/, "")
        .replace(/\$$/, "")
        .replace(/\(\\d\+\)/, "1");
      expect(
        literals.has(singular),
        `el patrón ${match} no tiene literal singular ("${singular}")`,
      ).toBe(true);
    }
  });
});

describe("reglas del glosario sobre los valores traducidos", () => {
  const BANNED = ["añadir", "añade", "fichero", "pulsa", "pulse", "vale,", "usted", "coste"];

  it("no hay peninsularismos ni tratamiento de usted", () => {
    const offenders: string[] = [];
    for (const [file, dict] of Object.entries(ES_AR_AREAS)) {
      for (const [english, translated] of Object.entries(dict)) {
        const lower = translated.toLowerCase();
        for (const banned of BANNED) {
          if (lower.includes(banned)) offenders.push(`${file}: "${english}" → "${translated}" (${banned})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("las preguntas y exclamaciones abren con ¿ o ¡", () => {
    const offenders: string[] = [];
    for (const [file, dict] of Object.entries(ES_AR_AREAS)) {
      for (const [english, translated] of Object.entries(dict)) {
        if (translated.endsWith("?") && !translated.includes("¿")) {
          offenders.push(`${file}: "${english}" → "${translated}" (falta ¿)`);
        }
        if (translated.endsWith("!") && !translated.includes("¡")) {
          offenders.push(`${file}: "${english}" → "${translated}" (falta ¡)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("los placeholders de interpolación coinciden exactamente con el inglés", () => {
    const placeholders = (value: string) => (value.match(/\{\{?[a-zA-Z0-9_]+\}?\}/g) ?? []).sort();
    const offenders: string[] = [];
    for (const [file, dict] of Object.entries(ES_AR_AREAS)) {
      for (const [english, translated] of Object.entries(dict)) {
        const from = placeholders(english);
        const to = placeholders(translated);
        if (from.join(",") !== to.join(",")) {
          offenders.push(`${file}: "${english}" → "${translated}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("los puntos suspensivos son siempre el carácter … y nunca tres puntos", () => {
    const offenders: string[] = [];
    for (const [file, dict] of Object.entries(ES_AR_AREAS)) {
      for (const [english, translated] of Object.entries(dict)) {
        if (translated.includes("...")) offenders.push(`${file}: "${english}" → "${translated}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
