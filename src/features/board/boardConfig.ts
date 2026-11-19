import type { TaskStatus } from '../../types/task'

export type ColumnColor = 'todo' | 'progress' | 'review' | 'done'

export const boardColumns = {
  todo: {
    status: 'todo',
    title: 'To Do',
    description: 'Ready to get started',
    color: 'todo',
  },
  in_progress: {
    status: 'in_progress',
    title: 'In Progress',
    description: 'Work currently underway',
    color: 'progress',
  },
  in_review: {
    status: 'in_review',
    title: 'In Review',
    description: 'Waiting for review',
    color: 'review',
  },
  done: {
    status: 'done',
    title: 'Done',
    description: 'Completed work',
    color: 'done',
  },
} satisfies {
  [Status in TaskStatus]: {
    status: Status
    title: string
    description: string
    color: ColumnColor
  }
}
