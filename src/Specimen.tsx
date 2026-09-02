import { useMemo } from 'react'
import type { LoadedFont } from './kern/font'
import { GHOST_INK, RULE, drawPair } from './kern/font'
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
  // Only the pairs in this line that actually moved, in reading order,
  // without repeats.
  const chars = useMemo(() => [...word], [word])
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

  // Underlining every gap says nothing. The mark only earns its place when it
  // separates the pairs that moved from the pairs that did not — which is true
  // of running text, and false of a line built purely from changed pairs.
  const distinct = new Set(
    chars.slice(0, -1).map((ch, i) => pairKey(ch, chars[i + 1])),
  ).size
  const markChanged = changed.length < distinct

  return (
    <div className="proof">
      <div className="proof-lines">
        <Line loaded={loaded} chars={chars} pairs={pairs} which="original" />
        <Line
          loaded={loaded}
          chars={chars}
          pairs={pairs}
          which="kern"
          markChanged={markChanged}
        />
      </div>

      {changed.length === 0 ? (
        <p className="muted">
          None of the pairs in this line have been changed yet.
        </p>
      ) : (
        <>
          <h3>
            {changed.length} pair{changed.length === 1 ? '' : 's'} changed
          </h3>
          <div className="proof-strip">
            {changed.map((p) => (
              <figure key={p.key}>
                <div className="ba">
                  <img
                    src={drawPair(loaded, p.left, p.right, p.original, 96, shade, {
                      paper: 'transparent',
                      ink: GHOST_INK,
                      baseline: RULE,
                    })}
                    alt={`${p.key} as shipped`}
                  />
                  <img
                    className="after"
                    src={drawPair(loaded, p.left, p.right, p.kern, 96, shade, {
                      paper: 'transparent',
                      baseline: RULE,
                    })}
                    alt={`${p.key} kerned`}
                  />
                </div>
                <figcaption>
                  <b>{p.key}</b>
                  <span>
                    {p.original} <i>→</i> {p.kern}
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
  markChanged = false,
}: {
  loaded: LoadedFont
  chars: string[]
  pairs: Map<string, PairState>
  which: 'original' | 'kern'
  markChanged?: boolean
}) {
  return (
    <div className={`proof-line ${which}`}>
      <span className="proof-tag">{which === 'original' ? 'original' : 'kerned'}</span>
      <span className="proof-text">
        {chars.map((ch, i) => {
          const next = chars[i + 1]
          const state = next ? pairs.get(pairKey(ch, next)) : undefined
          const moved =
            markChanged && which === 'kern' && state && state.kern !== state.original
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
