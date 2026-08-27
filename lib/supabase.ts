import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let browserClient: SupabaseClient<Database> | null = null;
let serviceClient: SupabaseClient<Database> | null = null;

/**
 * Next.js patches the global `fetch` to add its own persistent Data Cache
 * (on disk, surviving dev-server restarts). supabase-js's internal HTTP
 * calls go through that same global fetch, so without this, every
 * Supabase read risks being served from a stale cached response instead
 * of hitting the database -- confirmed via a real repro (a 20-row insert
 * that kept reading back as 1 row until `cache: "no-store"` was added).
 * Database reads must always be live, so every Supabase client call opts
 * out of Next's fetch cache here, once, centrally.
 */
function noStoreFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, cache: "no-store" });
}

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
    browserClient = createClient<Database>(url, anonKey, {
      global: { fetch: noStoreFetch },
    });
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
      global: { fetch: noStoreFetch },
    });
  }
  return serviceClient;
}

/**
 * Server-side client for API routes. Uses the service role key now that
 * we have a dedicated project (not shared with another app) -- bypasses
 * RLS, which is appropriate for a single-user internal tool with no auth
 * system yet.
 */
export function getSupabaseRouteClient(): SupabaseClient<Database> {
  return getSupabaseServiceClient();
}
