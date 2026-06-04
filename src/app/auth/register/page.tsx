"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  }

  if (success) {
    return (
      <div className="rounded-xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-gray-200 dark:border-gray-700 text-center">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Check your email
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          We sent a confirmation link to <strong>{email}</strong>. Click it to
          complete registration.
        </p>
        <Link
          href="/auth/login"
          className="mt-4 inline-block text-sm font-medium text-green-700 dark:text-green-400 hover:text-green-800 dark:hover:text-green-400"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-gray-200 dark:border-gray-700">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors mb-4"
      >
        ← Back
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Create account</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Get started with ForestChat</p>

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
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm shadow-sm focus:border-green-500 dark:focus:border-green-400 focus:ring-1 focus:ring-green-500 dark:focus:ring-green-400 dark:bg-gray-900 dark:text-gray-100"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">At least 6 characters</p>
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
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
        Already have an account?{" "}
        <Link
          href="/auth/login"
          className="font-medium text-green-700 dark:text-green-400 hover:text-green-800 dark:hover:text-green-400"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}