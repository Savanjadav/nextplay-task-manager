import { PanelsTopLeft, X } from 'lucide-react'

type SidebarProps = {
  onClose?: () => void
}

export default function Sidebar({ onClose }: SidebarProps) {
  return (
    <div className="flex min-h-full flex-col bg-surface">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
        <div className="flex items-center gap-3">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-white">
            <PanelsTopLeft aria-hidden="true" size={17} />
          </span>
          <span className="text-base font-semibold tracking-tight">Next Play</span>
        </div>
        {onClose && (
          <button
            type="button"
            autoFocus
            aria-label="Close navigation"
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-todo-tint"
          >
            <X aria-hidden="true" size={19} />
          </button>
        )}
      </div>

      <nav aria-label="Workspace" className="p-4">
        <ul className="space-y-1">
          <li>
            <span aria-current="page" className="flex min-h-11 items-center gap-3 rounded-lg bg-accent-tint px-3 font-semibold text-accent-hover">
              <PanelsTopLeft aria-hidden="true" size={18} className="shrink-0" />
              My Board
            </span>
          </li>
        </ul>
      </nav>

      <div className="mt-auto border-t px-4 py-4 text-xs text-muted">Task Workspace</div>
    </div>
  )
}
