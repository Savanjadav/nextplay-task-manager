import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthState =
  | { status: 'initializing' }
  | { status: 'authenticated'; session: Session }
  | { status: 'error' }

export const AuthContext = createContext<(AuthState & { retry: () => void }) | null>(null)

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used within AuthProvider.')
  return auth
}
