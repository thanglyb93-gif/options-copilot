import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let browserClient: SupabaseClient<Database> | null = null;
let serviceClient: SupabaseClient<Database> | null = null;

/**
 * Client-safe Supabase client (anon key, RLS-scoped). Lazily constructed so
 * importing this module never throws when env vars are unset -- the app
 * shell must still render before Supabase is wired up.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  if (!browserClient) {
    browserClient = createClient<Database>(url, anonKey);
  }
  return browserClient;
}

/**
 * Server-only Supabase client (service role key, bypasses RLS). Only import
 * this from API route handlers, never from client components.
 */
export function getSupabaseServiceClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase service client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  if (!serviceClient) {
    serviceClient = createClient<Database>(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return serviceClient;
}
