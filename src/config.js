// Supabase connection. The URL and the publishable ("anon") key are meant to be
// public: access is enforced by the row-level security rules in
// supabase/schema.sql. Set them in .env.production (or GitHub Actions
// variables SUPABASE_URL / SUPABASE_ANON_KEY). Without them the site runs in
// demo mode and keeps comments only in the current browser.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim();
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
export const IS_DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;

export const AUDIO_BUCKET = 'comment-audio';
export const MAX_RECORDING_SEC = 300;
export const MAX_TEXT_LENGTH = 5000;
