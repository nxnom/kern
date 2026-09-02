import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevron } from './Icons'

export interface DockTab {
  id: string
  label: string
  /** Shown as a pill after the label — a count, or a pair name. */
  badge?: ReactNode
  content: ReactNode
}

/**
 * One dock for everything that reports on the grid.
 *
 * Selected, Proof and the tool log were three bands stacked above and below a
 * grid that is now hundreds of tiles long, so reading any of them meant losing
 * your place in the others. Tabs put them in one place at a fixed height, and
 * leave the grid as the only thing that scrolls.
 */
export function Dock({
  tabs,
  open,
  onOpenChange,
}: {
  tabs: DockTab[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [active, setActive] = useState(tabs[0]?.id)

  // Follow the work: if the tab you were on disappears, fall back rather than
  // showing an empty dock.
  useEffect(() => {
    if (!tabs.some((t) => t.id === active)) setActive(tabs[0]?.id)
  }, [tabs, active])

  if (!tabs.length) return null
  const current = tabs.find((t) => t.id === active) ?? tabs[0]

  return (
    <aside className={`dock ${open ? 'open' : ''}`}>
      <div className="dock-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={t.id === current.id ? 'on' : ''}
            onClick={() => {
              setActive(t.id)
              onOpenChange(true)
            }}
          >
            {t.label}
            {t.badge !== undefined && <b>{t.badge}</b>}
          </button>
        ))}
        <button
          className="dock-toggle"
          onClick={() => onOpenChange(!open)}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <IconChevron up={!open} />
        </button>
      </div>
      <div className="dock-body">{current.content}</div>
    </aside>
  )
}
