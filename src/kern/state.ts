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
  /** The font's own value, kept so we can show the change. */
  original: number
  kern: number
  status: PairStatus
  /** Every value tried, in order, so the panel can show how it converged. */
  attempts: Attempt[]
  note?: string
  touchedAt?: number
}

export function initialPairs(lf: LoadedFont): Map<string, PairState> {
  const map = new Map<string, PairState>()
  for (const [left, right] of PRIORITY_PAIRS) {
    const original = existingKern(lf, left, right)
    map.set(`${left}${right}`, {
      key: `${left}${right}`,
      left,
      right,
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
