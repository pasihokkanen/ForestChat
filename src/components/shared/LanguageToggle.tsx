"use client";

import { useState, useEffect } from "react";
import { useForestStore } from "@/lib/store";

export default function LanguageToggle() {
  const language = useForestStore((s) => s.language);
  const setLanguage = useForestStore((s) => s.setLanguage);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const toggle = () => {
    setLanguage(language === "en" ? "fi" : "en");
  };

  // Avoid hydration mismatch — server always renders "en"
  if (!mounted) {
    return <div className="w-8 h-8" />;
  }

  return (
    <button
      onClick={toggle}
      className="flex items-center justify-center w-8 h-8 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
      title={language === "en" ? "Vaihda suomeksi" : "Switch to English"}
      aria-label="Toggle language"
    >
      {language === "en" ? "🇫🇮" : "🇬🇧"}
    </button>
  );
}
