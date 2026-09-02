import { useEffect, useMemo, useRef, useState } from 'react'
import type { LoadedFont } from './kern/font'
import { RULE, drawPair } from './kern/font'
import type { PairState } from './kern/state'

interface Props {
  loaded: LoadedFont
  pairs: PairState[]
  activeKeys: string[]
  /** The tile the arrow keys will edit, so it has to be visible. */
  selectedKey: string
  onSelect: (key: string) => void
  shade: boolean
}

export function PairGrid({ loaded, pairs, activeKeys, selectedKey, onSelect, shade }: Props) {
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
          selected={p.key === selectedKey}
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
  selected,
  onSelect,
  shade,
}: {
  loaded: LoadedFont
  pair: PairState
  active: boolean
  lead: boolean
  selected: boolean
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
    () =>
      drawPair(loaded, pair.left, pair.right, value, 88, shade, {
        paper: 'transparent',
        baseline: RULE,
      }),
    [loaded, pair.left, pair.right, value, shade],
  )

  // Keep the pair the agent is working on in view.
  // Only the first of a batch scrolls, or sixteen tiles fight over the viewport.
  // `nearest` was leaving tiles under the fixed log drawer, or judging a tile
  // "visible" when only a sliver of it was, so centre it and only when it is
  // genuinely off screen.
  useEffect(() => {
    if (!lead) return
    const el = ref.current
    if (!el) return
    const box = el.getBoundingClientRect()
    const DRAWER_H = 56
    const fullyVisible = box.top >= 0 && box.bottom <= window.innerHeight - DRAWER_H
    if (!fullyVisible) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [lead])


  return (
    <button
      ref={ref}
      className={`tile ${pair.status} ${selected ? 'selected' : ''} ${active ? 'active' : ''}`}
      onClick={() => onSelect(pair.key)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      title={`${pair.key} · ${pair.attempts.length} attempts`}
    >
      <span className="tile-img">{src && <img src={src} alt={pair.key} />}</span>
      <span className="tile-meta">
        <span className="tile-name">{pair.key}</span>
        {/* Always the value, never a word: the number is the thing that moves
            when you hold an arrow key, so hiding it behind a label made the
            edit look like it had not happened. */}
        <span className={`tile-delta ${hovering && wasChanged ? 'is-original' : ''}`}>
          {value}
        </span>
      </span>
      {pair.attempts.length > 1 && (
        <span className="tile-iters">{pair.attempts.length}×</span>
      )}
    </button>
  )
}
