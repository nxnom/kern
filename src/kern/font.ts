import opentype from 'opentype.js'

/** A loaded font plus the metadata Kern needs to reason about spacing. */
export interface LoadedFont {
  font: opentype.Font
  familyName: string
  unitsPerEm: number
  /** Cap height in font units, used to bound the optical measurement band. */
  capHeight: number
  xHeight: number
  /** Original bytes, kept because export splices a kern table into them. */
  buffer: ArrayBuffer
}

export function loadFontFromBuffer(buffer: ArrayBuffer): LoadedFont {
  const font = opentype.parse(buffer)
  const unitsPerEm = font.unitsPerEm
  // OS/2 metrics are optional; fall back to sensible fractions of the em.
  const os2 = font.tables.os2 as { sCapHeight?: number; sxHeight?: number } | undefined
  return {
    font,
    familyName: font.names.fontFamily?.en ?? 'Untitled',
    unitsPerEm,
    capHeight: os2?.sCapHeight ?? unitsPerEm * 0.7,
    xHeight: os2?.sxHeight ?? unitsPerEm * 0.5,
    buffer,
  }
}

export async function loadFontFromUrl(url: string): Promise<LoadedFont> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load font: ${res.status}`)
  return loadFontFromBuffer(await res.arrayBuffer())
}

/** The font's own kerning value for a pair, in font units. 0 if unkerned. */
export function existingKern(lf: LoadedFont, left: string, right: string): number {
  const l = lf.font.charToGlyph(left)
  const r = lf.font.charToGlyph(right)
  if (!l || !r) return 0
  return lf.font.getKerningValue(l, r) ?? 0
}

export interface PairRender {
  /** PNG data URL, for showing in the page. */
  dataUrl: string
  /** Bare base64, which is what MCP image content wants. */
  base64: string
  width: number
  height: number
}

export interface PairMetrics {
  /**
   * Area of white trapped between the two outlines, measured scanline by
   * scanline across the cap band, in square font units. This approximates
   * what the eye is actually judging.
   */
  opticalArea: number
  /** Narrowest horizontal gap between the outlines, in font units. */
  minGap: number
  /** True when the outlines actually overlap. */
  collides: boolean
}

const RENDER_PX = 220
const PAD_PX = 60

/**
 * Draw a pair and return just the picture. Used for the grid, where fifty
 * tiles redraw on every change and the pixel measurement would be wasted.
 */
export function drawPair(
  lf: LoadedFont,
  left: string,
  right: string,
  kern: number,
  sizePx = 96,
): string {
  const { font, unitsPerEm } = lf
  const scale = sizePx / unitsPerEm
  const pad = Math.round(sizePx * 0.28)

  const lGlyph = font.charToGlyph(left)
  const rGlyph = font.charToGlyph(right)
  if (!lGlyph || !rGlyph) return ''

  const lAdvance = lGlyph.advanceWidth ?? 0
  const rAdvance = rGlyph.advanceWidth ?? 0
  const width = Math.max(1, Math.ceil((lAdvance + kern + rAdvance) * scale) + pad * 2)
  const height = sizePx + pad * 2
  const baselineY = height - pad - sizePx * 0.22

  const canvas = document.createElement('canvas')
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#16150f'
  lGlyph.getPath(pad, baselineY, sizePx).draw(ctx)
  rGlyph.getPath(pad + (lAdvance + kern) * scale, baselineY, sizePx).draw(ctx)
  return canvas.toDataURL('image/png')
}

/**
 * Draw `left` and `right` at `kern` (font units) and return both the picture
 * and the optical measurements.
 *
 * The two are deliberately returned together: testing showed a vision model
 * reads the *direction* of a spacing error reliably but its *magnitude*
 * poorly, so it needs numbers alongside the image.
 */
export function renderPair(
  lf: LoadedFont,
  left: string,
  right: string,
  kern: number,
): { render: PairRender; metrics: PairMetrics } {
  const { font, unitsPerEm } = lf
  const scale = RENDER_PX / unitsPerEm

  const lGlyph = font.charToGlyph(left)
  const rGlyph = font.charToGlyph(right)
  if (!lGlyph || !rGlyph) throw new Error(`Font has no glyph for "${left}${right}"`)

  const lAdvance = lGlyph.advanceWidth ?? 0
  const rAdvance = rGlyph.advanceWidth ?? 0

  const width = Math.ceil((lAdvance + kern + rAdvance) * scale) + PAD_PX * 2
  const height = RENDER_PX + PAD_PX * 2
  const baselineY = height - PAD_PX - RENDER_PX * 0.22

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#111111'

  const originX = PAD_PX
  lGlyph.getPath(originX, baselineY, RENDER_PX).draw(ctx)
  rGlyph.getPath(originX + (lAdvance + kern) * scale, baselineY, RENDER_PX).draw(ctx)

  const metrics = measureOpticalGap(
    ctx, width, height, baselineY, lf, scale, originX + lAdvance * scale,
  )

  const dataUrl = canvas.toDataURL('image/png')
  return {
    render: { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), width, height },
    metrics,
  }
}

/**
 * Walk each scanline across the cap band. On every line, find the rightmost
 * ink left of the split and the leftmost ink right of it, and accumulate the
 * gap between them. Summing those gaps gives the area of trapped white, which
 * is what "evenly spaced" actually means to a reader.
 */
function measureOpticalGap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  baselineY: number,
  lf: LoadedFont,
  scale: number,
  splitX: number,
): PairMetrics {
  return measureBand(
    ctx.getImageData(0, 0, width, height),
    width,
    0,
    width,
    Math.max(0, Math.floor(baselineY - lf.capHeight * scale)),
    Math.min(height - 1, Math.ceil(baselineY)),
    splitX,
    1 / scale,
  )
}

/**
 * Walk each scanline across the cap band. On every line, find the rightmost
 * ink left of the split and the leftmost ink right of it, and accumulate the
 * gap between them. Summing those gaps gives the area of trapped white, which
 * is what "evenly spaced" actually means to a reader.
 *
 * Takes a region so the contact sheet can measure every cell from one
 * getImageData call instead of one per pair.
 */
export function measureBand(
  image: ImageData,
  imageWidth: number,
  x0: number,
  x1: number,
  yTop: number,
  yBottom: number,
  splitX: number,
  toUnits: number,
): PairMetrics {
  const { data } = image
  const left0 = Math.max(0, Math.floor(x0))
  const right1 = Math.min(imageWidth, Math.ceil(x1))
  const split = Math.round(splitX)
  const inkAt = (x: number, y: number) => data[(y * imageWidth + x) * 4] < 128

  let areaPx = 0
  let minGapPx = Number.POSITIVE_INFINITY
  let collides = false

  for (let y = Math.max(0, yTop); y <= yBottom; y++) {
    let leftEdge = -1
    for (let x = Math.min(split, right1 - 1); x >= left0; x--) {
      if (inkAt(x, y)) { leftEdge = x; break }
    }
    let rightEdge = -1
    for (let x = Math.max(split, left0); x < right1; x++) {
      if (inkAt(x, y)) { rightEdge = x; break }
    }
    // Scanlines where one side has no ink carry no spacing information.
    if (leftEdge < 0 || rightEdge < 0) continue

    const gap = rightEdge - leftEdge
    if (gap < 0) collides = true
    areaPx += Math.max(0, gap)
    if (gap < minGapPx) minGapPx = gap
  }

  return {
    opticalArea: Math.round(areaPx * toUnits * toUnits),
    minGap: Number.isFinite(minGapPx) ? Math.round(minGapPx * toUnits) : 0,
    collides,
  }
}
