/**
 * El mapa por sitio (ADR 0001 revisión 2 §14.2).
 *
 * Lo que hay que probar no es que un `Map` devuelva lo que se le puso, sino las
 * cuatro cosas que hacen que el mecanismo sirva y no muerda:
 *
 *  1. **el mismo inglés da dos españoles distintos según el archivo** —es la
 *     razón de existir del mapa, y va una por cada una de las 8 cadenas;
 *  2. **el control negativo**: un archivo sin entrada sigue usando el
 *     diccionario global, y si tampoco está ahí, el inglés sin tocar;
 *  3. **las 7 cadenas que no tienen entrada global siguen sin tenerla.** No es
 *     un detalle de estilo: el canal de declaraciones (`TEXT_DECLS`) no recibe
 *     el sitio, así que una entrada global de `Open` le cambiaría la etiqueta a
 *     `statusLabel("open")` en `StatusIcon`. El mapa por sitio existe para no
 *     tener que pagar eso;
 *  4. **las entradas pegan de verdad**: cada una corresponde a un sitio que el
 *     marcado produce en ese archivo. Si upstream renombra el archivo o borra
 *     el literal, esto se pone rojo en vez de degradarse en silencio.
 *
 * Corre con la config de upstream (`lookupPorSitio` es puro y no mira el
 * interruptor, igual que `lookup`), así que no necesita el plugin.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { markText } from "./mark-text";
import { lookup, lookupPorSitio } from "./overlay";
import { claveDeArchivo, entradasPorSitio } from "./por-sitio";

const UI_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = path.join(UI_ROOT, "src");

/** Las 8 cadenas del corte 2 que necesitan dos españoles según el sitio. */
const HOMOGRAFOS = [
  "All",
  "Private",
  "Installed ·",
  "Open",
  "Run",
  "Comment",
  "Review",
  "Type",
] as const;

/**
 * La segunda clase de entrada, de CHA-42: **el sitio no cabe**.
 *
 * `RoutineList.tsx:188` pone el estado de la rutina en un `<span className="w-12
 * text-xs">`, que son 48 px fijos, y el archivo es de upstream: no se ensancha.
 * Medido con la tipografía del build (12 px InterVariable), «Desactivado» —el
 * español global de `Off`— ocupa 75 px y se corta a la mitad sin puntos
 * suspensivos. Las formas de acá entran en la caja; la tabla medida está en
 * `doc/i18n-es-ar/CHA-42-tres-defectos.md`.
 *
 * `Off` es el caso que **no** tiene forma: «Apagada», la que eligió el Lead,
 * mide 53 px. La entrada es `"Off": "Off"`, o sea inglés a propósito en este
 * sitio, que es la salida que pidió la tarea: antes una palabra en inglés que
 * una palabra cortada.
 */
const POR_ANCHO = ["Archived", "Off", "On"] as const;

const CADENAS = [...HOMOGRAFOS, ...POR_ANCHO] as const;

/**
 * Una fila por cadena: el mismo inglés, dos archivos, dos españoles.
 *
 * Las formas **no se inventaron acá**: salen de las bitácoras de los lotes que
 * dejaron cada cadena afuera (CHA-27 `Open`/`Run`/`Comment`, CHA-30 `Review`,
 * CHA-31 `All`/`Private`/`Installed ·`, CHA-33 `Type`).
 */
const DOS_ESPANOLES: readonly {
  ingles: (typeof HOMOGRAFOS)[number];
  a: readonly [string, string];
  b: readonly [string, string];
}[] = [
  {
    ingles: "All",
    a: ["components/ActivityFeed.tsx", "Todos"],
    b: ["pages/Approvals.tsx", "Todas"],
  },
  {
    ingles: "Private",
    // La costura que veía el dueño: el selector de alcance de Skill Studio se
    // leía «Empresa / Private / Pública» porque `Private` no se podía traducir
    // sin escribir «Privada» sobre un proyecto (CHA-31).
    a: ["components/ProjectProperties.tsx", "Privado"],
    b: ["pages/SkillStudio.tsx", "Privada"],
  },
  {
    ingles: "Installed ·",
    a: ["pages/CompanySkills.tsx", "Instaladas ·"],
    b: ["pages/TeamCatalog.tsx", "Instalados ·"],
  },
  {
    ingles: "Open",
    a: ["components/AttentionQueueRow.tsx", "Abrir"],
    b: ["components/task-chat/RichWorkProductCard.tsx", "Abierto"],
  },
  {
    ingles: "Run",
    a: ["pages/apps/app-detail/ActionTestDialog.tsx", "Ejecutar"],
    b: ["pages/audit/AuditFeed.tsx", "Ejecución"],
  },
  {
    ingles: "Comment",
    a: ["components/CommentThread.tsx", "Comentar"],
    b: ["components/search/SearchResultRow.tsx", "Comentario"],
  },
  {
    ingles: "Review",
    a: ["components/IssueRunLedger.tsx", "Revisá"],
    b: ["pages/PluginManager.tsx", "Revisar"],
  },
  {
    ingles: "Type",
    a: ["components/DecisionsToolbar.tsx", "Tipo"],
    b: ["components/DecisionCard.tsx", "Escribí"],
  },
];

/**
 * El control negativo, y es el que más dice: `AppsSidebar.tsx` **tiene** un
 * sitio marcado de `Review` y **no** tiene entrada en el mapa, así que lo
 * resuelve el diccionario global, exactamente como antes de esta tarea.
 */
const SIN_ENTRADA_EN_EL_MAPA = "components/AppsSidebar.tsx";

describe("el mismo inglés, dos españoles según el archivo (§14.2)", () => {
  for (const { ingles, a, b } of DOS_ESPANOLES) {
    it(`${JSON.stringify(ingles)}: ${a[1]} en ${a[0]}, ${b[1]} en ${b[0]}`, () => {
      expect(lookupPorSitio(ingles, a[0])).toBe(a[1]);
      expect(lookupPorSitio(ingles, b[0])).toBe(b[1]);
      // Lo que el diccionario global no puede hacer, dicho como aserción.
      expect(a[1]).not.toBe(b[1]);
    });
  }

  it("cubre las 11 cadenas y ninguna más", () => {
    const cubiertas = new Set<string>();
    for (const porIngles of entradasPorSitio("es-AR").values()) {
      for (const ingles of porIngles.keys()) cubiertas.add(ingles);
    }
    expect([...cubiertas].sort()).toEqual([...CADENAS].sort());
  });
});

describe("la columna de 48 px de la lista de Rutinas (CHA-42)", () => {
  const ARCHIVO = "components/RoutineList.tsx";

  it("«Activa» y «Archivo» entran en la caja y reemplazan al global", () => {
    expect(lookupPorSitio("On", ARCHIVO)).toBe("Activa");
    expect(lookupPorSitio("Archived", ARCHIVO)).toBe("Archivo");
    // El global de `Archived` es «En archivo», que mide 43 px y también
    // entraría; la entrada existe igual porque «Archivo» es la forma que el
    // glosario quiere para el estado de una rutina, no para la bandeja.
    expect(lookup("Archived")).toBe("En archivo");
  });

  it("`Off` queda en inglés acá y sigue siendo «Desactivado» en el resto", () => {
    // La regla medida: lo que pasa de 48 px no entra. «Apagada» mide 53 px.
    expect(lookupPorSitio("Off", ARCHIVO)).toBe("Off");
    expect(lookup("Off")).toBe("Desactivado");
    expect(lookupPorSitio("Off", SIN_ENTRADA_EN_EL_MAPA)).toBe("Desactivado");
  });

  it("`Draft` no tiene entrada en ningún lado y sale en inglés", () => {
    expect(lookup("Draft")).toBe("Draft");
    expect(lookupPorSitio("Draft", ARCHIVO)).toBe("Draft");
  });
});

describe("la prioridad, y que el memo global no se contamine", () => {
  /**
   * `lookup` memoiza por valor, sin dimensión de archivo. Si el resultado de un
   * sitio cayera en ese memo, el primer archivo en resolverse le fijaría la
   * traducción a todos los demás —un bug que aparecería según el orden de
   * render—. `lookupPorSitio` resuelve el mapa aparte y sólo delega el **miss**
   * a `lookup`, así que el memo global sólo ve resultados globales.
   */
  it("el sitio le gana al diccionario global", () => {
    expect(lookup("Review")).toBe("Revisión");
    expect(lookupPorSitio("Review", "components/IssueRunLedger.tsx")).toBe("Revisá");
  });

  it("resolver un sitio no le cambia la respuesta al resto", () => {
    expect(lookupPorSitio("Review", "components/IssueRunLedger.tsx")).toBe("Revisá");
    expect(lookup("Review")).toBe("Revisión");
    expect(lookupPorSitio("Review", "components/AppsSidebar.tsx")).toBe("Revisión");
    expect(lookupPorSitio("Review", "pages/PluginManager.tsx")).toBe("Revisar");
  });
});

describe("el control negativo: sin entrada, manda el diccionario global", () => {
  /** Un archivo que el mapa no menciona en ninguna de sus 8 cadenas. */
  const SIN_ENTRADA = SIN_ENTRADA_EN_EL_MAPA;

  it("un archivo sin entrada resuelve exactamente como `lookup`", () => {
    expect(entradasPorSitio("es-AR").has(SIN_ENTRADA)).toBe(false);
    for (const ingles of CADENAS) {
      expect(lookupPorSitio(ingles, SIN_ENTRADA)).toBe(lookup(ingles));
    }
  });

  it("`Review` sin entrada sigue siendo «Revisión», que es lo que dice el global", () => {
    // 16 de los 17 archivos con un sitio de `Review` son el sustantivo y viven
    // del diccionario global: el mapa sólo da vuelta los cuatro que son verbo.
    expect(lookup("Review")).toBe("Revisión");
    expect(lookupPorSitio("Review", "components/AppsSidebar.tsx")).toBe("Revisión");
  });

  it("una cadena sin entrada global y sin entrada de sitio cae al inglés", () => {
    expect(lookupPorSitio("Open", "components/AppsSidebar.tsx")).toBe("Open");
  });
});

describe("la garantía del dueño: por qué estas 7 no van al diccionario global", () => {
  /**
   * `TEXT_DECLS` envuelve el `return` entero de `statusLabel`, así que lo que
   * se busca ahí **no** es un literal del archivo y el marcado no le puede
   * pasar el sitio. `statusLabel("open")` devuelve `"Open"`: con una entrada
   * global, el glifo de estado pasaría a decir «Abrir».
   *
   * Por eso las 7 cadenas nuevas viven **sólo** en el mapa por sitio. `Review`
   * es la excepción y ya tenía entrada global antes de esta tarea.
   *
   * Las tres de CHA-42 son la otra clase y por eso no entran en esta garantía:
   * la entrada no está para separar dos sentidos sino para que la forma entre
   * en 48 px, y el español global de `Off` y de `Archived` tiene que seguir
   * existiendo —sacarlo los dejaría en inglés en toda la app para arreglar una
   * sola columna—.
   */
  const CON_GLOBAL_A_PROPOSITO = new Set(["Review", ...POR_ANCHO]);

  it("ninguna de las 7 tiene entrada en el diccionario global", () => {
    for (const ingles of CADENAS) {
      if (CON_GLOBAL_A_PROPOSITO.has(ingles)) continue;
      expect(lookup(ingles), `${ingles} no puede estar en el diccionario global`).toBe(ingles);
    }
  });

  it("y las dos de CHA-42 que sí lo tienen lo conservan intacto", () => {
    // El control: la entrada por sitio **no** se come el diccionario global.
    expect(lookup("Off")).toBe("Desactivado");
    expect(lookup("Archived")).toBe("En archivo");
    // `On` nunca tuvo entrada global y la sigue sin tener: «Activa» es la forma
    // de una rutina, no la de un interruptor cualquiera.
    expect(lookup("On")).toBe("On");
  });
});

describe("los espacios del borde, igual que en §7.1", () => {
  it("`Installed · ` resuelve por la clave sin espacios y los devuelve pegados", () => {
    // El nodo de texto de `Installed · {n}` conserva el espacio final, así que
    // sin esto la entrada habría que escribirla con el espacio adentro.
    expect(lookupPorSitio("Installed · ", "pages/CompanySkills.tsx")).toBe("Instaladas · ");
    expect(lookupPorSitio("Installed · ", "pages/TeamCatalog.tsx")).toBe("Instalados · ");
  });

  it("también del lado izquierdo", () => {
    expect(lookupPorSitio(" All", "pages/Approvals.tsx")).toBe(" Todas");
  });
});

describe("los dos homógrafos que el mapa no puede expresar quedan en inglés", () => {
  /**
   * La clave es `archivo + inglés`, no la línea —es lo que la hace sobrevivir a
   * que upstream edite el archivo arriba—. Cuando los dos sentidos conviven en
   * el **mismo** archivo, el mapa no los puede separar, y la salida correcta es
   * no poner la entrada: se degrada al inglés, que es legible, en vez de a una
   * oración mal escrita.
   */
  const COLISIONES: readonly [string, string][] = [
    // `Type` sustantivo en la 119 y verbo en la 304.
    ["components/RoutineVariablesEditor.tsx", "Type"],
    // `Run` verbo en el botón de la 2527 y sustantivo en los títulos de pane.
    ["pages/SkillStudio.tsx", "Run"],
  ];

  for (const [archivo, ingles] of COLISIONES) {
    it(`${archivo} no traduce ${JSON.stringify(ingles)}`, () => {
      expect(lookupPorSitio(ingles, archivo)).toBe(ingles);
    });
  }

  it("pero las otras cadenas del mismo archivo sí se traducen", () => {
    // `SkillStudio.tsx` queda sin entrada de `Run` y **con** la de `Private`,
    // que es la que cierra la costura visible.
    expect(lookupPorSitio("Private", "pages/SkillStudio.tsx")).toBe("Privada");
  });
});

/* ------------------------------------------------------------------ */
/* El mapa contra el árbol de verdad                                   */
/* ------------------------------------------------------------------ */

/** Las formas crudas que resuelven a `ingles` por el recorte de §7.1. */
function variantes(ingles: string): string[] {
  return [ingles, `${ingles} `, ` ${ingles}`, ` ${ingles} `];
}

function marcar(archivo: string): string {
  const full = path.join(SRC, archivo);
  const code = fs.readFileSync(full, "utf8");
  const marked = markText(code, archivo.endsWith("x") ? "tsx" : "ts", `src/${archivo}`);
  expect(marked, `${archivo} no produjo ninguna marca`).not.toBeNull();
  return marked as string;
}

describe("cada entrada del mapa pega en un sitio que el marcado produce", () => {
  const entradas = entradasPorSitio("es-AR");

  for (const [archivo, porIngles] of entradas) {
    it(`${archivo}: ${[...porIngles.keys()].map((k) => JSON.stringify(k)).join(", ")}`, () => {
      expect(
        fs.existsSync(path.join(SRC, archivo)),
        `${archivo} no existe: upstream lo renombró y la entrada dejó de pegar`,
      ).toBe(true);
      const marked = marcar(archivo);
      for (const ingles of porIngles.keys()) {
        const esperadas = variantes(ingles).map(
          (crudo) => `__tEs(${JSON.stringify(crudo)}, ${JSON.stringify(archivo)})`,
        );
        expect(
          esperadas.some((llamada) => marked.includes(llamada)),
          `${archivo} no tiene un sitio marcado para ${JSON.stringify(ingles)}`,
        ).toBe(true);
      }
    });
  }
});

describe("el marcado de los demás archivos no cambia", () => {
  /** `__tEs("algo", …)`: la forma de dos argumentos. */
  const CON_SITIO = /__tEs\("(?:[^"\\]|\\.)*"\s*,/;

  it("un archivo que el mapa no menciona se marca sin pasarle el sitio", () => {
    const marked = marcar(SIN_ENTRADA_EN_EL_MAPA);
    expect(marked).toContain("__tEs(");
    expect(CON_SITIO.test(marked)).toBe(false);
  });

  it("un archivo que el mapa sí menciona sólo le pasa el sitio a sus entradas", () => {
    const archivo = "components/DecisionsToolbar.tsx";
    const marked = marcar(archivo);
    const conSitio = [...marked.matchAll(/__tEs\(("(?:[^"\\]|\\.)*")\s*,/g)].map((m) =>
      JSON.parse(m[1] as string) as string,
    );
    // El único sitio de este archivo que el mapa menciona es `Type`.
    expect([...new Set(conSitio.map((v) => v.trim()))]).toEqual(["Type"]);
  });

  it("sin `file`, el transform no consulta el mapa y queda puro", () => {
    const code = `export const x = <div title="Type">Type</div>;\n`;
    const marked = markText(code, "tsx");
    expect(marked).toContain("__tEs(");
    expect(CON_SITIO.test(marked as string)).toBe(false);
  });
});

describe("la clave de archivo", () => {
  it("es relativa a `ui/src/`, no a `ui/`", () => {
    expect(claveDeArchivo("src/components/IssueRow.tsx")).toBe("components/IssueRow.tsx");
    expect(claveDeArchivo("components/IssueRow.tsx")).toBe("components/IssueRow.tsx");
  });
});
