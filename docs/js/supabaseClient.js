import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const isConfigured = !SUPABASE_URL.includes("YOUR-PROJECT-REF");

export const supabase = isConfigured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
