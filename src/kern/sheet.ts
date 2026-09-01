import type { LoadedFont, PairMetrics } from './font'
import { measureBand } from './font'

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

const GLYPH_PX = 74
const CELL_W = 190
const CELL_H = 150
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
): Sheet {
  const cols = Math.max(1, Math.min(columns, items.length || 1))
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
    const totalPx = (lAdv + item.kern + rAdv) * scale
    const startX = cx + (CELL_W - totalPx) / 2

    ctx.fillStyle = '#16150f'
    lGlyph.getPath(startX, baselineY, GLYPH_PX).draw(ctx)
    rGlyph.getPath(startX + (lAdv + item.kern) * scale, baselineY, GLYPH_PX).draw(ctx)

    // Label, so the agent can name what it is looking at.
    ctx.fillStyle = '#8a857a'
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace'
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
      splitX: startX + lAdv * scale,
    })
  })

  // One read of the whole sheet, rather than one per cell.
  const image = ctx.getImageData(0, 0, width, height)
  const cells: SheetCell[] = placed.map((p) => ({
    ...p.item,
    metrics: measureBand(
      image,
      width,
      p.cellX,
      p.cellX + CELL_W,
      Math.max(0, Math.floor(p.baselineY - lf.capHeight * scale)),
      Math.ceil(p.baselineY),
      p.splitX,
      1 / scale,
    ),
  }))

  const dataUrl = canvas.toDataURL('image/png')
  return {
    dataUrl,
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    cells,
    columns: cols,
  }
}
