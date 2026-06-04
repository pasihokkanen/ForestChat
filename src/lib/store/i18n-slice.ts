import type { StateCreator } from "zustand";
import type { Language } from "../i18n";

export interface I18nSlice {
  language: Language;
  setLanguage: (lang: Language) => void;
}

const STORAGE_KEY = "forestchat-language";

function getStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "fi" || stored === "en") return stored;
  return "en";
}

export const createI18nSlice: StateCreator<I18nSlice> = (set) => ({
  language: getStoredLanguage(),
  setLanguage: (lang: Language) => {
    localStorage.setItem(STORAGE_KEY, lang);
    set({ language: lang });
    // Reload the page so all components pick up the new language
    window.location.reload();
  },
});
