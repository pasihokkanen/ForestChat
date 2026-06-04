"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "forestchat-theme";
const COOKIE_KEY = "forestchat-theme";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  function applyTheme(isDark: boolean) {
    if (isDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem(STORAGE_KEY, "dark");
      document.cookie = `${COOKIE_KEY}=dark; path=/; max-age=31536000; SameSite=Lax`;
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem(STORAGE_KEY, "light");
      document.cookie = `${COOKIE_KEY}=light; path=/; max-age=31536000; SameSite=Lax`;
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark") {
      setDark(true);
      applyTheme(true);
    } else if (stored === "light") {
      setDark(false);
      applyTheme(false);
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setDark(prefersDark);
      applyTheme(prefersDark);
    }
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next);
  };

  // Avoid flash of wrong icon before hydration
  if (!mounted) {
    return <div className="w-8 h-8" />;
  }

  return (
    <button
      onClick={toggle}
      className="flex items-center justify-center w-8 h-8 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle theme"
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}
