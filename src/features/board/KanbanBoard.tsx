import { DragDropProvider, DragOverlay, PointerSensor, type DragEndEvent } from '@dnd-kit/react'
import { taskStatuses, type Task, type TaskStatus } from '../../types/task'
import { boardColumns } from './boardConfig'
import KanbanColumn from './KanbanColumn'

interface KanbanBoardProps {
  tasks: Task[]
  filtered: boolean
  onEdit: (task: Task) => void
  onMove: (task: Task, status: TaskStatus) => void
  pendingMoves: ReadonlySet<string>
}

const sensors = [PointerSensor]

export default function KanbanBoard({ tasks, onEdit, onMove, pendingMoves, filtered }: KanbanBoardProps) {
  function handleDragEnd(event: DragEndEvent) {
    if (event.canceled || !(event.nativeEvent instanceof PointerEvent)) return
    const task = tasks.find(({ id }) => id === event.operation.source?.id)
    const { clientX, clientY } = event.nativeEvent
    // The default detector also considers shape overlap. Require the release point
    // to be in a visible column, including when releasing over one of its cards.
    const destination = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-drop-column]')
    const status = taskStatuses.find((value) => value === destination?.dataset.dropColumn)
    if (task && status && status !== task.status) onMove(task, status)
  }

  return (
    <DragDropProvider sensors={sensors} onDragEnd={handleDragEnd}>
      <section
        aria-label="Kanban board"
        tabIndex={0}
        className="relative overflow-x-auto rounded-xl pb-3 focus-visible:outline-offset-[-2px]"
      >
        <div className="grid grid-cols-[repeat(4,minmax(16rem,1fr))] gap-4 lg:gap-5">
          {Object.values(boardColumns).map((column) => (
            <KanbanColumn
              key={column.status}
              {...column}
              onEdit={onEdit}
              onMove={onMove}
              pendingMoves={pendingMoves}
              filtered={filtered}
              tasks={tasks.filter((task) => task.status === column.status)}
            />
          ))}
        </div>
      </section>
      <DragOverlay dropAnimation={null} className="pointer-events-none">
        {(source) => (
          <div aria-hidden="true" className="rounded-xl border border-accent bg-surface p-4 font-semibold wrap-anywhere shadow-lg">
            {tasks.find(({ id }) => id === source.id)?.title}
          </div>
        )}
      </DragOverlay>
    </DragDropProvider>
  )
}
