import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const isSupabaseConfigured = Boolean(
  url && publishableKey && !url.includes('your-project-ref') && !publishableKey.includes('replace_me'),
)

export const supabase = isSupabaseConfigured && url && publishableKey
  ? createClient(url, publishableKey)
  : null

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase ist noch nicht eingerichtet. Bitte .env.local konfigurieren.')
  }
  return supabase
}
