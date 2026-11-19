export default function AuthFeedback({
  status,
  retry,
}: {
  status: 'initializing' | 'error'
  retry: () => void
}) {
  return (
    <div className="grid min-h-[18rem] place-items-center rounded-xl border bg-surface px-6 py-10 text-center">
      {status === 'initializing' ? (
        <div role="status" className="flex items-center gap-3 font-medium text-muted">
          <span
            aria-hidden="true"
            className="size-5 rounded-full border-2 border-accent/25 border-t-accent motion-safe:animate-spin"
          />
          Preparing your workspace…
        </div>
      ) : (
        <div className="space-y-4">
          <p role="alert" className="font-medium text-ink">
            Unable to connect to your workspace. Please try again.
          </p>
          <button
            type="button"
            onClick={retry}
            className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover active:bg-accent-active"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
