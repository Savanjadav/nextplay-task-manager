import { Search } from 'lucide-react'
import { useRef } from 'react'
import { taskPriorities, taskStatuses } from '../../types/task'
import { boardColumns } from '../board/boardConfig'
import { defaultTaskFilters, hasTaskFilters, type TaskFilters } from './taskFilters'

const selectClass = 'h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-2 text-sm text-ink'

export default function TaskFilterControls({
  filters,
  onChange,
}: {
  filters: TaskFilters
  onChange: (filters: TaskFilters) => void
}) {
  const searchRef = useRef<HTMLInputElement>(null)

  function clearFilters() {
    onChange(defaultTaskFilters)
    searchRef.current?.focus()
  }

  return (
    <div role="group" aria-label="Search and filter tasks" className="mt-5 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
      <label className="col-span-2 grid min-w-0 gap-1.5 text-sm font-medium sm:w-64">
        Search tasks
        <span className="flex h-11 min-w-0 items-center gap-2 rounded-lg border border-control bg-surface px-3 text-muted">
          <Search aria-hidden="true" size={17} className="shrink-0" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search tasks…"
            value={filters.search}
            onChange={(event) => onChange({ ...filters, search: event.currentTarget.value })}
            className="min-w-0 flex-1 text-ink placeholder:text-muted"
          />
        </span>
      </label>

      <label className="grid min-w-0 gap-1.5 text-sm font-medium sm:w-36">
        Priority
        <select
          value={filters.priority}
          onChange={(event) => {
            const value = event.currentTarget.value
            onChange({ ...filters, priority: taskPriorities.find((priority) => priority === value) ?? '' })
          }}
          className={selectClass}
        >
          <option value="">All Priorities</option>
          {taskPriorities.map((priority) => (
            <option key={priority} value={priority}>{priority[0].toUpperCase() + priority.slice(1)}</option>
          ))}
        </select>
      </label>

      <label className="grid min-w-0 gap-1.5 text-sm font-medium sm:w-36">
        Status
        <select
          value={filters.status}
          onChange={(event) => {
            const value = event.currentTarget.value
            onChange({ ...filters, status: taskStatuses.find((status) => status === value) ?? '' })
          }}
          className={selectClass}
        >
          <option value="">All Statuses</option>
          {taskStatuses.map((status) => (
            <option key={status} value={status}>{boardColumns[status].title}</option>
          ))}
        </select>
      </label>

      <button
        type="button"
        disabled={!hasTaskFilters(filters)}
        onClick={clearFilters}
        className="col-span-2 min-h-11 justify-self-start rounded-lg border border-control px-3 text-sm font-semibold text-ink hover:bg-accent-tint disabled:opacity-50 disabled:hover:bg-transparent"
      >
        Clear Filters
      </button>
    </div>
  )
}
