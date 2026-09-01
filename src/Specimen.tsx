import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { LoadedFont } from './kern/font'
import type { PairState } from './kern/state'
import { pairKey } from './kern/state'

const BASE_SIZE = 46
const MIN_SIZE = 16

/**
 * The agent's proof line, drawn twice.
 *
 * Both lines are set at the same size, scaled down together until the wider of
 * the two fits. Sizing them independently would make the comparison a lie,
 * since the unkerned line is always wider.
 */
export function Specimen({
  loaded,
  word,
  pairs,
  showBefore,
}: {
  loaded: LoadedFont
  word: string
  pairs: Map<string, PairState>
  showBefore: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const widest = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(BASE_SIZE)

  const fit = useCallback(() => {
    const available = box.current?.clientWidth
    const line = widest.current
    if (!available || !line) return
    // Measure at the base size so the result never depends on the last fit.
    line.style.fontSize = `${BASE_SIZE}px`
    const natural = line.scrollWidth
    line.style.fontSize = ''
    if (!natural) return
    const scaled = Math.floor(BASE_SIZE * Math.min(1, available / natural))
    setSize(Math.max(MIN_SIZE, scaled))
  }, [])

  useLayoutEffect(() => {
    fit()
    const ro = new ResizeObserver(fit)
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [fit, word, pairs])

  return (
    <div className="specimen-pair" ref={box}>
      {showBefore && (
        <Line
          ref={widest}
          loaded={loaded}
          word={word}
          pairs={pairs}
          size={size}
          which="original"
        />
      )}
      <Line
        ref={showBefore ? undefined : widest}
        loaded={loaded}
        word={word}
        pairs={pairs}
        size={size}
        which="kern"
        showTag={showBefore}
      />
    </div>
  )
}

function Line({
  ref,
  loaded,
  word,
  pairs,
  size,
  which,
  showTag = true,
}: {
  ref?: React.Ref<HTMLDivElement>
  loaded: LoadedFont
  word: string
  pairs: Map<string, PairState>
  size: number
  which: 'original' | 'kern'
  showTag?: boolean
}) {
  const chars = [...word]
  return (
    <div className={`word ${which}`}>
      {showTag && (
        <span className="word-tag">{which === 'original' ? 'before' : 'after'}</span>
      )}
      <div className="word-line" ref={ref} style={{ fontSize: size }}>
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
              style={{ marginRight: `${(k / loaded.unitsPerEm) * size}px` }}
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
