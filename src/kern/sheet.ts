import type { LoadedFont, PairMetrics } from './font'
import { GHOST_INK, drawGlyphInto, measurePair, paintGap } from './font'

/**
 * The letter to stand a pair next to.
 *
 * Kerning is judged in company, not in isolation: `AV` can look settled alone
 * and wrong between an `H` and an `E`. These are the control letters
 * typographers space against — `H` and `n` for the straight-sided reference,
 * `o` for anything round or punctuational, where the gap is the whole story.
 */
function flankFor(ch: string): string {
  if (/[A-Z]/.test(ch)) return 'H'
  if (/[a-z]/.test(ch)) return 'n'
  if (/[0-9]/.test(ch)) return '0'
  // Brackets, quotes and the rest. `f)` has to be seen as `off)` to show that
  // the terminal, not the area, is what runs out of room.
  return 'o'
}

export interface SheetItem {
  left: string
  right: string
  kern: number
}

export interface SheetCell extends SheetItem {
  metrics: PairMetrics
}

export interface Sheet {
  dataUrl: string
  base64: string
  cells: SheetCell[]
  columns: number
}

/*
 * Two sizes, because there are two jobs. Screening asks "which of these two
 * hundred is worth a look", and wants density. Judging asks "is this value
 * right", and wants to show a serif meeting its neighbour. One compromise size
 * served neither: too small to decide on, too few to get through the list.
 */
export const SHEET_SIZES = {
  screen: { glyph: 76, cellW: 176, cellH: 140, max: 36 },
  judge: { glyph: 132, cellW: 300, cellH: 230, max: 12 },
} as const

export type SheetSize = keyof typeof SHEET_SIZES
const LABEL_H = 26

/**
 * Draw many pairs onto a single labelled canvas and measure them all in one
 * pass.
 *
 * Rendering pairs one at a time meant a round trip per pair; a fifty-pair font
 * cost well over a hundred tool calls. A contact sheet lets the agent survey a
 * batch, spot the two that look wrong, and only then zoom in.
 */
export function drawSheet(
  lf: LoadedFont,
  items: SheetItem[],
  columns = 4,
  shade = true,
  size: SheetSize = 'judge',
  context = false,
): Sheet {
  const { glyph: GLYPH_PX, cellH: CELL_H } = SHEET_SIZES[size]
  // Room for a flanking letter on each side. Measured from the font rather
  // than guessed, so a wide face does not overflow its cell.
  const flankPx = context
    ? ((lf.font.charToGlyph('n')?.advanceWidth ?? lf.unitsPerEm * 0.5) * GLYPH_PX * 2) /
      lf.unitsPerEm
    : 0
  const CELL_W = Math.round(SHEET_SIZES[size].cellW + flankPx)
  // Anything wider than this is resized down before the model sees it, so
  // extra columns past this point cost detail rather than adding any.
  const MAX_SHEET_W = 1500
  const cols = Math.max(
    1,
    Math.min(columns, items.length || 1, Math.floor(MAX_SHEET_W / CELL_W) || 1),
  )
  const rows = Math.ceil(items.length / cols)
  const width = cols * CELL_W
  const height = rows * CELL_H

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const scale = GLYPH_PX / lf.unitsPerEm
  const placed: { item: SheetItem; cellX: number; baselineY: number; splitX: number }[] = []

  items.forEach((item, i) => {
    const cx = (i % cols) * CELL_W
    const cy = Math.floor(i / cols) * CELL_H
    const baselineY = cy + CELL_H - LABEL_H - 26

    const lGlyph = lf.font.charToGlyph(item.left)
    const rGlyph = lf.font.charToGlyph(item.right)
    if (!lGlyph || !rGlyph) return

    const lAdv = lGlyph.advanceWidth ?? 0
    const rAdv = rGlyph.advanceWidth ?? 0

    // The flanks are drawn but never measured — metrics come from measurePair
    // at a fixed scale — so putting the pair in company cannot skew the
    // numbers. They are ghosted so the pair being judged still reads first.
    const preGlyph = context ? lf.font.charToGlyph(flankFor(item.left)) : null
    const postGlyph = context ? lf.font.charToGlyph(flankFor(item.right)) : null
    const preAdv = preGlyph?.advanceWidth ?? 0
    const postAdv = postGlyph?.advanceWidth ?? 0

    const totalPx = (preAdv + lAdv + item.kern + rAdv + postAdv) * scale
    const startX = cx + (CELL_W - totalPx) / 2
    const pairX = startX + preAdv * scale

    if (preGlyph) drawGlyphInto(ctx, preGlyph, startX, baselineY, GLYPH_PX, GHOST_INK)
    drawGlyphInto(ctx, lGlyph, pairX, baselineY, GLYPH_PX, '#16150f')
    drawGlyphInto(ctx, rGlyph, pairX + (lAdv + item.kern) * scale, baselineY, GLYPH_PX, '#16150f')
    if (postGlyph) {
      drawGlyphInto(
        ctx, postGlyph,
        pairX + (lAdv + item.kern + rAdv) * scale,
        baselineY, GLYPH_PX, GHOST_INK,
      )
    }

    // Label, so the agent can name what it is looking at.
    ctx.fillStyle = '#8a857a'
    ctx.font = `${size === 'screen' ? 11 : 13}px ui-monospace, SFMono-Regular, Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.fillText(
      `${item.left}${item.right}  ${item.kern > 0 ? '+' : ''}${item.kern}`,
      cx + CELL_W / 2,
      cy + CELL_H - 10,
    )

    // Cell divider, so the grid reads as a grid.
    ctx.strokeStyle = '#eeebe3'
    ctx.lineWidth = 1
    ctx.strokeRect(cx + 0.5, cy + 0.5, CELL_W - 1, CELL_H - 1)

    placed.push({
      item,
      cellX: cx,
      baselineY,
      splitX: pairX + lAdv * scale,
    })
  })

  // One read of the whole sheet, rather than one per cell.
  const image = ctx.getImageData(0, 0, width, height)
  const cells: SheetCell[] = placed.map((p) => ({
    ...p.item,
    // Measured at a fixed scale, not from these cell pixels. A 76px cell
    // cannot resolve a 20-unit gap, and pretending it could is what made the
    // sheet disagree with the close-up.
    metrics: measurePair(lf, p.item.left, p.item.right, p.item.kern),
  }))

  // Shading overwrites the pixels we just measured, so it comes last.
  if (shade) {
    for (const p of placed) {
      paintGap(
        ctx, image, width,
        p.cellX, p.cellX + CELL_W,
        Math.max(0, Math.floor(p.baselineY - lf.capHeight * scale)),
        Math.ceil(p.baselineY),
        p.splitX,
      )
    }
  }

  const dataUrl = canvas.toDataURL('image/png')
  return {
    dataUrl,
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    cells,
    columns: cols,
  }
}
