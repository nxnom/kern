import { GHOST_INK, RULE, drawPair } from './kern/font'
import type { LoadedFont } from './kern/font'
import { typicalRange } from './kern/pairs'
import type { PairState } from './kern/state'

/** How many attempts to show before summarising the rest. */
const TRAIL_LIMIT = 10

/**
 * What the agent did to one pair.
 *
 * The grid shows the result; this shows the reasoning — which values were
 * tried, which the guard rail turned away, and where the final value sits
 * inside the plausible range for the pair's shape class.
 */
export function PairDetail({
  loaded,
  pair,
  shade,
  onNudge,
}: {
  loaded: LoadedFont
  pair: PairState
  shade: boolean
  /** Human edits go through the same write path the agent uses. */
  onNudge: (value: number) => void
}) {
  const range = typicalRange(pair.left, pair.right, loaded.unitsPerEm)
  const changed = pair.kern !== pair.original
  // The last value the agent actually applied, so a hand edit can be undone
  // back to its proposal rather than only all the way to the font's own value.
  const agentValue = [...pair.attempts]
    .reverse()
    .find((a) => a.by !== 'human' && !a.rejected)?.value
  const span = range.max - range.min || 1
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - range.min) / span) * 100))

  return (
    <section className="detail">
      {/* Both are always drawn. Dropping the original when a value returned to
          it moved everything left, and a click aimed at one control landed on
          another. */}
      <div className="detail-renders">
        <figure className={changed ? '' : 'same'}>
            <img
              src={drawPair(loaded, pair.left, pair.right, pair.original, 130, shade, {
                paper: 'transparent',
                ink: GHOST_INK,
                baseline: RULE,
              })}
              alt="original"
            />
          <figcaption>original · {pair.original}</figcaption>
        </figure>
        <figure className={changed ? 'changed' : ''}>
          <img
            src={drawPair(loaded, pair.left, pair.right, pair.kern, 130, shade, {
              paper: 'transparent',
              baseline: RULE,
            })}
            alt={pair.key}
          />
          <figcaption>kerned · {pair.kern}</figcaption>
        </figure>
      </div>

      <div className="detail-body">
        <h3>
          {pair.key} <span className="muted">{range.pairClass}</span>
        </h3>

        <div className="range">
          <div className="range-track">
            {/* Rejected values sit outside the band, which is the point. */}
            {pair.attempts
              .filter((a) => a.rejected)
              .map((a, i) => (
                <span
                  key={`r${i}`}
                  className="range-mark rejected"
                  style={{ left: `${pos(a.value)}%` }}
                  title={`rejected: ${a.value}`}
                />
              ))}
            {changed && (
              <span
                className="range-mark original"
                style={{ left: `${pos(pair.original)}%` }}
                title={`original: ${pair.original}`}
              />
            )}
            <span
              className="range-mark current"
              style={{ left: `${pos(pair.kern)}%` }}
              title={`current: ${pair.kern}`}
            />
          </div>
          <div className="range-ends">
            <span>{range.min}</span>
            <span className="muted">typical range for this shape</span>
            <span>{range.max}</span>
          </div>
        </div>

        <div className="nudge">
          <button onClick={() => onNudge(pair.kern - 10)} title="Tighten by 10">
            −10
          </button>
          <button onClick={() => onNudge(pair.kern - 1)} title="Tighten by 1">
            −1
          </button>
          <input
            type="number"
            value={pair.kern}
            aria-label={`Kerning for ${pair.key}, in font units`}
            onChange={(e) => {
              const next = Number(e.target.value)
              if (Number.isFinite(next)) onNudge(Math.round(next))
            }}
          />
          <button onClick={() => onNudge(pair.kern + 1)} title="Loosen by 1">
            +1
          </button>
          <button onClick={() => onNudge(pair.kern + 10)} title="Loosen by 10">
            +10
          </button>
          {agentValue !== undefined && agentValue !== pair.kern && (
            <button
              className="link"
              onClick={() => onNudge(agentValue)}
              title="Put back the value the agent applied"
            >
              agent’s {agentValue}
            </button>
          )}
          {changed && (
            <button
              className="link"
              onClick={() => onNudge(pair.original)}
              title="Put back the value the font shipped with"
            >
              original {pair.original}
            </button>
          )}
          <span className="muted">or ← → with a tile selected</span>
        </div>

        {pair.attempts.length > 0 ? (
          <ol className="trail">
            {/* Only the recent tail is worth reading; the rest is noise. */}
            {pair.attempts.length > TRAIL_LIMIT && (
              <li className="earlier">
                +{pair.attempts.length - TRAIL_LIMIT} earlier
              </li>
            )}
            {pair.attempts.slice(-TRAIL_LIMIT).map((a, i) => (
              <li
                key={a.at + i}
                className={`${a.rejected ? 'rejected' : ''} ${a.by === 'human' ? 'mine' : ''}`}
                title={a.by === 'human' ? 'you set this' : 'the agent set this'}
              >
                {a.value}
                {a.rejected && <span className="x">rejected</span>}
                {a.by === 'human' && !a.rejected && <span className="x">you</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">
            Still at the value the font shipped. Nothing has been applied here.
          </p>
        )}
      </div>
    </section>
  )
}
