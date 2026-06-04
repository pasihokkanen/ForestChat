"use client";

import { useEffect } from "react";
import { useForestStore } from "@/lib/store";

export default function LanguageRoot({ children }: { children: React.ReactNode }) {
  const language = useForestStore((s) => s.language);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return <>{children}</>;
}
