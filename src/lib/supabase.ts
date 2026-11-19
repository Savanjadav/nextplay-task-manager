import { createClient } from '@supabase/supabase-js'
import type { CreateTaskInput, Task, UpdateTaskInput } from '../types/task'

type Database = {
  public: {
    Tables: {
      tasks: {
        Row: Task
        Insert: CreateTaskInput & Pick<Task, 'user_id'>
        Update: UpdateTaskInput
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: Record<never, never>
  }
}

const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const publicKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

if (!projectUrl) {
  throw new Error('Missing VITE_SUPABASE_URL. Set it in .env.local.')
}

const url = URL.parse(projectUrl)

if (!url || url.protocol !== 'https:' || url.href !== `${url.origin}/`) {
  throw new Error('VITE_SUPABASE_URL must be the HTTPS project root without credentials, a path, query, or fragment.')
}

if (!publicKey) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY. Set it in .env.local.')
}

function isLegacyAnonKey(key: string) {
  const parts = key.split('.')

  if (parts.length !== 3 || parts.some((part) => !part)) return false

  try {
    const claims: { role?: string } = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return claims?.role === 'anon'
  } catch {
    return false
  }
}

if (!/^sb_publishable_[\w-]+$/.test(publicKey) && !isLegacyAnonKey(publicKey)) {
  throw new Error('VITE_SUPABASE_ANON_KEY must be a Supabase publishable key or legacy anon key.')
}

export const supabase = createClient<Database>(url.origin, publicKey)
