import { useEffect, useMemo, useRef, useState } from 'react'
import type { LoadedFont } from './kern/font'
import { drawPair } from './kern/font'
import type { PairState } from './kern/state'

interface Props {
  loaded: LoadedFont
  pairs: PairState[]
  activeKeys: string[]
  onSelect: (key: string) => void
  shade: boolean
}

export function PairGrid({ loaded, pairs, activeKeys, onSelect, shade }: Props) {
  const active = new Set(activeKeys)
  const lead = activeKeys[0]
  return (
    <div className="grid">
      {pairs.map((p) => (
        <PairTile
          key={p.key}
          loaded={loaded}
          pair={p}
          active={active.has(p.key)}
          lead={p.key === lead}
          onSelect={onSelect}
          shade={shade}
        />
      ))}
    </div>
  )
}

function PairTile({
  loaded,
  pair,
  active,
  lead,
  onSelect,
  shade,
}: {
  loaded: LoadedFont
  pair: PairState
  active: boolean
  lead: boolean
  onSelect: (key: string) => void
  shade: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [hovering, setHovering] = useState(false)
  const wasChanged = pair.kern !== pair.original
  // Hovering a changed tile shows what it looked like before.
  const value = hovering && wasChanged ? pair.original : pair.kern

  // Redraw only when the value that affects the picture changes.
  const src = useMemo(
    () => drawPair(loaded, pair.left, pair.right, value, 88, shade),
    [loaded, pair.left, pair.right, value, shade],
  )

  // Keep the pair the agent is working on in view.
  // Only the first of a batch scrolls, or sixteen tiles fight over the viewport.
  useEffect(() => {
    if (lead) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [lead])

  const delta = pair.kern - pair.original

  return (
    <button
      ref={ref}
      className={`tile ${pair.status} ${active ? 'active' : ''} ${lead ? 'lead' : ''}`}
      onClick={() => onSelect(pair.key)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      title={`${pair.key} · ${pair.attempts.length} attempts`}
    >
      <span className="tile-img">{src && <img src={src} alt={pair.key} />}</span>
      <span className="tile-meta">
        <span className="tile-name">{pair.key}</span>
        {/* The label reuses the delta slot so hovering never shifts the layout. */}
        {delta !== 0 && (
          <span className={`tile-delta ${hovering ? 'is-before' : ''}`}>
            {hovering ? 'before' : `${delta > 0 ? '+' : ''}${delta}`}
          </span>
        )}
      </span>
      {pair.attempts.length > 1 && (
        <span className="tile-iters">{pair.attempts.length}×</span>
      )}
    </button>
  )
}
