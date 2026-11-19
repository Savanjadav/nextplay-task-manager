import { isAuthRetryableFetchError, isAuthSessionMissingError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import {
  taskPriorities,
  taskStatuses,
  type CreateTaskInput,
  type Task,
  type UpdateTaskInput,
} from '../../types/task'

type TaskErrorCode = 'auth_required' | 'invalid_input' | 'not_found' | 'request_failed' | 'network_error'

export class TaskServiceError extends Error {
  readonly code: TaskErrorCode

  constructor(code: TaskErrorCode, message: string) {
    super(message)
    this.name = 'TaskServiceError'
    this.code = code
  }
}

const editableFields = ['title', 'description', 'status', 'priority', 'due_date']
const taskIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function invalidInput(message: string): never {
  throw new TaskServiceError('invalid_input', message)
}

function validateTaskId(id: string) {
  if (typeof id !== 'string' || !taskIdPattern.test(id)) invalidInput('Enter a valid task ID.')
}

function validateTitle(value: unknown) {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title) invalidInput('Enter a task title.')
  if ([...title].length > 200) invalidInput('Use 200 characters or fewer for the task title.')
  return title
}

function nullableText(value: unknown, label: string) {
  if (value === null) return null
  if (typeof value !== 'string') invalidInput(label + ' must be text or null.')
  return value.trim() || null
}

function validateDueDate(value: unknown) {
  const date = nullableText(value, 'Due date')
  if (date === null) return null

  const parsed = new Date(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000-') ||
      !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    invalidInput('Enter a valid due date in YYYY-MM-DD format.')
  }
  return date
}

function enumValue<T extends string>(value: unknown, options: readonly T[], label: string): T {
  const match = options.find((option) => option === value)
  if (!match) invalidInput('Choose a valid task ' + label + '.')
  return match
}

function normalizeFields(input: UpdateTaskInput): UpdateTaskInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    invalidInput('Provide a task object.')
  }

  const fields = { ...input }
  if (Object.keys(fields).some((key) => !editableFields.includes(key))) {
    invalidInput('Only title, description, status, priority, and due date can be supplied.')
  }

  const normalized: UpdateTaskInput = {}
  if (fields.title !== undefined) normalized.title = validateTitle(fields.title)
  if (fields.description !== undefined) normalized.description = nullableText(fields.description, 'Description')
  if (fields.status !== undefined) normalized.status = enumValue(fields.status, taskStatuses, 'status')
  if (fields.priority !== undefined) normalized.priority = enumValue(fields.priority, taskPriorities, 'priority')
  if (fields.due_date !== undefined) normalized.due_date = validateDueDate(fields.due_date)
  return normalized
}

async function authenticatedUserId(expectedGuestId?: string) {
  const { data, error } = await supabase.auth.getUser()
  if (isAuthRetryableFetchError(error)) {
    throw new TaskServiceError('network_error', 'Could not reach the authentication service. Try again.')
  }
  if (isAuthSessionMissingError(error) || error?.status === 401 || error?.status === 403) {
    throw new TaskServiceError('auth_required', 'An authenticated workspace session is required.')
  }
  if (error) throw new TaskServiceError('request_failed', 'Could not verify the workspace session.')
  if (!data.user?.id) throw new TaskServiceError('auth_required', 'An authenticated workspace session is required.')
  if (expectedGuestId !== undefined && data.user.id !== expectedGuestId) {
    throw new TaskServiceError('auth_required', 'The guest session changed before the task could be saved.')
  }
  return data.user.id
}

function taskRequestFailed(status: number, operation: 'load' | 'create' | 'update' | 'delete'): never {
  if (status === 0) {
    throw new TaskServiceError('network_error', 'Could not reach the task service. Check your connection and try again.')
  }
  if (status === 401) {
    throw new TaskServiceError('auth_required', 'An authenticated workspace session is required.')
  }
  throw new TaskServiceError('request_failed', 'Could not ' + operation + ' the task data.')
}

export async function getTasks(expectedGuestId?: string): Promise<Task[]> {
  const userId = await authenticatedUserId(expectedGuestId)
  const tasks: Task[] = []
  const pageSize = 1000

  // Advance by the returned count because the Data API can impose a lower row limit.
  while (true) {
    const { data, error, status, count } = await supabase
      .from('tasks')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(tasks.length, tasks.length + pageSize - 1)

    if (error) taskRequestFailed(status, 'load')
    if (data.length === 0) return tasks
    tasks.push(...data)
    if (count !== null && tasks.length >= count) return tasks
  }
}

export async function createTask(input: CreateTaskInput, expectedGuestId?: string): Promise<Task> {
  const fields = normalizeFields(input)
  if (fields.title === undefined) invalidInput('Enter a task title.')
  const userId = await authenticatedUserId(expectedGuestId)

  const { data, error, status } = await supabase
    .from('tasks')
    .insert({ ...fields, title: fields.title, user_id: userId })
    .select()
    .single()

  if (error) taskRequestFailed(status, 'create')
  return data
}

export async function updateTask(taskId: string, updates: UpdateTaskInput, expectedGuestId?: string): Promise<Task> {
  validateTaskId(taskId)
  const changes = normalizeFields(updates)
  if (Object.keys(changes).length === 0) invalidInput('Supply at least one task change.')
  const userId = await authenticatedUserId(expectedGuestId)

  const { data, error, status } = await supabase
    .from('tasks')
    .update(changes)
    .eq('id', taskId)
    .eq('user_id', userId)
    .select()
    .maybeSingle()

  if (error) taskRequestFailed(status, 'update')
  if (!data) throw new TaskServiceError('not_found', 'The task could not be found or accessed.')
  return data
}

export async function deleteTask(taskId: string, expectedGuestId?: string): Promise<{ deleted: boolean }> {
  validateTaskId(taskId)
  const userId = await authenticatedUserId(expectedGuestId)

  const { data, error, status } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle()

  if (error) taskRequestFailed(status, 'delete')
  return { deleted: data !== null }
}
