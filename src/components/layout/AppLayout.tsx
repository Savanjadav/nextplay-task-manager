import { Menu } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'

export default function AppLayout({ children, onNewTask, taskControls }: { children: ReactNode; onNewTask?: () => void; taskControls?: ReactNode }) {
  const drawerRef = useRef<HTMLDialogElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 64rem)')
    function closeOnDesktop() {
      if (desktop.matches) drawerRef.current?.close()
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  function openDrawer() {
    drawerRef.current?.showModal()
    setIsDrawerOpen(true)
  }

  function closeDrawer() {
    drawerRef.current?.close()
  }

  function restoreMenuFocus() {
    setIsDrawerOpen(false)
    menuButtonRef.current?.focus()
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 border-r lg:block">
        <Sidebar />
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex h-16 items-center gap-3 border-b bg-surface px-4 md:px-6 lg:hidden">
          <button
            ref={menuButtonRef}
            type="button"
            aria-label="Open navigation"
            aria-expanded={isDrawerOpen}
            aria-controls="workspace-drawer"
            aria-haspopup="dialog"
            onClick={openDrawer}
            className="grid size-11 place-items-center rounded-lg border bg-surface text-ink hover:bg-todo-tint"
          >
            <Menu aria-hidden="true" size={20} />
          </button>
          <span className="font-semibold tracking-tight">Next Play</span>
        </div>

        <Header onNewTask={onNewTask} taskControls={taskControls} />
        <main tabIndex={-1} className="px-4 py-6 md:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>

      <dialog
        ref={drawerRef}
        id="workspace-drawer"
        aria-label="Workspace navigation"
        onClose={restoreMenuFocus}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDrawer()
        }}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-60 max-w-[calc(100%-3rem)] bg-surface text-ink shadow-lg backdrop:bg-ink/35"
      >
        <Sidebar onClose={closeDrawer} />
      </dialog>
    </div>
  )
}
