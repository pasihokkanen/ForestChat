"use client";

import { useEffect } from "react";
import { useForestStore } from "@/lib/store";

export default function LanguageRoot({ children }: { children: React.ReactNode }) {
  const language = useForestStore((s) => s.language);
  const syncLanguageFromCookie = useForestStore((s) => s.syncLanguageFromCookie);

  // On first mount, sync the language cookie into Zustand.
  // This runs after hydration — no mismatch with SSR.
  useEffect(() => {
    syncLanguageFromCookie();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return <>{children}</>;
}
