import type { ReactNode } from 'react'

/**
 * A titled band with its label in the left margin.
 *
 * Technical drawings annotate in the margin rather than putting a heading on
 * top of every block. It gives the page a spine, so the survey, the selected
 * pair and the proof read as separate work instead of one continuous strip.
 */
export function Section({
  label,
  meta,
  children,
}: {
  label: string
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="band">
      <div className="band-label">
        <h2>{label}</h2>
        {meta && <p>{meta}</p>}
      </div>
      <div className="band-body">{children}</div>
    </section>
  )
}
