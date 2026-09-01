import { useMemo } from 'react'
import type { LoadedFont } from './kern/font'
import { drawRhythm } from './kern/rhythm'
import type { PairState } from './kern/state'
import { pairKey } from './kern/state'

/**
 * Before and after, shown as rhythm rather than as text.
 *
 * Two lines of kerned and unkerned text look almost identical, because the
 * correction is a couple of percent of the width. What actually changes is the
 * evenness of the white between letters — so draw that: a bar under each gap,
 * and the coefficient of variation across them. Unkerned text is visibly
 * jagged; kerned text levels out.
 */
export function Specimen({
  loaded,
  word,
  pairs,
}: {
  loaded: LoadedFont
  word: string
  pairs: Map<string, PairState>
}) {
  const { before, after } = useMemo(() => {
    const at = (which: 'original' | 'kern') => (l: string, r: string) =>
      pairs.get(pairKey(l, r))?.[which] ?? 0
    return {
      before: drawRhythm(loaded, word, at('original'), '#c9c2b2'),
      after: drawRhythm(loaded, word, at('kern'), '#16150f'),
    }
  }, [loaded, word, pairs])

  const drop = before.evenness
    ? ((before.evenness - after.evenness) / before.evenness) * 100
    : 0

  return (
    <div className="rhythm">
      <Row
        tag="before"
        img={before.dataUrl}
        evenness={before.evenness}
        muted
      />
      <Row tag="after" img={after.dataUrl} evenness={after.evenness} />
      {Math.abs(drop) > 0.5 && (
        <p className="rhythm-note">
          {drop > 0 ? (
            <>
              The gaps are <b>{drop.toFixed(0)}% more even</b> than the font shipped.
              Each bar is the white trapped in one gap; kerning levels them.
            </>
          ) : (
            <>
              The gaps are <b>{Math.abs(drop).toFixed(0)}% less even</b> than the font
              shipped — worth a second look.
            </>
          )}
        </p>
      )}
    </div>
  )
}

function Row({
  tag,
  img,
  evenness,
  muted,
}: {
  tag: string
  img: string
  evenness: number
  muted?: boolean
}) {
  return (
    <div className={`rhythm-row ${muted ? 'muted-row' : ''}`}>
      <span className="rhythm-tag">
        {tag}
        <b>{(evenness * 100).toFixed(0)}%</b>
        <em>uneven</em>
      </span>
      <div className="rhythm-img">
        <img src={img} alt={`${tag} rhythm`} />
      </div>
    </div>
  )
}
