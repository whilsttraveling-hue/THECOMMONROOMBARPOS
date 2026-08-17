import { createClient } from "@supabase/supabase-js";

// ---- Paste your Supabase project values here ----
const SUPABASE_URL = "https://iwnzrtbborjniplruuzc.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3bnpydGJib3JqbmlwbHJ1dXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NzMwMTIsImV4cCI6MjEwMjQ0OTAxMn0.asUmHpSq2sppAiLDt3YSwkgkNR6pDzOTypAEtKaim80";
// ---------------------------------------------------

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Each of these tables has exactly one row (id = 'singleton') holding
// the whole JSON blob for that piece of state — menu, tabs, or history.
// This keeps the app logic identical to the artifact version: one
// get/set per data type, no per-row queries to manage.

export async function cloudGet(table, fallback) {
  const { data, error } = await supabase
    .from(table)
    .select("value")
    .eq("id", "singleton")
    .maybeSingle();
  if (error) {
    console.error(`[cloudGet] ${table} failed:`, error.message, error);
    return fallback;
  }
  if (!data) return fallback;
  return data.value;
}

export async function cloudSet(table, value) {
  const { error } = await supabase
    .from(table)
    .upsert({ id: "singleton", value, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) {
    console.error(`[cloudSet] ${table} failed:`, error.message, error);
  }
  return !error;
}

// ---- Auth ----
// Staff sign in with email + password via Supabase Auth (passwords are
// hashed and verified server-side — never stored or checked in this code).
// Each person's role (regular/manager) and display name live in the
// `staff_profiles` table, keyed by their auth user id.

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  const profile = await getStaffProfile(data.user.id);
  return { user: data.user, profile };
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  const profile = await getStaffProfile(data.session.user.id);
  return { user: data.session.user, profile };
}

export async function getStaffProfile(userId) {
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("name, role")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return { name: "Staff", role: "regular" };
  return data;
}
