// Type-safe environment variable access.
// Backend-only keys are NOT prefixed with NEXT_PUBLIC_ and will
// error at build time if accessed from client components.

export const env = {
  // Public (safe for client)
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,

  // Backend only — will be undefined on client
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY as string,
  mmlApiKey: process.env.MML_API_KEY as string,
  openRouterApiKey: process.env.OPENROUTER_API_KEY as string,
} as const
