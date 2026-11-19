import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState, type ReactNode } from 'react'
import { AuthContext, type AuthState } from './useAuth'

let pendingSession: Promise<Session> | undefined

async function restoreOrSignIn(auth: SupabaseClient['auth']) {
  const { data: existing, error: restoreError } = await auth.getSession()
  if (restoreError) throw restoreError
  if (existing.session) return existing.session

  const { data, error } = await auth.signInAnonymously()
  if (error) throw error
  if (!data.session) throw new Error('Guest sign-in did not return a session.')
  return data.session
}

function initializeSession(auth: SupabaseClient['auth']) {
  // React Strict Mode can remount the provider before the first request finishes.
  pendingSession ??= restoreOrSignIn(auth).finally(() => {
    pendingSession = undefined
  })
  return pendingSession
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'initializing' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    let receivedAuthEvent = false

    async function initialize() {
      try {
        // Keep configuration errors inside the workspace's error state.
        const { supabase } = await import('../../lib/supabase')
        if (!active) return

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          if (!active || event === 'INITIAL_SESSION') return
          receivedAuthEvent = true
          setState(session ? { status: 'authenticated', session } : { status: 'error' })
        })
        unsubscribe = () => subscription.unsubscribe()

        const session = await initializeSession(supabase.auth)
        if (active && !receivedAuthEvent) setState({ status: 'authenticated', session })
      } catch {
        if (active && !receivedAuthEvent) setState({ status: 'error' })
      }
    }

    void initialize()
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [attempt])

  function retry() {
    setState({ status: 'initializing' })
    setAttempt((previous) => previous + 1)
  }

  return <AuthContext value={{ ...state, retry }}>{children}</AuthContext>
}
