import { useLayoutEffect, useRef, useState } from 'react'
import type { LoadedFont } from './kern/font'
import type { PairState } from './kern/state'
import { pairKey } from './kern/state'

export type SpecimenMode = 'stacked' | 'overlay'

/**
 * The agent's proof line, drawn twice at the same size.
 *
 * Stacked lines hide the work: a typical correction is a few percent of the
 * line, which the eye cannot catch across a vertical gap. Overlay draws both
 * from one origin so the drift is unmissable, and the width delta puts a
 * number on it.
 */
export function Specimen({
  loaded,
  word,
  pairs,
  showBefore,
  mode,
}: {
  loaded: LoadedFont
  word: string
  pairs: Map<string, PairState>
  showBefore: boolean
  mode: SpecimenMode
}) {
  const beforeRef = useRef<HTMLDivElement>(null)
  const afterRef = useRef<HTMLDivElement>(null)
  const [delta, setDelta] = useState<{ px: number; pct: number } | null>(null)

  useLayoutEffect(() => {
    const b = beforeRef.current?.scrollWidth
    const a = afterRef.current?.scrollWidth
    if (!b || !a) return setDelta(null)
    setDelta({ px: Math.round(a - b), pct: ((a - b) / b) * 100 })
  }, [word, pairs, mode, loaded])

  const overlay = showBefore && mode === 'overlay'

  return (
    <div className={`specimen-pair ${overlay ? 'is-overlay' : ''}`}>
      {showBefore && (
        <Line
          ref={beforeRef}
          loaded={loaded}
          word={word}
          pairs={pairs}
          which="original"
          showTag={!overlay}
        />
      )}
      <Line
        ref={afterRef}
        loaded={loaded}
        word={word}
        pairs={pairs}
        which="kern"
        showTag={showBefore && !overlay}
      />
      {showBefore && delta && delta.px !== 0 && (
        <p className="specimen-delta">
          {delta.px < 0 ? 'Tightened' : 'Loosened'} by{' '}
          <b>{Math.abs(delta.px)}px</b> over this line —{' '}
          <b>{Math.abs(delta.pct).toFixed(1)}%</b> of its width.
        </p>
      )}
    </div>
  )
}

function Line({
  ref,
  loaded,
  word,
  pairs,
  which,
  showTag = true,
}: {
  ref?: React.Ref<HTMLDivElement>
  loaded: LoadedFont
  word: string
  pairs: Map<string, PairState>
  which: 'original' | 'kern'
  showTag?: boolean
}) {
  const chars = [...word]
  return (
    <div className={`word ${which}`}>
      {showTag && (
        <span className="word-tag">{which === 'original' ? 'before' : 'after'}</span>
      )}
      <div className="word-line" ref={ref}>
        {chars.map((ch, i) => {
          const next = chars[i + 1]
          const state = next ? pairs.get(pairKey(ch, next)) : undefined
          const k = state ? state[which] : 0
          const changed =
            which === 'kern' && state !== undefined && state.kern !== state.original
          return (
            <span
              key={`${ch}-${i}`}
              className={changed ? 'changed' : undefined}
              style={{ marginRight: `${k / loaded.unitsPerEm}em` }}
              title={changed ? `${state.key} moved ${state.kern - state.original}` : undefined}
            >
              {ch}
            </span>
          )
        })}
      </div>
    </div>
  )
}
