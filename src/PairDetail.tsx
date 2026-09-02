import { GHOST_INK, RULE, drawPair } from './kern/font'
import type { LoadedFont } from './kern/font'
import { typicalRange } from './kern/pairs'
import type { PairState } from './kern/state'

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
  const span = range.max - range.min || 1
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - range.min) / span) * 100))

  return (
    <section className="detail">
      <div className="detail-renders">
        {changed && (
          <figure>
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
        )}
        <figure className={changed ? 'changed' : ''}>
          <img
            src={drawPair(loaded, pair.left, pair.right, pair.kern, 130, shade, {
              paper: 'transparent',
              baseline: RULE,
            })}
            alt={pair.key}
          />
          <figcaption>{changed ? `kerned · ${pair.kern}` : `${pair.key} · ${pair.kern}`}</figcaption>
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
          {pair.kern !== pair.original && (
            <button className="link" onClick={() => onNudge(pair.original)}>
              back to {pair.original}
            </button>
          )}
          <span className="muted">or ← → with a tile selected</span>
        </div>

        {pair.attempts.length > 0 ? (
          <ol className="trail">
            {pair.attempts.map((a, i) => (
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
