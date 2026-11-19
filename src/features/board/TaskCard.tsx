import { useDraggable } from '@dnd-kit/react'
import { CalendarDays, GripVertical, Pencil } from 'lucide-react'
import { taskStatuses, type Task, type TaskPriority, type TaskStatus } from '../../types/task'
import { boardColumns } from './boardConfig'

interface TaskCardProps {
  task: Task
  onEdit: (task: Task) => void
  onMove: (task: Task, status: TaskStatus) => void
  moving: boolean
}

const priorities = {
  low: { label: 'Low', style: 'bg-todo-tint text-todo' },
  normal: { label: 'Normal', style: 'bg-accent-tint text-accent-hover' },
  high: { label: 'High', style: 'bg-danger-tint text-danger' },
} satisfies Record<TaskPriority, { label: string; style: string }>

const dueDateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

export default function TaskCard({ task, onEdit, onMove, moving }: TaskCardProps) {
  const { ref, handleRef, isDragging } = useDraggable({ id: task.id, disabled: moving })
  const priority = priorities[task.priority]

  return (
    <article
      ref={ref}
      className={`relative rounded-xl border bg-surface p-4 hover:border-control ${isDragging ? 'opacity-40' : ''}`}
    >
      <h3 className="pr-20 text-base font-semibold wrap-anywhere">{task.title}</h3>
      {task.description?.trim() && (
        <p className="mt-1 line-clamp-2 wrap-anywhere text-muted">{task.description}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={`rounded-full px-2 py-1 font-medium ${priority.style}`}>
          <span className="sr-only">Priority: </span>{priority.label}
        </span>
        {task.due_date && (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted">
            <CalendarDays aria-hidden="true" size={14} />
            <span className="sr-only">Due </span>
            <time dateTime={task.due_date}>{dueDateFormat.format(new Date(task.due_date))}</time>
          </span>
        )}
      </div>
      <button
        id={`task-edit-${task.id}`}
        type="button"
        aria-label={`Edit ${task.title}`}
        aria-haspopup="dialog"
        disabled={moving || isDragging}
        onClick={(event) => {
          event.currentTarget.focus()
          onEdit(task)
        }}
        className="absolute inset-0 cursor-pointer rounded-xl text-muted hover:text-accent disabled:cursor-default"
      >
        <Pencil aria-hidden="true" size={15} className="absolute right-4 top-5" />
      </button>
      <button
        ref={handleRef}
        id={`task-drag-${task.id}`}
        type="button"
        aria-label={`Drag ${task.title} or choose a column`}
        onClick={(event) => {
          if (event.detail === 0) document.getElementById(`task-move-${task.id}`)?.focus()
        }}
        disabled={moving}
        className="absolute right-8 top-1 grid size-11 touch-none cursor-grab select-none place-items-center rounded-lg text-muted hover:text-accent active:cursor-grabbing disabled:cursor-default"
      >
        <GripVertical aria-hidden="true" size={18} />
      </button>
      <select
        id={`task-move-${task.id}`}
        aria-label={`Move ${task.title} to column`}
        disabled={moving || isDragging}
        value=""
        onChange={(event) => {
          const value = event.currentTarget.value
          const status = taskStatuses.find((option) => option === value)
          if (status) onMove(task, status)
        }}
        className="relative mt-3 min-h-11 max-w-full rounded-lg border border-control bg-surface px-2 text-xs text-muted disabled:opacity-60"
      >
        <option value="">{moving ? 'Moving…' : 'Move to…'}</option>
        {taskStatuses.filter((status) => status !== task.status).map((status) => (
          <option key={status} value={status}>{boardColumns[status].title}</option>
        ))}
      </select>
    </article>
  )
}
