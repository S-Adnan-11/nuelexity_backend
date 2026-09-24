import { createClient } from '@supabase/supabase-js'

export function createSupabaseClient() {
  return createClient(

   import.meta.env.VITE_SUPABASE_URL!,
   import.meta.env.VITE_SUPABASE_SECRET_KEY!
  )
}
