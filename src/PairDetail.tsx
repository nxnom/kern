import { GHOST_INK, RULE, drawPair } from './kern/font'
import type { LoadedFont } from './kern/font'
import { IconClose } from './Icons'
import { typicalRange } from './kern/pairs'
import type { PairState } from './kern/state'

/**
 * The pair you picked, docked at the foot of the page.
 *
 * Three columns — the font's own drawing, the current one, then the controls
 * in rows beside them. Every row keeps its height whether or not it has
 * anything in it: the links come and go as values change, and when they moved
 * the buttons a click aimed at one landed on another.
 */
export function PairDetail({
  loaded,
  pair,
  shade,
  onNudge,
  onClose,
}: {
  loaded: LoadedFont
  pair: PairState
  shade: boolean
  /** Human edits go through the same write path the agent uses. */
  onNudge: (value: number) => void
  onClose: () => void
}) {
  const range = typicalRange(pair.left, pair.right, loaded.unitsPerEm)
  const changed = pair.kern !== pair.original
  // The last value the agent applied, so a hand edit can go back to its
  // proposal rather than only to the font's own value.
  const agentValue = [...pair.attempts]
    .reverse()
    .find((a) => a.by !== 'human' && !a.rejected)?.value

  const span = range.max - range.min || 1
  const at = (v: number) => Math.max(0, Math.min(100, ((v - range.min) / span) * 100))

  const render = (value: number, ghost: boolean) =>
    drawPair(loaded, pair.left, pair.right, value, 118, shade, {
      paper: 'transparent',
      baseline: RULE,
      ...(ghost ? { ink: GHOST_INK } : {}),
    })

  return (
    <section className="detail">
      <figure className={changed ? '' : 'same'}>
        <img src={render(pair.original, true)} alt="original" />
        <figcaption>original · {pair.original}</figcaption>
      </figure>

      <figure className={changed ? 'changed' : ''}>
        <img src={render(pair.kern, false)} alt={pair.key} />
        <figcaption>kerned · {pair.kern}</figcaption>
      </figure>

      <div className="detail-rows">
        <h3>
          {pair.key}
          <span className="muted">{range.pairClass}</span>
          <span className="muted">{pair.attempts.length} attempts</span>
        </h3>

        <div className="range">
          <div className="range-track">
            {pair.attempts
              .filter((a) => a.rejected)
              .map((a, i) => (
                <span
                  key={`r${i}`}
                  className="range-mark rejected"
                  style={{ left: `${at(a.value)}%` }}
                  title={`rejected: ${a.value}`}
                />
              ))}
            {changed && (
              <span
                className="range-mark original"
                style={{ left: `${at(pair.original)}%` }}
                title={`original: ${pair.original}`}
              />
            )}
            <span
              className="range-mark current"
              style={{ left: `${at(pair.kern)}%` }}
              title={`current: ${pair.kern}`}
            />
          </div>
          <div className="range-ends">
            <span>{range.min}</span>
            <span className="muted">typical for this shape</span>
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
            title="Arrow keys move by 10 with a tile selected, shift for 1"
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
        </div>

        {/* Reserved whether or not anything is in it. */}
        <div className="nudge-back">
          {agentValue !== undefined && agentValue !== pair.kern && (
            <button className="link" onClick={() => onNudge(agentValue)}>
              agent’s {agentValue}
            </button>
          )}
          {changed && (
            <button className="link" onClick={() => onNudge(pair.original)}>
              original {pair.original}
            </button>
          )}
        </div>
      </div>

      <button className="detail-close" onClick={onClose} aria-label="Close">
        <IconClose />
      </button>
    </section>
  )
}
