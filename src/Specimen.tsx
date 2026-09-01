import type { LoadedFont } from './kern/font'
import type { PairState } from './kern/state'
import { pairKey } from './kern/state'

/**
 * Specimen text drawn twice: once at the font's own values, once at whatever
 * the agent has settled on. Seeing the two stacked is the only honest way to
 * judge kerning.
 */
export function Specimen({
  loaded,
  word,
  pairs,
  size = 38,
}: {
  loaded: LoadedFont
  word: string
  pairs: Map<string, PairState>
  size?: number
}) {
  return (
    <div className="specimen-pair">
      <Line loaded={loaded} word={word} pairs={pairs} size={size} which="original" />
      <Line loaded={loaded} word={word} pairs={pairs} size={size} which="kern" />
    </div>
  )
}

function Line({
  loaded,
  word,
  pairs,
  size,
  which,
}: {
  loaded: LoadedFont
  word: string
  pairs: Map<string, PairState>
  size: number
  which: 'original' | 'kern'
}) {
  const chars = [...word]
  return (
    <div className={`word ${which}`} style={{ fontSize: size }}>
      <span className="word-tag">{which === 'original' ? 'before' : 'after'}</span>
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
          >
            {ch}
          </span>
        )
      })}
    </div>
  )
}
