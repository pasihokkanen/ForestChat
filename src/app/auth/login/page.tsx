import { Suspense } from "react";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-gray-200 dark:border-gray-700 animate-pulse">
          <div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
          <div className="h-4 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-6" />
          <div className="space-y-3">
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}