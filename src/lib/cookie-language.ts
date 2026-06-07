// src/lib/cookie-language.ts
//
// Cookie-based language storage — readable by both server (cookies() from
// next/headers) and client (document.cookie). Eliminates the SSR hydration
// mismatch that occurs when localStorage has a different language than the
// server's default.

import type { Language } from "./i18n";

const COOKIE_NAME = "forestchat-language";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year

/** Read language from cookie. Client-safe — returns "en" during SSR. */
export function getLanguageCookie(): Language {
  if (typeof document === "undefined") return "en";
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`)
  );
  const value = match?.[1];
  if (value === "fi" || value === "en") return value;
  return "en";
}

/** Write language to cookie (client-only). */
export function setLanguageCookie(lang: Language): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=${lang}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}
