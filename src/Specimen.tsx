import { useMemo } from 'react'
import type { LoadedFont } from './kern/font'
import { drawPair } from './kern/font'
import type { PairState } from './kern/state'
import { pairKey } from './kern/state'

/**
 * The proof: every pair the agent changed, drawn before and after.
 *
 * Whole lines of kerned and unkerned text look identical, because a correction
 * is a couple of percent of the width. At pair scale the same correction is
 * obvious. So show the pairs, and let the strip scroll rather than shrinking
 * anything to fit.
 */
export function Specimen({
  loaded,
  word,
  pairs,
  shade,
}: {
  loaded: LoadedFont
  word: string
  pairs: Map<string, PairState>
  shade: boolean
}) {
  const chars = [...word]

  // Only the pairs in this line that actually moved, in reading order,
  // without repeats.
  const changed = useMemo(() => {
    const seen = new Set<string>()
    const out: PairState[] = []
    for (let i = 0; i < chars.length - 1; i++) {
      const state = pairs.get(pairKey(chars[i], chars[i + 1]))
      if (!state || state.kern === state.original || seen.has(state.key)) continue
      seen.add(state.key)
      out.push(state)
    }
    return out
  }, [chars, pairs])

  return (
    <div className="proof">
      <div className="proof-lines">
        <Line loaded={loaded} chars={chars} pairs={pairs} which="original" />
        <Line loaded={loaded} chars={chars} pairs={pairs} which="kern" />
      </div>

      {changed.length === 0 ? (
        <p className="muted">
          None of the pairs in this line have been changed yet.
        </p>
      ) : (
        <>
          <h3>
            {changed.length} pair{changed.length === 1 ? '' : 's'} changed in this line
          </h3>
          <div className="proof-strip">
            {changed.map((p) => (
              <figure key={p.key}>
                <div className="ba">
                  <img
                    src={drawPair(loaded, p.left, p.right, p.original, 74, shade)}
                    alt={`${p.key} before`}
                  />
                  <img
                    className="after"
                    src={drawPair(loaded, p.left, p.right, p.kern, 74, shade)}
                    alt={`${p.key} after`}
                  />
                </div>
                <figcaption>
                  <b>{p.key}</b>
                  <span>
                    {p.original} → {p.kern}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Line({
  loaded,
  chars,
  pairs,
  which,
}: {
  loaded: LoadedFont
  chars: string[]
  pairs: Map<string, PairState>
  which: 'original' | 'kern'
}) {
  return (
    <div className={`proof-line ${which}`}>
      <span className="proof-tag">{which === 'original' ? 'before' : 'after'}</span>
      <span className="proof-text">
        {chars.map((ch, i) => {
          const next = chars[i + 1]
          const state = next ? pairs.get(pairKey(ch, next)) : undefined
          const moved = which === 'kern' && state && state.kern !== state.original
          return (
            <span
              key={`${ch}-${i}`}
              className={moved ? 'changed' : undefined}
              style={{ marginRight: `${(state?.[which] ?? 0) / loaded.unitsPerEm}em` }}
              title={moved ? `${state.key} moved ${state.kern - state.original}` : undefined}
            >
              {ch}
            </span>
          )
        })}
      </span>
    </div>
  )
}
