import type { Task, TaskPriority, TaskStatus } from '../../types/task'

export interface TaskFilters {
  search: string
  priority: TaskPriority | ''
  status: TaskStatus | ''
}

export const defaultTaskFilters: TaskFilters = { search: '', priority: '', status: '' }

export function hasTaskFilters(filters: TaskFilters) {
  return Boolean(filters.search.trim() || filters.priority || filters.status)
}

export function filterTasks(tasks: readonly Task[], filters: TaskFilters) {
  const query = filters.search.trim().toLowerCase()

  return tasks.filter((task) =>
    (!filters.priority || task.priority === filters.priority) &&
    (!filters.status || task.status === filters.status) &&
    (!query || task.title.toLowerCase().includes(query) || task.description?.toLowerCase().includes(query)),
  )
}
