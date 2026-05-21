import { createClient } from '@supabase/supabase-js'

// Secret key client — for admin operations like migrations, RLS bypass
// NEVER expose this to the client. Use only in API routes / Edge Functions.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
