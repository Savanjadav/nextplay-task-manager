import { Trash2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { taskPriorities, taskStatuses, type CreateTaskInput, type Task, type UpdateTaskInput } from '../../types/task'
import { boardColumns } from '../board/boardConfig'

const control = 'mt-2 min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 py-2 text-ink'

interface TaskDialogProps {
  userId: string
  onDismiss: () => void
  task?: Task
  onSaved: (task: Task) => void
  onRefresh: () => void
  canDelete: boolean
  onDeleted: (taskId: string) => void
}

export default function TaskDialog({ userId, task, onDismiss, onSaved, onRefresh, canDelete, onDeleted }: TaskDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  const progressRef = useRef<HTMLSpanElement>(null)
  const [saving, setSaving] = useState(false)
  const [titleError, setTitleError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [missing, setMissing] = useState(false)
  const failureMessage = task ? 'Unable to save your changes. Please try again.' : 'Unable to create your task. Please try again.'
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [refreshAfterDelete, setRefreshAfterDelete] = useState(false)
  const deleteTrigger = useRef<HTMLButtonElement>(null)
  const cancelDelete = useRef<HTMLButtonElement>(null)
  const deleteProgress = useRef<HTMLSpanElement>(null)
  const returnToDeleteTrigger = useRef(false)
  const headingId = confirmingDelete ? 'delete-task-heading' : task ? 'edit-task-heading' : 'create-task-heading'

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    function protectPendingSave(event: Event) {
      if (submitting.current) event.preventDefault()
    }

    dialog.addEventListener('cancel', protectPendingSave)
    if (!dialog.open) {
      dialog.showModal()
      titleRef.current?.focus()
    }
    return () => dialog.removeEventListener('cancel', protectPendingSave)
  }, [])

  useLayoutEffect(() => {
    if (confirmingDelete) {
      dialogRef.current?.setAttribute('closedby', 'none')
      cancelDelete.current?.focus()
    } else if (returnToDeleteTrigger.current) {
      dialogRef.current?.removeAttribute('closedby')
      deleteTrigger.current?.focus()
      returnToDeleteTrigger.current = false
    }
  }, [confirmingDelete])

  function leaveDeleteConfirmation() {
    if (submitting.current) return
    returnToDeleteTrigger.current = true
    setConfirmingDelete(false)
    setDeleteError('')
    setRefreshAfterDelete(false)
  }

  async function confirmDeletion() {
    if (!task || !canDelete || !confirmingDelete || submitting.current || refreshAfterDelete) return
    submitting.current = true
    deleteProgress.current?.focus()
    setSaving(true)
    setDeleteError('')

    try {
      const { deleteTask, TaskServiceError } = await import('./taskService')
      if (!dialogRef.current?.open) return

      try {
        const result = await deleteTask(task.id, userId)
        if (!dialogRef.current?.open) return
        if (!result.deleted) {
          setDeleteError('This task could not be found or is no longer available.')
          setRefreshAfterDelete(true)
          return
        }
      } catch (error) {
        if (!dialogRef.current?.open) return
        if (error instanceof TaskServiceError && error.code === 'network_error') {
          setDeleteError('We couldn’t confirm whether the task was deleted. Refresh the board to check.')
          setRefreshAfterDelete(true)
        } else if (error instanceof TaskServiceError && error.code === 'auth_required') {
          setDeleteError('Your guest session changed. Reconnect to your workspace before trying again.')
          setRefreshAfterDelete(true)
        } else {
          setDeleteError('Unable to delete this task. Please try again.')
        }
        return
      }

      onDeleted(task.id)
      dialogRef.current.close()
      onDismiss()
    } catch {
      if (dialogRef.current?.open) setDeleteError('Unable to delete this task. Please try again.')
    } finally {
      submitting.current = false
      if (dialogRef.current?.open) setSaving(false)
    }
  }

  function dismiss() {
    if (submitting.current) return
    dialogRef.current?.close()
    onDismiss()
  }

  function refresh() {
    dismiss()
    onRefresh()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (confirmingDelete || submitting.current || missing) return

    const form = event.currentTarget
    const fields = new FormData(form)
    const title = String(fields.get('title') ?? '').trim()
    setSubmitError('')

    if (!title || [...title].length > 200) {
      setTitleError(title ? 'Task title must be 200 characters or fewer.' : 'Task title is required.')
      titleRef.current?.focus()
      return
    }
    setTitleError('')
    const dateControl = form.elements.namedItem('due_date')
    if (dateControl instanceof HTMLInputElement && !dateControl.validity.valid) {
      setSubmitError('Enter a valid due date.')
      dateControl.focus()
      return
    }

    const status = taskStatuses.find((value) => value === fields.get('status'))
    const priority = taskPriorities.find((value) => value === fields.get('priority'))
    if (!status || !priority) {
      setSubmitError('Choose a valid status and priority.')
      return
    }
    const input: CreateTaskInput = {
      title,
      description: String(fields.get('description') ?? '').trim() || null,
      status,
      priority,
      due_date: String(fields.get('due_date') ?? '') || null,
    }

    const changes: UpdateTaskInput = task ? {
      ...(input.title !== task.title.trim() && { title: input.title }),
      ...(input.description !== (task.description?.trim() || null) && { description: input.description }),
      ...(input.status !== task.status && { status: input.status }),
      ...(input.priority !== task.priority && { priority: input.priority }),
      ...(input.due_date !== (task.due_date || null) && { due_date: input.due_date }),
    } : {}
    if (task && Object.keys(changes).length === 0) {
      dismiss()
      return
    }

    submitting.current = true
    dialogRef.current?.setAttribute('closedby', 'none')
    progressRef.current?.focus()
    setSaving(true)

    try {
      const { createTask, updateTask, TaskServiceError } = await import('./taskService')
      if (!dialogRef.current?.open) return

      let saved: Task
      try {
        saved = task ? await updateTask(task.id, changes, userId) : await createTask(input, userId)
      } catch (error) {
        if (!dialogRef.current?.open) return
        if (error instanceof TaskServiceError && error.code === 'auth_required') {
          setSubmitError('Your guest session changed. Reconnect to your workspace before trying again.')
        } else if (error instanceof TaskServiceError && error.code === 'not_found') {
          setMissing(true)
          setSubmitError('This task is no longer available. Refresh the board to see your current tasks.')
        } else if (error instanceof TaskServiceError && error.code === 'network_error') {
          setSubmitError('We couldn’t confirm that your task was saved. Check your board before trying again.')
        } else {
          setSubmitError(failureMessage)
        }
        return
      }

      if (!dialogRef.current?.open) return
      if (saved.user_id !== userId || (task && saved.id !== task.id)) {
        setSubmitError('Your guest session changed. Reconnect to your workspace before trying again.')
        return
      }
      onSaved(saved)
      dialogRef.current.close()
      onDismiss()
    } catch {
      if (dialogRef.current?.open) setSubmitError(failureMessage)
    } finally {
      submitting.current = false
      if (dialogRef.current?.open) {
        dialogRef.current.removeAttribute('closedby')
        setSaving(false)
      }
    }
  }

  return (
    <dialog
      ref={dialogRef}
      role={confirmingDelete ? 'alertdialog' : undefined}
      aria-modal="true"
      aria-labelledby={headingId}
      aria-describedby={confirmingDelete ? 'delete-task-description' : 'task-dialog-description'}
      onClose={onDismiss}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        if (submitting.current || confirmingDelete) event.preventDefault()
        if (confirmingDelete) leaveDeleteConfirmation()
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-2xl border bg-surface p-0 text-ink shadow-lg backdrop:bg-ink/35"
    >
      {confirmingDelete && (
        <>
          <div className="space-y-3 px-5 py-5 sm:px-6">
            <h2 id="delete-task-heading" className="text-xl font-semibold tracking-tight">Delete this task?</h2>
            <p id="delete-task-description" className="wrap-anywhere text-sm text-muted">
              Permanently delete “{task?.title}”? This action cannot be undone.
            </p>
            {deleteError && <p role="alert" className="text-sm text-danger">{deleteError}</p>}
          </div>
          <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t bg-surface px-5 py-4 sm:px-6">
            <button ref={cancelDelete} type="button" disabled={saving} onClick={leaveDeleteConfirmation} className="min-h-11 rounded-lg border border-control px-4 font-semibold hover:bg-todo-tint disabled:opacity-60">
              Cancel
            </button>
            {refreshAfterDelete ? (
              <button type="button" onClick={refresh} className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover">
                Refresh Board
              </button>
            ) : (
              <button type="button" disabled={saving || !canDelete} onClick={() => void confirmDeletion()} className="min-h-11 rounded-lg bg-danger px-4 font-semibold text-white hover:brightness-90 disabled:opacity-80">
                {saving ? 'Deleting…' : 'Delete Task'}
              </button>
            )}
            <span ref={deleteProgress} role="status" tabIndex={-1} className="sr-only">{saving ? 'Deleting task…' : ''}</span>
          </div>
        </>
      )}
      <div hidden={confirmingDelete}>
        <div className="px-5 pt-5 sm:px-6 sm:pt-6">
          <h2 id={task ? 'edit-task-heading' : 'create-task-heading'} className="text-xl font-semibold tracking-tight">{task ? 'Edit Task' : 'Create New Task'}</h2>
          <p id="task-dialog-description" className="mt-1 text-sm text-muted">{task ? 'Update the details for this task.' : 'Add a task to your board.'}</p>
        </div>
        <form noValidate onSubmit={submit}>
          <fieldset disabled={saving || missing} className="grid min-w-0 gap-4 p-5 sm:p-6">
            <div>
              <label htmlFor="task-title" className="text-sm font-semibold">
                Task title <span aria-hidden="true" className="text-danger">*</span>
              </label>
              <input
                ref={titleRef}
                id="task-title"
                name="title"
                defaultValue={task?.title}
                required
                placeholder="What needs to be done?"
                aria-invalid={titleError ? true : undefined}
                aria-describedby={titleError ? 'task-title-error' : undefined}
                onChange={() => setTitleError('')}
                className={control}
              />
              {titleError && <p id="task-title-error" role="alert" className="mt-2 text-sm text-danger">{titleError}</p>}
            </div>
            <div>
              <label htmlFor="task-description" className="text-sm font-semibold">Description</label>
              <textarea id="task-description" name="description" defaultValue={task?.description ?? ''} rows={3} placeholder="Add more details…" className={control + ' resize-y'} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="task-status" className="text-sm font-semibold">Status</label>
                <select id="task-status" name="status" defaultValue={task?.status ?? 'todo'} className={control}>
                  {taskStatuses.map((status) => <option key={status} value={status}>{boardColumns[status].title}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="task-priority" className="text-sm font-semibold">Priority</label>
                <select id="task-priority" name="priority" defaultValue={task?.priority ?? 'normal'} className={control}>
                  {taskPriorities.map((priority) => (
                    <option key={priority} value={priority}>{priority[0].toUpperCase() + priority.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="task-due-date" className="text-sm font-semibold">Due date</label>
              <input id="task-due-date" name="due_date" type="date" defaultValue={task?.due_date ?? ''} min="0001-01-01" max="9999-12-31" className={control} />
            </div>
          </fieldset>
          {submitError && <p role="alert" className="px-5 pb-4 text-sm text-danger sm:px-6">{submitError}</p>}
          <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t bg-surface px-5 py-4 sm:px-6">
            {task && !missing && (
              <button
                ref={deleteTrigger}
                type="button"
                disabled={saving || !canDelete}
                onClick={() => setConfirmingDelete(true)}
                className="mr-auto inline-flex min-h-11 items-center gap-2 rounded-lg px-3 font-semibold text-danger hover:bg-danger-tint disabled:opacity-60"
              >
                <Trash2 aria-hidden="true" size={17} />
                Delete Task
              </button>
            )}
            <button type="button" disabled={saving} onClick={dismiss} className="min-h-11 rounded-lg border border-control px-4 font-semibold hover:bg-todo-tint disabled:opacity-60">
              Cancel
            </button>
            {missing ? (
              <button type="button" onClick={refresh} className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover">
                Refresh Board
              </button>
            ) : (
              <button type="submit" disabled={saving} className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover disabled:opacity-80">
                {task ? (saving ? 'Saving…' : 'Save Changes') : (saving ? 'Creating…' : 'Create Task')}
              </button>
            )}
            <span ref={progressRef} role="status" tabIndex={-1} className="sr-only">{saving ? (task ? 'Saving changes…' : 'Creating task…') : ''}</span>
          </div>
        </form>
      </div>
    </dialog>
  )
}
