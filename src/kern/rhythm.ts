import type { LoadedFont } from './font'
import { measureBand } from './font'

export interface Gap {
  left: string
  right: string
  kern: number
  /** Optical white in this gap, in square font units. */
  area: number
  /** Centre of the gap in canvas pixels, for aligning the bar beneath it. */
  x: number
}

export interface Rhythm {
  dataUrl: string
  base64: string
  gaps: Gap[]
  /**
   * Coefficient of variation of the gap areas: standard deviation over mean.
   * This is what "even rhythm" means numerically — lower is more even — and
   * it is the number kerning actually moves. Line width barely changes; this
   * changes a lot.
   */
  evenness: number
}

const TEXT_PX = 64
const PAD = 26
const BAR_AREA = 54
const GAP_ROW = 10

/**
 * Draw a line of text and, beneath each gap between letters, a bar showing how
 * much white is trapped there.
 *
 * Before and after look nearly identical as text, because a correction is a
 * couple of percent of the line. But the *rhythm* changes completely: unkerned
 * text has wildly uneven gaps, and the whole point of kerning is to level them.
 * The bars show that directly, and the evenness figure puts a number on it.
 */
export function drawRhythm(
  lf: LoadedFont,
  text: string,
  kernFor: (left: string, right: string) => number,
  barColor = '#16150f',
): Rhythm {
  const chars = [...text]
  const scale = TEXT_PX / lf.unitsPerEm

  // Lay the line out first so we know how wide the canvas has to be.
  const placed: { ch: string; x: number; advance: number }[] = []
  let pen = PAD
  for (let i = 0; i < chars.length; i++) {
    const glyph = lf.font.charToGlyph(chars[i])
    const advance = (glyph?.advanceWidth ?? 0) * scale
    placed.push({ ch: chars[i], x: pen, advance })
    const next = chars[i + 1]
    pen += advance + (next ? kernFor(chars[i], next) * scale : 0)
  }

  const width = Math.ceil(pen + PAD)
  const height = TEXT_PX + PAD * 2 + GAP_ROW + BAR_AREA
  const baselineY = PAD + TEXT_PX * 0.78

  const canvas = document.createElement('canvas')
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#16150f'
  for (const p of placed) {
    lf.font.charToGlyph(p.ch)?.getPath(p.x, baselineY, TEXT_PX).draw(ctx)
  }

  // One read for the whole line, then measure each gap out of it.
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const bandTop = Math.floor((baselineY - lf.capHeight * scale) * dpr)
  const bandBottom = Math.ceil(baselineY * dpr)

  const gaps: Gap[] = []
  for (let i = 0; i < placed.length - 1; i++) {
    const left = placed[i]
    const right = placed[i + 1]
    if (left.ch === ' ' || right.ch === ' ') continue
    const split = left.x + left.advance
    const metrics = measureBand(
      image,
      canvas.width,
      left.x * dpr,
      (right.x + right.advance) * dpr,
      bandTop,
      bandBottom,
      split * dpr,
      1 / (scale * dpr),
    )
    gaps.push({
      left: left.ch,
      right: right.ch,
      kern: kernFor(left.ch, right.ch),
      area: metrics.opticalArea,
      x: split,
    })
  }

  // Bars, aligned under the gap they measure.
  const max = Math.max(1, ...gaps.map((g) => g.area))
  const barTop = PAD + TEXT_PX + GAP_ROW
  ctx.strokeStyle = '#eeebe3'
  ctx.beginPath()
  ctx.moveTo(PAD, barTop + BAR_AREA + 0.5)
  ctx.lineTo(width - PAD, barTop + BAR_AREA + 0.5)
  ctx.stroke()

  ctx.fillStyle = barColor
  for (const g of gaps) {
    const h = Math.max(1, (g.area / max) * BAR_AREA)
    ctx.fillRect(g.x - 3, barTop + BAR_AREA - h, 6, h)
  }

  const dataUrl = canvas.toDataURL('image/png')
  return {
    dataUrl,
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    gaps,
    evenness: coefficientOfVariation(gaps.map((g) => g.area)),
  }
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean === 0) return 0
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}
