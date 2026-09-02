import type { ReactNode } from 'react'

export interface Tab {
  id: string
  label: string
  /** A count or a name, shown as a pill after the label. */
  badge?: ReactNode
  disabled?: boolean
}

/**
 * The page's top-level views.
 *
 * The grid runs to hundreds of tiles, so anything else on the same scroll —
 * the proof, the log, the pair you picked — was either far above or far below
 * wherever you happened to be working.
 */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <nav className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          disabled={t.disabled}
          className={t.id === active ? 'on' : ''}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.badge !== undefined && <b>{t.badge}</b>}
        </button>
      ))}
    </nav>
  )
}
