import { useMemo } from 'react'
import type { LoadedFont } from './kern/font'
import { drawWord } from './kern/font'
import type { PairState } from './kern/state'
import { pairKey } from './kern/state'

/**
 * "Kern", set in the font currently loaded, at its current kerning.
 *
 * The masthead is the product demonstrating itself: change the font and the
 * name changes with it; kern a pair the name contains and the name re-spaces.
 */
export function Wordmark({
  loaded,
  pairs,
}: {
  loaded: LoadedFont | null
  pairs: Map<string, PairState>
}) {
  const mark = useMemo(() => {
    if (!loaded) return null
    return drawWord(loaded, 'Kern', 46, (l, r) => pairs.get(pairKey(l, r))?.kern ?? 0)
  }, [loaded, pairs])

  // Before the font arrives, the name still has to be readable.
  if (!mark) return <span className="wordmark-fallback">Kern</span>

  return (
    <img
      className="wordmark"
      src={mark.dataUrl}
      alt="Kern"
      style={{ width: mark.width, height: mark.height }}
    />
  )
}
