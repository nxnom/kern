import opentype from 'opentype.js'

/** A loaded font plus the metadata Kern needs to reason about spacing. */
export interface LoadedFont {
  font: opentype.Font
  familyName: string
  styleName: string
  /** Where it came from: the bundled sample, or the file the user picked. */
  source: string
  unitsPerEm: number
  /** Cap height in font units, used to bound the optical measurement band. */
  capHeight: number
  xHeight: number
  /** Original bytes, kept because export splices a kern table into them. */
  buffer: ArrayBuffer
}

/**
 * opentype.js 2.x namespaces the name table by platform, so the old flat
 * `names.fontFamily` is always undefined. Look through both platforms, and
 * through whatever locale the font actually shipped, before giving up.
 */
function readName(font: opentype.Font, key: string): string | undefined {
  const names = font.names as unknown as Record<string, Record<string, Record<string, string>>>
  for (const platform of ['windows', 'macintosh']) {
    const entry = names[platform]?.[key]
    if (!entry) continue
    return entry.en ?? Object.values(entry)[0]
  }
  return undefined
}

export function loadFontFromBuffer(buffer: ArrayBuffer, source = 'uploaded'): LoadedFont {
  const font = opentype.parse(buffer)
  const unitsPerEm = font.unitsPerEm
  // OS/2 metrics are optional; fall back to sensible fractions of the em.
  const os2 = font.tables.os2 as { sCapHeight?: number; sxHeight?: number } | undefined
  return {
    font,
    familyName:
      readName(font, 'preferredFamily') ??
      readName(font, 'fontFamily') ??
      readName(font, 'fullName') ??
      'Untitled',
    styleName: readName(font, 'fontSubfamily') ?? '',
    source,
    unitsPerEm,
    capHeight: os2?.sCapHeight ?? unitsPerEm * 0.7,
    xHeight: os2?.sxHeight ?? unitsPerEm * 0.5,
    buffer,
  }
}

export async function loadFontFromUrl(url: string, source: string): Promise<LoadedFont> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load font: ${res.status}`)
  return loadFontFromBuffer(await res.arrayBuffer(), source)
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
export interface DrawStyle {
  /** Ground colour. Must stay light: the gap measurement reads ink as dark. */
  paper?: string
  ink?: string
  /** Drafting rule along the baseline, as in a type drawing. */
  baseline?: string
  shade?: string
}

/** The "before" state, dark enough to read as type rather than as a hairline. */
export const GHOST_INK = '#7b8290'
/** Hairline used for the baseline rule in a drawing cell. */
export const RULE = '#e6e7ea'

const DEFAULT_STYLE: Required<DrawStyle> = {
  paper: '#ffffff',
  ink: '#101014',
  baseline: 'transparent',
  shade: 'rgba(43, 95, 217, 0.16)',
}

export function drawPair(
  lf: LoadedFont,
  left: string,
  right: string,
  kern: number,
  sizePx = 96,
  shade = false,
  style: DrawStyle = {},
): string {
  // The shading pass reads pixels and treats dark as ink, so it needs a light
  // ground; only an unshaded tile can sit transparent on the page.
  const s = { ...DEFAULT_STYLE, ...style }
  if (shade && s.paper === 'transparent') s.paper = DEFAULT_STYLE.paper
  const { font, unitsPerEm } = lf
  const scale = sizePx / unitsPerEm
  const pad = Math.round(sizePx * 0.18)

  const lGlyph = font.charToGlyph(left)
  const rGlyph = font.charToGlyph(right)
  if (!lGlyph || !rGlyph) return ''

  const lAdvance = lGlyph.advanceWidth ?? 0
  const rAdvance = rGlyph.advanceWidth ?? 0
  const width = Math.max(1, Math.ceil((lAdvance + kern + rAdvance) * scale) + pad * 2)
  // Just enough room for ascenders above and descenders below — no more.
  const height = Math.ceil(sizePx * 1.3)
  const baselineY = Math.round(sizePx * 1.02)

  const canvas = document.createElement('canvas')
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d', { willReadFrequently: shade })!
  ctx.scale(dpr, dpr)
  ctx.fillStyle = s.paper
  ctx.fillRect(0, 0, width, height)

  if (s.baseline !== 'transparent') {
    ctx.strokeStyle = s.baseline
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, Math.round(baselineY) + 0.5)
    ctx.lineTo(width, Math.round(baselineY) + 0.5)
    ctx.stroke()
  }

  ctx.fillStyle = s.ink
  lGlyph.getPath(pad, baselineY, sizePx).draw(ctx)
  rGlyph.getPath(pad + (lAdvance + kern) * scale, baselineY, sizePx).draw(ctx)

  if (shade) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    paintGap(
      ctx,
      ctx.getImageData(0, 0, canvas.width, canvas.height),
      canvas.width,
      0, canvas.width,
      Math.max(0, Math.floor((baselineY - lf.capHeight * scale) * dpr)),
      Math.ceil(baselineY * dpr),
      (pad + lAdvance * scale) * dpr,
      s.shade,
    )
  }
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

/**
 * Tint the white trapped between the two outlines.
 *
 * Kerning shifts are small — a typical pair moves three or four pixels at
 * reading size — so a grid of raw pairs is unreadable. Painting the negative
 * space shows the thing the eye is actually judging, and makes an uneven
 * rhythm obvious at a glance.
 *
 * Must run after measuring, since it writes over the pixels being measured.
 */
export function paintGap(
  ctx: CanvasRenderingContext2D,
  image: ImageData,
  imageWidth: number,
  x0: number,
  x1: number,
  yTop: number,
  yBottom: number,
  splitX: number,
  color = 'rgba(43, 95, 217, 0.16)',
) {
  const { data } = image
  const left0 = Math.max(0, Math.floor(x0))
  const right1 = Math.min(imageWidth, Math.ceil(x1))
  const split = Math.round(splitX)
  const inkAt = (x: number, y: number) => data[(y * imageWidth + x) * 4] < 128

  ctx.fillStyle = color
  for (let y = Math.max(0, yTop); y <= yBottom; y++) {
    let leftEdge = -1
    for (let x = Math.min(split, right1 - 1); x >= left0; x--) {
      if (inkAt(x, y)) { leftEdge = x; break }
    }
    let rightEdge = -1
    for (let x = Math.max(split, left0); x < right1; x++) {
      if (inkAt(x, y)) { rightEdge = x; break }
    }
    if (leftEdge < 0 || rightEdge < 0 || rightEdge <= leftEdge) continue
    ctx.fillRect(leftEdge + 1, y, rightEdge - leftEdge - 1, 1)
  }
}

/**
 * Draw a word in the loaded font, applying the current kerning.
 *
 * Used for the masthead, so the product's own name is set in the material it
 * works on: load a different font and the wordmark changes with it.
 */
export function drawWord(
  lf: LoadedFont,
  text: string,
  sizePx: number,
  kernFor: (left: string, right: string) => number,
  ink = '#101014',
): { dataUrl: string; width: number; height: number } {
  const scale = sizePx / lf.unitsPerEm
  const chars = [...text]
  const pad = Math.round(sizePx * 0.1)

  let pen = pad
  const placed = chars.map((ch, i) => {
    const glyph = lf.font.charToGlyph(ch)
    const at = pen
    pen += (glyph?.advanceWidth ?? 0) * scale
    const next = chars[i + 1]
    if (next) pen += kernFor(ch, next) * scale
    return { glyph, at }
  })

  const width = Math.ceil(pen + pad)
  const height = Math.ceil(sizePx * 1.32)
  const baselineY = Math.round(sizePx * 1.02)

  const canvas = document.createElement('canvas')
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.fillStyle = ink
  for (const p of placed) p.glyph?.getPath(p.at, baselineY, sizePx).draw(ctx)

  return { dataUrl: canvas.toDataURL('image/png'), width, height }
}

/**
 * White trapped by a well-spaced pair, used as the yardstick.
 *
 * An absolute optical area says nothing on its own: `AV` and `nn` trap very
 * different amounts of white even when both are perfectly spaced. Reporting a
 * raw number left the agent unable to tell a loose pair from a normal one, so
 * every measurement is now given relative to a control.
 *
 * `HH` and `nn` are the controls type designers use, because their sidebearings
 * are even and vertical — the gap between them is what "normal" looks like.
 */
const controlCache = new WeakMap<opentype.Font, { caps: number; lower: number }>()

export function controlWhite(lf: LoadedFont): { caps: number; lower: number } {
  const cached = controlCache.get(lf.font)
  if (cached) return cached
  const measure = (a: string, b: string) => {
    try {
      return renderPair(lf, a, b, 0).metrics.opticalArea
    } catch {
      return 0
    }
  }
  const control = { caps: measure('H', 'H'), lower: measure('n', 'n') }
  controlCache.set(lf.font, control)
  return control
}

/**
 * How much more white this pair traps than a control pair, as a multiple.
 * 1.0 is normal; 2.5 means two and a half times the gap a reader expects.
 */
export function relativeWhite(lf: LoadedFont, left: string, area: number): number {
  const control = controlWhite(lf)
  const reference = /[A-Z]/.test(left) ? control.caps : control.lower
  return reference > 0 ? area / reference : 0
}
