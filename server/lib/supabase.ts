import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseAdminClient: SupabaseClient | null = null;

/**
 * Lazily initializes the server-side Supabase client when SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are provided in environment variables.
 * Keeps secrets strictly on the backend and returns null safely when using Neon Postgres alone.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    return null;
  }
  if (!supabaseAdminClient) {
    supabaseAdminClient = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabaseAdminClient;
}

export const supabase = getSupabaseAdmin();
