import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-green-50 to-white px-4">
      <main className="flex flex-col items-center text-center max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          ForestChat
        </h1>
        <p className="mt-4 text-lg text-gray-600 max-w-md">
          AI-powered forest management — visualize and manage your forest plan
          through conversation.
        </p>
        <p className="mt-2 text-sm text-gray-500 max-w-md">
          Enter your Finnish property ID and the app automatically loads your
          forest data. Ask the AI to generate a 20-year plan, then refine it
          through chat.
        </p>
        <div className="mt-8 flex gap-4">
          <Link
            href="/forest/test-1"
            className="rounded-full bg-green-700 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-green-800 transition-colors"
          >
            Get Started
          </Link>
          <a
            href="https://github.com/pasihokkanen/ForestChat"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            GitHub
          </a>
        </div>
      </main>
    </div>
  );
}