import type { LoadedFont } from './kern/font'
import type { PairState } from './kern/state'
import { pairKey } from './kern/state'

/** Big enough to judge spacing by eye. Long text wraps rather than shrinking. */
const SIZE = 40

/**
 * The agent's proof line, drawn twice at the same size.
 *
 * Both lines must share a size or the comparison lies: the unkerned line is
 * always wider, so fitting each to the box independently would render "before"
 * smaller and flatter the kerning.
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
  return (
    <div className="specimen-pair">
      {showBefore && (
        <Line loaded={loaded} word={word} pairs={pairs} which="original" />
      )}
      <Line
        loaded={loaded}
        word={word}
        pairs={pairs}
        which="kern"
        showTag={showBefore}
      />
    </div>
  )
}

function Line({
  loaded,
  word,
  pairs,
  which,
  showTag = true,
}: {
  loaded: LoadedFont
  word: string
  pairs: Map<string, PairState>
  which: 'original' | 'kern'
  showTag?: boolean
}) {
  const chars = [...word]
  return (
    <div className="word">
      {showTag && (
        <span className="word-tag">{which === 'original' ? 'before' : 'after'}</span>
      )}
      <div className="word-line" style={{ fontSize: SIZE }}>
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
              style={{ marginRight: `${(k / loaded.unitsPerEm) * SIZE}px` }}
              title={changed ? `${state.key} moved ${state.kern - state.original}` : undefined}
            >
              {ch === ' ' ? ' ' : ch}
            </span>
          )
        })}
      </div>
    </div>
  )
}
