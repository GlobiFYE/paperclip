import { useTranslation } from "@/i18n";
import { supportedLocales } from "@/i18n/locales";
import { cn } from "@/lib/utils";

type Variant = "compact-menu-action" | "icon";

const LABELS: Record<string, string> = {
  en: "English",
  "pt-BR": "Português (BR)",
};

function localeLabel(locale: string) {
  return LABELS[locale] ?? locale;
}

export function LanguageToggle({
  variant = "compact-menu-action",
  onAfterChange,
  className,
}: {
  variant?: Variant;
  onAfterChange?: () => void;
  className?: string;
}) {
  const { i18n, t } = useTranslation();

  // Only expose en/pt-BR in the switcher; full list still supported via fallback.
  const options = supportedLocales.filter((l) => l === "en" || l === "pt-BR");
  const current = i18n.language;
  const next = current === "pt-BR" ? "en" : "pt-BR";

  function handleToggle() {
    void i18n.changeLanguage(next);
    onAfterChange?.();
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleToggle}
        aria-label={t("common.language.switch", { defaultValue: "Switch language" })}
        title={`${localeLabel(current)} → ${localeLabel(next)}`}
        className={cn(
          "rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
          className,
        )}
      >
        {current === "pt-BR" ? "PT-BR" : "EN"}
      </button>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {options.map((locale) => {
        const active = current.toLowerCase() === locale.toLowerCase();
        return (
          <button
            key={locale}
            type="button"
            onClick={() => {
              void i18n.changeLanguage(locale);
              onAfterChange?.();
            }}
            aria-pressed={active}
            className={cn(
              "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {localeLabel(locale)}
          </button>
        );
      })}
      <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">
        {t("common.language.label", { defaultValue: "Language" })}
      </span>
    </div>
  );
}

export function LanguageMenuAction({ onAfterChange }: { onAfterChange?: () => void }) {
  const { i18n, t } = useTranslation();
  const current = i18n.language;
  const next = current === "pt-BR" ? "en" : "pt-BR";
  const nextLabel = next === "pt-BR" ? "Português (BR)" : "English";

  return (
    <button
      type="button"
      onClick={() => {
        void i18n.changeLanguage(next);
        onAfterChange?.();
      }}
      className="flex h-(--profile-popover-row-height) w-full items-center gap-(--profile-popover-row-gap) rounded-lg px-2.5 text-left text-(length:--text-compact) font-medium leading-(--profile-popover-label-line-height) text-foreground transition-colors hover:bg-accent"
      aria-label={t("common.language.switch", { defaultValue: "Switch language" })}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground text-xs font-semibold">
        {current === "pt-BR" ? "PT" : "EN"}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {t("common.language.switchTo", {
          defaultValue: `Mudar para ${nextLabel}`,
          language: nextLabel,
        })}
      </span>
    </button>
  );
}
