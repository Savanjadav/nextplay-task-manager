import { useEffect, useRef, useState } from 'react'
import type { Task, TaskStatus } from '../../types/task'

type TaskLoadState =
  | { status: 'loading' }
  | { status: 'ready'; tasks: Task[] }
  | { status: 'error' }

function compareCreatedTasks(a: Task, b: Task) {
  const byMillisecond = Date.parse(b.created_at) - Date.parse(a.created_at)
  if (byMillisecond) return byMillisecond

  // PostgreSQL timestamps can differ within the same JavaScript millisecond.
  const fraction = (task: Task) => (task.created_at.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0')
  return fraction(b).localeCompare(fraction(a)) || a.id.localeCompare(b.id)
}

// Mount the consumer with the guest ID as its key to reset state on identity changes.
export function useTasks(userId: string) {
  const [state, setState] = useState<TaskLoadState>({ status: 'loading' })
  const mounted = useRef(false)
  const movingIds = useRef(new Set<string>())
  const [pendingMoves, setPendingMoves] = useState<ReadonlySet<string>>(new Set())
  const revision = useRef(0)
  const confirmedMoves = useRef(new Map<string, { revision: number; status: TaskStatus }>())
  const uncertaintyVersion = useRef(0)
  const [uncertainMove, setUncertainMove] = useState<number | null>(null)
  const refreshing = useRef(false)
  const deletedIds = useRef(new Set<string>())
  const [attempt, setAttempt] = useState(0)
  const request = useRef<{
    userId: string
    attempt: number
    revision: number
    uncertaintyVersion: number
    promise: Promise<Task[]>
  } | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    // The Strict Mode effect replay joins the same request for this guest and attempt.
    if (request.current?.userId !== userId || request.current.attempt !== attempt) {
      request.current = {
        userId,
        attempt,
        revision: revision.current,
        uncertaintyVersion: uncertaintyVersion.current,
        // Keep Supabase initialization behind the existing auth error boundary.
        promise: import('./taskService').then(({ getTasks }) => getTasks(userId)),
      }
    }

    let active = true
    const load = request.current
    void load.promise.then(
      (tasks) => {
        if (!active) return
        refreshing.current = false
        // This response only reconciles uncertainty that existed when the fetch started.
        setUncertainMove((current) => current !== null && current <= load.uncertaintyVersion ? null : current)
        // Auth can change while the service is resolving the active session.
        setState(() => ({
          status: 'ready',
          tasks: tasks.filter((task) => task.user_id === userId && !deletedIds.current.has(task.id)).map((task) => {
            const move = confirmedMoves.current.get(task.id)
            return move && move.revision > load.revision ? { ...task, status: move.status } : task
          }),
        }))
      },
      () => {
        if (!active) return
        refreshing.current = false
        setState({ status: 'error' })
      },
    )
    return () => {
      active = false
    }
  }, [userId, attempt])

  function reloadTasks() {
    if (state.status === 'loading' || refreshing.current) return
    refreshing.current = true
    setState({ status: 'loading' })
    setAttempt((previous) => previous + 1)
  }

  function applySavedTask(task: Task) {
    if (task.user_id !== userId || deletedIds.current.has(task.id)) return

    setState((previous) => {
      if (previous.status !== 'ready') return previous
      const tasks = previous.tasks.filter(({ id }) => id !== task.id)
      const index = tasks.findIndex((current) => compareCreatedTasks(task, current) < 0)
      tasks.splice(index === -1 ? tasks.length : index, 0, task)
      return { status: 'ready', tasks }
    })
  }

  function markMoveUncertain() {
    uncertaintyVersion.current += 1
    setUncertainMove(uncertaintyVersion.current)
    return { outcome: 'uncertain' as const }
  }

  async function moveTask(taskId: string, status: TaskStatus) {
    if (!mounted.current || state.status !== 'ready' || movingIds.current.has(taskId)) return
    const task = state.tasks.find(({ id }) => id === taskId)
    if (!task || task.user_id !== userId || task.status === status) return

    movingIds.current.add(taskId)
    setPendingMoves(new Set(movingIds.current))
    try {
      const { updateTask, TaskServiceError } = await import('./taskService')
      if (!mounted.current) return
      let saved: Task
      try {
        saved = await updateTask(taskId, { status }, userId)
      } catch (error) {
        if (!mounted.current) return
        return error instanceof TaskServiceError && error.code === 'network_error'
          ? markMoveUncertain()
          : { outcome: 'failed' as const }
      }

      if (!mounted.current) return
      if (saved.id !== taskId || saved.user_id !== userId || saved.status !== status) {
        return markMoveUncertain()
      }
      revision.current += 1
      confirmedMoves.current.set(taskId, { revision: revision.current, status: saved.status })
      applySavedTask(saved)
      return { outcome: 'saved' as const, task: saved }
    } catch {
      if (mounted.current) return { outcome: 'failed' as const }
    } finally {
      movingIds.current.delete(taskId)
      if (mounted.current) setPendingMoves(new Set(movingIds.current))
    }
  }

  function isMoving(taskId: string) {
    return movingIds.current.has(taskId)
  }

  function removeConfirmedTask(taskId: string) {
    // A load that read before the confirmed delete must not restore this ID.
    deletedIds.current.add(taskId)
    setState((previous) => previous.status === 'ready'
      ? { status: 'ready', tasks: previous.tasks.filter(({ id }) => id !== taskId) }
      : previous)
  }

  return {
    ...state, reloadTasks, applySavedTask, removeConfirmedTask, moveTask, pendingMoves, isMoving,
    hasUncertainMove: uncertainMove !== null,
    dismissUncertainMove: () => setUncertainMove(null),
  }
}
