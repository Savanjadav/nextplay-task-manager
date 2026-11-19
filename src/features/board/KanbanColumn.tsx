import { useDroppable } from '@dnd-kit/react'
import { Inbox } from 'lucide-react'
import type { Task, TaskStatus } from '../../types/task'
import type { ColumnColor } from './boardConfig'
import TaskCard from './TaskCard'

interface KanbanColumnProps {
  status: TaskStatus
  title: string
  description: string
  tasks: Task[]
  filtered: boolean
  onEdit: (task: Task) => void
  onMove: (task: Task, status: TaskStatus) => void
  pendingMoves: ReadonlySet<string>
  color: ColumnColor
}

const statusStyles = {
  todo: { dot: 'bg-todo', badge: 'bg-todo-tint text-todo' },
  progress: { dot: 'bg-progress', badge: 'bg-progress-tint text-progress' },
  review: { dot: 'bg-review', badge: 'bg-review-tint text-review' },
  done: { dot: 'bg-done', badge: 'bg-done-tint text-done' },
}

export default function KanbanColumn({ status, title, description, tasks, color, onEdit, onMove, pendingMoves, filtered }: KanbanColumnProps) {
  const { ref, isDropTarget } = useDroppable({ id: `column-${status}` })
  const count = tasks.length
  const headingId = `column-${status}`
  const { dot, badge } = statusStyles[color]

  return (
    <section
      ref={ref}
      data-drop-column={status}
      aria-labelledby={headingId}
      className={`min-h-64 rounded-xl border p-4 ${isDropTarget ? 'border-accent bg-accent-tint ring-2 ring-inset ring-accent' : 'bg-todo-tint'}`}
    >
      <header>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
          <h2 id={headingId} tabIndex={-1} className="text-base font-semibold">{title}</h2>
          <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${badge}`}>
            {count}<span className="sr-only"> {count === 1 ? 'task' : 'tasks'}</span>
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </header>

      {count > 0 ? (
        <ul className="mt-4 space-y-3">
          {tasks.map((task) => (
            <li key={task.id}>
              <TaskCard task={task} onEdit={onEdit} onMove={onMove} moving={pendingMoves.has(task.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed bg-surface px-3 py-6 text-center">
          <Inbox aria-hidden="true" size={18} className="mx-auto mb-2 text-muted" />
          <p className="font-medium">{filtered ? 'No matching tasks' : 'No tasks yet'}</p>
          {!filtered && <p className="mt-1 text-xs text-muted">Tasks in this stage will appear here.</p>}
        </div>
      )}
    </section>
  )
}
