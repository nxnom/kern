import type { ReactNode } from 'react'

export function Toggle({
  on,
  onChange,
  icon,
  children,
}: {
  on: boolean
  onChange: (next: boolean) => void
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <button
      className={`toggle ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      {icon}
      <span>{children}</span>
      <span className="track"><span className="knob" /></span>
    </button>
  )
}
