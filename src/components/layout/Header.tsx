import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'

export default function Header({ onNewTask, taskControls }: { onNewTask?: () => void; taskControls?: ReactNode }) {
  return (
    <header className="border-b bg-surface px-4 py-6 md:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-page font-semibold tracking-tight sm:text-page-lg">My Board</h1>
          <p className="mt-1 text-muted">Organize your tasks and keep work moving.</p>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.currentTarget.focus()
            onNewTask?.()
          }}
          disabled={!onNewTask}
          aria-haspopup="dialog"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-accent/80"
        >
          <Plus aria-hidden="true" size={18} />
          New Task
        </button>
      </div>

      {taskControls}
    </header>
  )
}
