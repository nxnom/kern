import type { LoadedFont } from './font'
import { existingKern } from './font'
import { buildPairList } from './pairs'

/**
 * Derived from the value, never from who set it. Storing "the human changed
 * this" meant a reload — which only knows the numbers — turned a grey tile
 * green, and a value nudged back to the original stayed marked as changed.
 * Who set it lives on the attempts, where it survives a reload intact.
 */
export type PairStatus =
  | 'untouched'  // sits at the value the font shipped
  | 'adjusted'   // differs from the font
  | 'rejected'   // the last proposal was refused as out of range

export interface Attempt {
  value: number
  rejected: boolean
  at: number
  /** Who set it. The trail is only useful if it says whose decision it was. */
  by?: 'agent' | 'human'
  /**
   * Where a run of hand edits began. Consecutive nudges collapse into one
   * attempt, so without this the record would say where the burst started and
   * never where it ended, or vice versa.
   */
  from?: number
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
  for (const { left, right } of buildPairList(lf)) {
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

/** One rule for what a pair's state is, used by every path that sets it. */
export function statusFor(
  kern: number,
  original: number,
  attempts: Attempt[],
): PairStatus {
  if (kern !== original) return 'adjusted'
  return attempts.at(-1)?.rejected ? 'rejected' : 'untouched'
}
