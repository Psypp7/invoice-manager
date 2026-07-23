import { createBrowserClient } from "@supabase/ssr";

let supabaseClient;

export function getSupabase() {
  if (!supabaseClient) {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        "Supabase environment variables are missing."
      );
    }

    supabaseClient = createBrowserClient(
      supabaseUrl,
      supabaseKey
    );
  }

  return supabaseClient;
}

export const supabase = getSupabase();