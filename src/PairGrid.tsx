import { useEffect, useMemo, useRef } from 'react'
import type { LoadedFont } from './kern/font'
import { drawPair } from './kern/font'
import type { PairState } from './kern/state'

interface Props {
  loaded: LoadedFont
  pairs: PairState[]
  activeKey: string | null
  onSelect: (key: string) => void
}

export function PairGrid({ loaded, pairs, activeKey, onSelect }: Props) {
  return (
    <div className="grid">
      {pairs.map((p) => (
        <PairTile
          key={p.key}
          loaded={loaded}
          pair={p}
          active={p.key === activeKey}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function PairTile({
  loaded,
  pair,
  active,
  onSelect,
}: {
  loaded: LoadedFont
  pair: PairState
  active: boolean
  onSelect: (key: string) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)

  // Redraw only when the value that affects the picture changes.
  const src = useMemo(
    () => drawPair(loaded, pair.left, pair.right, pair.kern, 88),
    [loaded, pair.left, pair.right, pair.kern],
  )

  // Keep the pair the agent is working on in view.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

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
