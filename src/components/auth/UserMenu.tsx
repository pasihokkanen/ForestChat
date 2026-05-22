"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/hooks/use-auth";

export default function UserMenu() {
  const { user, loading, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (loading) {
    return <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />;
  }

  if (!user) {
    return null;
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <span className="h-7 w-7 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-xs font-medium text-green-800 dark:text-green-300">
          {user.email?.charAt(0).toUpperCase()}
        </span>
        <span className="text-gray-700 dark:text-gray-300 hidden sm:inline max-w-[140px] truncate">
          {user.email}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-md bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
          <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {user.email}
            </p>
          </div>
          <button
            onClick={() => {
              signOut();
              setOpen(false);
            }}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}