import { useEffect, useRef } from 'react'

/**
 * A confirm the page owns.
 *
 * `window.confirm` blocks the whole tab — including a tool call the agent may
 * be waiting on — and it renders as browser chrome that has nothing to do with
 * the rest of the page.
 */
export function Confirm({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector('button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onCancel])

  return (
    <div className="scrim" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        ref={dialog}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="dialog-actions">
          <button onClick={onCancel}>Keep it</button>
          <button className="danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
