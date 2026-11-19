export const taskStatuses = ['todo', 'in_progress', 'in_review', 'done'] as const
export const taskPriorities = ['low', 'normal', 'high'] as const

export type TaskStatus = (typeof taskStatuses)[number]
export type TaskPriority = (typeof taskPriorities)[number]

export type Task = {
  id: string
  title: string
  status: TaskStatus
  user_id: string
  created_at: string
  description: string | null
  priority: TaskPriority
  due_date: string | null
}

export type UpdateTaskInput = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'due_date'>>
export type CreateTaskInput = UpdateTaskInput & Pick<Task, 'title'>
