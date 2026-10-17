import { Languages } from "lucide-react";

import { RadioCardGroup, type RadioCardOption } from "@/components/ui/radio-card";

import { activeUiLocale, isOverlayInstalled } from "./overlay";
import { storeUiLocale, type UiLocale } from "./language";

/**
 * Los nombres de idioma van en su propio idioma y **no** pasan por el
 * diccionario: alguien que cayó en un idioma que no lee tiene que poder
 * encontrar el suyo igual.
 */
const LANGUAGE_OPTIONS: readonly (RadioCardOption & { value: UiLocale })[] = [
  {
    value: "en",
    title: "English",
    description: "The interface as upstream ships it.",
  },
  {
    value: "es-AR",
    title: "Español (Argentina)",
    description: "Español rioplatense, con voseo.",
  },
];

/**
 * Selector de idioma de la interfaz.
 *
 * Va en el perfil de la persona y no en la configuración de la instancia: dos
 * personas que comparten una instancia leen en idiomas distintos, y la
 * elección se guarda por navegador. Es el mismo tipo de preferencia personal
 * que `InboxAgentPolicyControl`, que ya vive en esta pantalla.
 *
 * No renderiza nada si el overlay no está en el bundle (el build en inglés de
 * siempre): mejor que ofrecer un control que no hace nada.
 */
export function LanguageSelector() {
  if (!isOverlayInstalled()) return null;

  const current = activeUiLocale();

  function selectLocale(next: string) {
    if (next === current) return;
    storeUiLocale(next as UiLocale);
    // El overlay traduce en la frontera de JSX y memoiza por cadena, así que
    // el idioma se fija al cargar la página. Recargar es lo que lo aplica en
    // todas las pantallas de una vez, y es lo que persiste la elección.
    window.location.reload();
  }

  return (
    <section className="space-y-4" aria-label="Interface language">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Languages className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">Language</h2>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Choose the language of the Paperclip interface. The page reloads so the new language reaches
          every screen.
        </p>
      </div>

      <RadioCardGroup
        ariaLabel="Interface language"
        value={current === "es" ? "es-AR" : current}
        onValueChange={selectLocale}
        options={LANGUAGE_OPTIONS as RadioCardOption[]}
        className="max-w-2xl"
      />
    </section>
  );
}
