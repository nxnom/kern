import type { LoadedFont } from './font'
import { controlWhite, quickWhite } from './font'

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

/**
 * Build the pair list from the font itself.
 *
 * A hardcoded list of fifty-one is a demo. A real face needs hundreds, and
 * which ones depends on the shapes it actually draws — so generate every
 * candidate the font can set, measure the white each one traps, and keep the
 * ones that are genuinely out of step with a control pair.
 *
 * Measuring is what makes this honest: it reports the pairs that need work in
 * *this* face, not the pairs that usually need work in general.
 */
const LEFT_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const RIGHT_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?')]}-"

/**
 * Classes where a correction is plausible at all. `other` is deliberately out:
 * including it puts every letter combination through the measurement, which is
 * four thousand of them and about a second and a half of blocked main thread
 * on every font load — for pairs whose shapes give no reason to expect trouble.
 */
const WORTH_TESTING = new Set<PairClass>([
  'diagonal-diagonal',
  'overhang-round',
  'overhang-diagonal',
  'arm-punctuation',
  'hook-bracket',
])

/** Ratio above which a gap is worth a designer's attention. */
const NOTEWORTHY = 1.18
/**
 * How much work to take on.
 *
 * A face turns up hundreds of candidates, and an agent asked to survey all of
 * them takes several minutes. The list is ordered worst first, so a smaller
 * scope is not a lesser one — it is the same work, stopped sooner.
 */
export const SCOPES = {
  essential: { label: 'Essential', count: 48, note: 'the worst offenders, a minute of work' },
  standard: { label: 'Standard', count: 120, note: 'a thorough pass, several minutes' },
  everything: { label: 'Everything', count: 400, note: 'every candidate this face turns up — long' },
} as const

export type ScopeId = keyof typeof SCOPES

const MAX_PAIRS = SCOPES.everything.count

export interface GeneratedPair {
  left: string
  right: string
  ratio: number
}

export function buildPairList(lf: LoadedFont): GeneratedPair[] {
  const control = controlWhite(lf)
  const found: GeneratedPair[] = []

  for (const left of LEFT_CHARS) {
    if (!hasGlyph(lf, left)) continue
    for (const right of RIGHT_CHARS) {
      if (!hasGlyph(lf, right)) continue
      if (!WORTH_TESTING.has(classifyPair(left, right))) continue

      const area = quickWhite(lf, left, right)
      if (area === null) continue
      const reference = /[A-Z0-9]/.test(left) ? control.caps : control.lower
      if (!reference) continue
      const ratio = area / reference
      if (ratio >= NOTEWORTHY) found.push({ left, right, ratio })
    }
  }

  // The classics go in whatever they measure: they are the pairs a type
  // designer will look for first, and their absence would read as an oversight.
  for (const [left, right] of PRIORITY_PAIRS) {
    if (found.some((p) => p.left === left && p.right === right)) continue
    if (!hasGlyph(lf, left) || !hasGlyph(lf, right)) continue
    const area = quickWhite(lf, left, right)
    const reference = /[A-Z0-9]/.test(left) ? control.caps : control.lower
    if (area === null || !reference) continue
    found.push({ left, right, ratio: area / reference })
  }

  return found.sort((a, b) => b.ratio - a.ratio).slice(0, MAX_PAIRS)
}

function hasGlyph(lf: LoadedFont, ch: string): boolean {
  return lf.font.charToGlyphIndex(ch) > 0
}
