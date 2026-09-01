import { drawPair } from './kern/font'
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
}: {
  loaded: LoadedFont
  pair: PairState
  shade: boolean
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
            <img src={drawPair(loaded, pair.left, pair.right, pair.original, 130, shade)} alt="before" />
            <figcaption>before · {pair.original}</figcaption>
          </figure>
        )}
        <figure className={changed ? 'changed' : ''}>
          <img src={drawPair(loaded, pair.left, pair.right, pair.kern, 130, shade)} alt={pair.key} />
          <figcaption>{changed ? `after · ${pair.kern}` : `${pair.key} · ${pair.kern}`}</figcaption>
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

        {pair.attempts.length > 0 ? (
          <ol className="trail">
            {pair.attempts.map((a, i) => (
              <li key={a.at + i} className={a.rejected ? 'rejected' : ''}>
                {a.value}
                {a.rejected && <span className="x">rejected</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">The agent has not touched this pair yet.</p>
        )}
      </div>
    </section>
  )
}
