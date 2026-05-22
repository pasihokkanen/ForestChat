"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "/dashboard";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push(redirect);
    router.refresh();
  }

  return (
    <div className="rounded-xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-gray-200 dark:border-gray-700">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Sign in</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">to continue to ForestChat</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm shadow-sm focus:border-green-500 dark:focus:border-green-400 focus:ring-1 focus:ring-green-500 dark:focus:ring-green-400 dark:bg-gray-900 dark:text-gray-100"
          />
        </div>
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm shadow-sm focus:border-green-500 dark:focus:border-green-400 focus:ring-1 focus:ring-green-500 dark:focus:ring-green-400 dark:bg-gray-900 dark:text-gray-100"
          />
        </div>

        {error && (
          <div className="rounded-md bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-green-700 dark:bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 dark:hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
        Don&apos;t have an account?{" "}
        <Link
          href="/auth/register"
          className="font-medium text-green-700 dark:text-green-400 hover:text-green-800 dark:hover:text-green-400"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}