import { DEFAULT_LOCALE, supportedLocales } from "./locales";

const STORAGE_KEY = "paperclip.locale";

export function normalizeLocale(value: string | null | undefined): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  // direct match
  const exact = supportedLocales.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;
  // pt-BR handling: pt -> pt-BR if available
  if (lower === "pt" && supportedLocales.includes("pt-BR")) return "pt-BR";
  if (lower.startsWith("pt-") && supportedLocales.includes("pt-BR")) return "pt-BR";
  // fallback: language prefix match e.g. en-US -> en
  const prefix = lower.split("-")[0];
  const byPrefix = supportedLocales.find((l) => l.toLowerCase().split("-")[0] === prefix);
  return byPrefix ?? null;
}

export function resolveInitialLocale(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const normalized = normalizeLocale(stored);
    if (normalized) return normalized;
  } catch {
    // ignore storage errors
  }
  return DEFAULT_LOCALE;
}

export function persistLocale(locale: string) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

export { STORAGE_KEY };
