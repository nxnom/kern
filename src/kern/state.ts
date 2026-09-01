import type { LoadedFont } from './font'
import { existingKern } from './font'
import { PRIORITY_PAIRS } from './pairs'

export type PairStatus =
  | 'untouched'   // still at the font's original value
  | 'examining'   // the agent is looking at it right now
  | 'adjusted'    // the agent changed it
  | 'rejected'    // the agent's last proposal was out of range
  | 'overridden'  // the human changed it after the agent

export interface Attempt {
  value: number
  rejected: boolean
  at: number
}

export interface PairState {
  key: string
  left: string
  right: string
  /**
   * What the font shipped. Held separately from `original` so the kerning can
   * be stripped for a benchmark run while the designer's answer survives to
   * score against.
   */
  reference: number
  /** The starting value for this session — zero when kerning was stripped. */
  original: number
  kern: number
  status: PairStatus
  /** Every value tried, in order, so the panel can show how it converged. */
  attempts: Attempt[]
  note?: string
  touchedAt?: number
}

export function initialPairs(lf: LoadedFont, strip = false): Map<string, PairState> {
  const map = new Map<string, PairState>()
  for (const [left, right] of PRIORITY_PAIRS) {
    const reference = existingKern(lf, left, right)
    const original = strip ? 0 : reference
    map.set(`${left}${right}`, {
      key: `${left}${right}`,
      left,
      right,
      reference,
      original,
      kern: original,
      status: 'untouched',
      attempts: [],
    })
  }
  return map
}

export function pairKey(left: string, right: string) {
  return `${left}${right}`
}
