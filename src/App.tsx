import { useLayoutEffect, useRef, useState } from 'react'
import AppLayout from './components/layout/AppLayout'
import AuthFeedback from './features/auth/AuthFeedback'
import { useAuth } from './features/auth/useAuth'
import KanbanBoard from './features/board/KanbanBoard'
import TaskFilterControls from './features/tasks/TaskFilterControls'
import { defaultTaskFilters, filterTasks, hasTaskFilters, type TaskFilters } from './features/tasks/taskFilters'
import TaskDialog from './features/tasks/TaskDialog'
import { useTasks } from './features/tasks/useTasks'
import { boardColumns } from './features/board/boardConfig'
import type { Task, TaskStatus } from './types/task'

function GuestBoard({
  load, filters, onEdit, onMove,
}: {
  load: ReturnType<typeof useTasks>
  filters: TaskFilters
  onEdit: (task: Task) => void
  onMove: (task: Task, status: TaskStatus) => void
}) {
  if (load.status === 'loading') {
    return (
      <div role="status" className="grid min-h-64 place-items-center rounded-xl border bg-surface px-6 py-10 text-muted">
        Loading your tasks…
      </div>
    )
  }

  if (load.status === 'error') {
    return (
      <div className="grid min-h-64 place-items-center rounded-xl border bg-surface px-6 py-10 text-center">
        <div className="space-y-4">
          <p role="alert" className="font-medium text-ink">
            Unable to load your tasks. Please try again.
          </p>
          {!load.hasUncertainMove && (
            <button
              type="button"
              onClick={load.reloadTasks}
              className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover active:bg-accent-active"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    )
  }

  const isFiltered = hasTaskFilters(filters)
  const visibleTasks = isFiltered ? filterTasks(load.tasks, filters) : load.tasks

  return (
    <>
      {load.tasks.length === 0 ? (
        <p className="mb-4 rounded-xl border bg-surface px-4 py-3 text-sm text-muted">
          No tasks yet. Once you create tasks, they’ll appear here.
        </p>
      ) : (
        <p role="status" className="mb-3 text-sm text-muted">
          {isFiltered
            ? `Showing ${visibleTasks.length} of ${load.tasks.length} tasks`
            : `${load.tasks.length} ${load.tasks.length === 1 ? 'task' : 'tasks'} total`}
          {visibleTasks.length === 0 && (
            <span className="mt-1 block">No tasks match your search or filters.</span>
          )}
        </p>
      )}
      <KanbanBoard
        tasks={visibleTasks}
        onEdit={onEdit}
        onMove={onMove}
        pendingMoves={load.pendingMoves}
        filtered={isFiltered && load.tasks.length > 0}
      />
    </>
  )
}

function GuestWorkspace({ userId }: { userId: string }) {
  const load = useTasks(userId)
  const [filters, setFilters] = useState(defaultTaskFilters)
  const [saveNotice, setSaveNotice] = useState('')
  const [moveResult, setMoveResult] = useState<Awaited<ReturnType<typeof load.moveTask>>>()
  const [moveFocus, setMoveFocus] = useState<{ status: TaskStatus; controlId: string } | null>(null)
  const [dialog, setDialog] = useState<{ task?: Task } | null>(null)
  const refreshButton = useRef<HTMLButtonElement>(null)
  const restoringRefreshFocus = useRef(false)
  const returnToTask = useRef<Pick<Task, 'id' | 'status'> | null>(null)

  useLayoutEffect(() => {
    if (dialog || !returnToTask.current) return
    const target = document.getElementById(`task-edit-${returnToTask.current.id}`)
      ?? document.getElementById(`column-${returnToTask.current.status}`)
      ?? document.querySelector<HTMLElement>('main')
    target?.focus()
    returnToTask.current = null
  }, [dialog])

  useLayoutEffect(() => {
    if (!moveFocus) return
    const active = document.activeElement
    if (active === document.body || active?.id === moveFocus.controlId) {
      const target = document.getElementById(moveFocus.controlId)
        ?? document.getElementById(`column-${moveFocus.status}`)
        ?? document.querySelector<HTMLElement>('main')
      target?.focus()
    }
  }, [moveFocus])

  function focusBoard() {
    const target = document.querySelector<HTMLElement>('[aria-label="Kanban board"]')
      ?? document.querySelector<HTMLElement>('main')
    target?.focus()
  }

  useLayoutEffect(() => {
    if (load.hasUncertainMove || !restoringRefreshFocus.current) return
    restoringRefreshFocus.current = false
    if (document.activeElement === document.body) focusBoard()
  }, [load.hasUncertainMove])

  function refreshBoard() {
    if (load.status === 'loading') return
    restoringRefreshFocus.current = document.activeElement === refreshButton.current
    setMoveResult(undefined)
    load.reloadTasks()
  }

  function dismissRecovery() {
    restoringRefreshFocus.current = false
    load.dismissUncertainMove()
    focusBoard()
  }

  async function moveTask(task: Task, status: TaskStatus) {
    if (dialog || load.isMoving(task.id) || task.status === status) return
    const focusedId = document.activeElement?.id
    const restoreFocus = focusedId === `task-move-${task.id}` || focusedId === `task-drag-${task.id}`
    setMoveResult(undefined)
    setSaveNotice('')
    const result = await load.moveTask(task.id, status)
    if (!result) return
    setMoveResult(result)
    if (restoreFocus && focusedId) {
      setMoveFocus({ status: result.outcome === 'saved' ? status : task.status, controlId: focusedId })
    }
  }

  function changeFilters(next: TaskFilters) {
    setFilters(next)
    setSaveNotice('')
    setMoveResult(undefined)
  }

  function saveTask(task: Task) {
    load.applySavedTask(task)
    if (filterTasks([task], filters).length === 0) {
      setSaveNotice('Task saved. Clear filters to see it.')
    }
  }

  function editTask(task: Task) {
    if (load.isMoving(task.id)) return
    setSaveNotice('')
    setMoveResult(undefined)
    returnToTask.current = task
    setDialog({ task })
  }

  return (
    <AppLayout
      onNewTask={load.status === 'ready' ? () => {
        setSaveNotice('')
        setMoveResult(undefined)
        setDialog({})
      } : undefined}
      taskControls={load.status === 'ready' ? <TaskFilterControls filters={filters} onChange={changeFilters} /> : undefined}
    >
      <div role="status" className={saveNotice ? 'mb-3 text-sm text-muted' : 'sr-only'}>{saveNotice}</div>
      <div role="status" className={load.pendingMoves.size || moveResult?.outcome === 'saved' ? 'mb-3 text-sm text-muted' : 'sr-only'}>
        {load.pendingMoves.size ? 'Moving task…' : moveResult?.outcome === 'saved' && (
          filterTasks([moveResult.task], filters).length
            ? `Task moved to ${boardColumns[moveResult.task.status].title}.`
            : `Task moved to ${boardColumns[moveResult.task.status].title}. Clear filters to see it.`
        )}
      </div>
      {moveResult?.outcome === 'failed' && (
        <p role="alert" className="mb-3 text-sm text-danger">Unable to move this task. Try moving it again.</p>
      )}
      {load.hasUncertainMove && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <p role="alert" className="text-danger">
            We couldn’t confirm whether one or more moves were saved. Refresh the board to check.
          </p>
          <button
            ref={refreshButton}
            type="button"
            aria-disabled={load.status === 'loading'}
            onClick={refreshBoard}
            className="min-h-11 rounded-lg border border-control px-3 font-semibold hover:bg-accent-tint aria-disabled:opacity-60"
          >
            {load.status === 'loading' ? 'Refreshing…' : 'Refresh Board'}
          </button>
          <button type="button" onClick={dismissRecovery} className="min-h-11 rounded-lg px-3 font-semibold hover:bg-accent-tint">
            Dismiss
          </button>
        </div>
      )}
      <GuestBoard load={load} filters={filters} onEdit={editTask} onMove={(task, status) => void moveTask(task, status)} />
      {dialog && (
        <TaskDialog
          task={dialog.task}
          userId={userId}
          onSaved={saveTask}
          canDelete={load.status === 'ready' && load.tasks.some(({ id, user_id }) =>
            id === dialog.task?.id && user_id === userId)}
          onDeleted={load.removeConfirmedTask}
          onDismiss={() => setDialog(null)}
          onRefresh={load.reloadTasks}
        />
      )}
    </AppLayout>
  )
}

export default function App() {
  const auth = useAuth()

  if (auth.status === 'authenticated') {
    return <GuestWorkspace key={auth.session.user.id} userId={auth.session.user.id} />
  }

  return (
    <AppLayout>
      <AuthFeedback status={auth.status} retry={auth.retry} />
    </AppLayout>
  )
}
