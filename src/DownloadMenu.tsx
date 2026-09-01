import { useEffect, useRef, useState } from 'react'
import { IconChevron, IconDownload } from './Icons'

export interface DownloadOption {
  label: string
  hint: string
  onSelect: () => void
}

/** One button, a menu of formats. */
export function DownloadMenu({
  options,
  disabled,
}: {
  options: DownloadOption[]
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="menu" ref={root}>
      <button
        className="menu-trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <IconDownload />
        Export
        <IconChevron up={open} size={14} />
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {options.map((o) => (
            <button
              key={o.label}
              role="menuitem"
              onClick={() => {
                o.onSelect()
                setOpen(false)
              }}
            >
              <b>{o.label}</b>
              <span className="muted">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
