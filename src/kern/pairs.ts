/**
 * The pairs that actually need kerning, and how far a correction may
 * reasonably go.
 *
 * A full font ships thousands of pairs, but they fall into a small number of
 * shape classes. Classifying a pair gives us a plausible range, which the
 * render_pair tool uses to push back on values that are out of bounds.
 */

export type PairClass =
  | 'diagonal-diagonal'   // AV AW VA WA
  | 'overhang-round'      // To Ta Yo Ye
  | 'overhang-diagonal'   // TA YA LT
  | 'round-straight'      // ol nb
  | 'arm-punctuation'     // r. F, P.
  | 'hook-bracket'        // f) f]
  | 'straight-straight'   // HI nn
  | 'other'

const OVERHANG = new Set(['T', 'Y', 'V', 'W', 'F', 'P'])
const DIAGONAL = new Set(['A', 'V', 'W', 'X', 'Y', 'K', 'Z', 'v', 'w', 'x', 'y'])
const ROUND = new Set(['o', 'c', 'e', 'a', 'd', 'g', 'q', 'u', 's', 'O', 'C', 'G', 'Q'])
const STRAIGHT = new Set(['H', 'I', 'M', 'N', 'E', 'B', 'D', 'L', 'h', 'i', 'l', 'm', 'n', 'b', 'k'])
const PUNCT = new Set(['.', ',', ';', ':', "'", '"', '-'])
const ARM = new Set(['r', 'F', 'P', 'T', 'V', 'W', 'Y'])
const HOOK = new Set(['f', 'j'])
const BRACKET = new Set([')', ']', '}'])

export function classifyPair(left: string, right: string): PairClass {
  if (HOOK.has(left) && BRACKET.has(right)) return 'hook-bracket'
  if (ARM.has(left) && PUNCT.has(right)) return 'arm-punctuation'
  if (DIAGONAL.has(left) && DIAGONAL.has(right)) return 'diagonal-diagonal'
  if (OVERHANG.has(left) && ROUND.has(right)) return 'overhang-round'
  if (OVERHANG.has(left) && DIAGONAL.has(right)) return 'overhang-diagonal'
  if (ROUND.has(left) && STRAIGHT.has(right)) return 'round-straight'
  if (STRAIGHT.has(left) && STRAIGHT.has(right)) return 'straight-straight'
  return 'other'
}

/**
 * Plausible kern range per class, as a fraction of the em. Negative pulls the
 * pair together. Sourced from the ranges practising type designers work in;
 * they are guard rails, not gospel, which is why the tool lets you override.
 */
const RANGES: Record<PairClass, [number, number]> = {
  'diagonal-diagonal': [-0.12, -0.02],
  'overhang-round': [-0.11, -0.03],
  'overhang-diagonal': [-0.14, -0.04],
  'arm-punctuation': [-0.18, -0.04],
  'hook-bracket': [-0.10, 0.02],
  'round-straight': [-0.03, 0.01],
  'straight-straight': [-0.02, 0.02],
  other: [-0.12, 0.04],
}

/** Typical range for this pair, in font units. */
export function typicalRange(
  left: string,
  right: string,
  unitsPerEm: number,
): { min: number; max: number; pairClass: PairClass } {
  const pairClass = classifyPair(left, right)
  const [lo, hi] = RANGES[pairClass]
  return {
    min: Math.round(lo * unitsPerEm),
    max: Math.round(hi * unitsPerEm),
    pairClass,
  }
}

/**
 * The pairs worth spending attention on, roughly in order of how much they
 * hurt when left unkerned.
 */
export const PRIORITY_PAIRS: readonly [string, string][] = [
  ['A', 'V'], ['A', 'W'], ['A', 'Y'], ['A', 'T'],
  ['V', 'A'], ['W', 'A'], ['Y', 'A'], ['T', 'A'],
  ['T', 'o'], ['T', 'e'], ['T', 'a'], ['T', 'u'], ['T', 'r'], ['T', 'y'],
  ['Y', 'o'], ['Y', 'e'], ['Y', 'a'], ['Y', 'u'],
  ['V', 'o'], ['V', 'e'], ['W', 'o'], ['W', 'e'],
  ['F', 'a'], ['F', 'o'], ['P', 'a'], ['P', 'o'],
  ['L', 'T'], ['L', 'V'], ['L', 'Y'], ['L', 'W'],
  ['r', '.'], ['r', ','], ['P', '.'], ['F', '.'], ['T', '.'], ['V', '.'], ['Y', '.'],
  ['f', ')'], ['f', ']'],
  ['o', 'v'], ['o', 'w'], ['o', 'y'], ['a', 'v'], ['a', 'w'], ['a', 'y'],
  ['v', 'a'], ['w', 'a'], ['y', 'a'], ['v', 'o'], ['w', 'o'], ['y', 'o'],
]

export const SPECIMEN_WORDS = [
  'AVATAR', 'Toy Yacht', 'Waffle', 'LTV', 'HAMBURGER', 'Type', 'Wavy',
]
