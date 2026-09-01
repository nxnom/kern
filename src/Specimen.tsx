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
  size = 44,
  showBefore,
}: {
  loaded: LoadedFont
  word: string
  pairs: Map<string, PairState>
  size?: number
  /** The before line is noise until the agent has actually changed something. */
  showBefore: boolean
}) {
  return (
    <div className="specimen-pair">
      {showBefore && (
        <Line loaded={loaded} word={word} pairs={pairs} size={size} which="original" />
      )}
      <Line loaded={loaded} word={word} pairs={pairs} size={size} which="kern" showTag={showBefore} />
    </div>
  )
}

function Line({
  loaded,
  word,
  pairs,
  size,
  which,
  showTag = true,
}: {
  loaded: LoadedFont
  word: string
  pairs: Map<string, PairState>
  size: number
  which: 'original' | 'kern'
  showTag?: boolean
}) {
  const chars = [...word]
  return (
    <div className={`word ${which}`} style={{ fontSize: size }}>
      {showTag && (
        <span className="word-tag">{which === 'original' ? 'before' : 'after'}</span>
      )}
      {chars.map((ch, i) => {
        const next = chars[i + 1]
        const state = next ? pairs.get(pairKey(ch, next)) : undefined
        const k = state ? state[which] : 0
        const changed =
          which === 'kern' && state !== undefined && state.kern !== state.original
        const shift = state ? state.kern - state.original : 0
        return (
          <span
            key={`${ch}-${i}`}
            className={changed ? 'changed' : undefined}
            style={{ marginRight: `${(k / loaded.unitsPerEm) * size}px` }}
            title={changed ? `${state!.key} moved ${shift}` : undefined}
          >
            {ch}
          </span>
        )
      })}
    </div>
  )
}
