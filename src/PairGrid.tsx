import { useEffect, useMemo, useRef } from 'react'
import type { LoadedFont } from './kern/font'
import { drawPair } from './kern/font'
import type { PairState } from './kern/state'

interface Props {
  loaded: LoadedFont
  pairs: PairState[]
  activeKeys: string[]
  onSelect: (key: string) => void
  /** Show every tile at its original value, for a straight comparison. */
  showOriginal: boolean
}

export function PairGrid({ loaded, pairs, activeKeys, onSelect, showOriginal }: Props) {
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
          showOriginal={showOriginal}
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
  showOriginal,
}: {
  loaded: LoadedFont
  pair: PairState
  active: boolean
  lead: boolean
  onSelect: (key: string) => void
  showOriginal: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const value = showOriginal ? pair.original : pair.kern

  // Redraw only when the value that affects the picture changes.
  const src = useMemo(
    () => drawPair(loaded, pair.left, pair.right, value, 88),
    [loaded, pair.left, pair.right, value],
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
      className={`tile ${pair.status} ${active ? 'active' : ''}`}
      onClick={() => onSelect(pair.key)}
      title={`${pair.key} · ${pair.attempts.length} attempts`}
    >
      <span className="tile-img">{src && <img src={src} alt={pair.key} />}</span>
      <span className="tile-meta">
        <span className="tile-name">{pair.key}</span>
        {delta !== 0 && (
          <span className="tile-delta">
            {delta > 0 ? '+' : ''}
            {delta}
          </span>
        )}
      </span>
      {pair.attempts.length > 1 && (
        <span className="tile-iters">{pair.attempts.length}×</span>
      )}
    </button>
  )
}
