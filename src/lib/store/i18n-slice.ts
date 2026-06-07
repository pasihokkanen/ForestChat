import type { StateCreator } from "zustand";
import type { Language } from "../i18n";
import { getLanguageCookie, setLanguageCookie } from "../cookie-language";

export interface I18nSlice {
  language: Language;
  setLanguage: (lang: Language) => void;
  /** Called once on mount to sync cookie → Zustand. */
  syncLanguageFromCookie: () => void;
}

export const createI18nSlice: StateCreator<I18nSlice> = (set) => ({
  // Start with "en" — matches the SSR default. LanguageRoot calls
  // syncLanguageFromCookie() on mount to pick up the user's saved
  // preference. This eliminates the hydration mismatch.
  language: "en",

  setLanguage: (lang: Language) => {
    setLanguageCookie(lang);
    set({ language: lang });
  },

  syncLanguageFromCookie: () => {
    const cookieLang = getLanguageCookie();
    if (cookieLang !== "en") {
      set({ language: cookieLang });
    }
  },
});
