import type { Task } from '../../types/task'

const mockOwner = {
  user_id: '00000000-0000-4000-8000-000000000001',
  created_at: '2026-11-13T15:00:00Z',
}

export const mockTasks: Task[] = [
  {
    ...mockOwner,
    id: '00000000-0000-4000-8000-000000000101',
    title: 'Set up guest authentication',
    description: 'Restore an existing guest session before attempting anonymous sign-in.',
    status: 'todo',
    priority: 'high',
    due_date: '2026-11-20',
  },
  {
    ...mockOwner,
    id: '00000000-0000-4000-8000-000000000102',
    title: 'Prepare deployment',
    description: null,
    status: 'todo',
    priority: 'low',
    due_date: null,
  },
  {
    ...mockOwner,
    id: '00000000-0000-4000-8000-000000000103',
    title: 'Implement task filtering',
    description: 'Add title search and priority filters.',
    status: 'in_progress',
    priority: 'normal',
    due_date: '2026-11-21',
  },
  {
    ...mockOwner,
    id: '00000000-0000-4000-8000-000000000104',
    title: 'Review the responsive board layout on narrow screens',
    description: 'Check that long task titles wrap, date labels remain visible, and keyboard users can reach every column. Repeat at phone and tablet widths.',
    status: 'in_review',
    priority: 'normal',
    due_date: null,
  },
  {
    ...mockOwner,
    id: '00000000-0000-4000-8000-000000000105',
    title: 'Define board status labels',
    description: 'Match the four workflow stages to the shared status identifiers.',
    status: 'done',
    priority: 'low',
    due_date: null,
  },
]
