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
  /** Top of the tallest ink, in font units above the baseline. */
  ascender: number
  /** Bottom of the deepest ink, in font units (negative, below the baseline). */
  descender: number
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
    ascender: font.ascender ?? unitsPerEm * 0.8,
    descender: font.descender ?? -unitsPerEm * 0.2,
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
   * Area of white trapped between the two outlines, in square font units.
   *
   * On its own this misleads, and did: `f)` traps a lot of white around a
   * contact point that is already tight, while `Vo` traps little in a tall
   * wedge that reads as a hole. Area says how much; the gaps below say where.
   */
  opticalArea: number
  /** Narrowest horizontal gap between the outlines, in font units. */
  minGap: number
  /** Widest horizontal gap. Far above minGap means a wedge, not an even gap. */
  maxGap: number
  /**
   * How much of the facing height is at or near contact, 0–1.
   *
   * A bare minimum gap cannot tell a serif tip grazing its neighbour from two
   * outlines genuinely crashing: both report zero. A tip touches over a few
   * per cent of the height; a crash touches over a third.
   */
  contact: number
  /** Where the tightest part sits, as a fraction of cap height from the top. */
  contactAt: number
  /**
   * How TALL the contact actually is, in font units.
   *
   * `contact` alone is a fraction of the facing height, and for a small mark
   * the facing height is small: a period sitting near a T's stem reported
   * touching over 100% of it, which read as a crash and was a few units of a
   * legitimately tight tuck. A crash has to be a long run of contact in
   * absolute terms as well as a proportional one.
   */
  contactUnits: number
  /** True when the outlines actually overlap. */
  collides: boolean
}

const RENDER_PX = 220
const PAD_PX = 60

/**
 * Draw a pair and return just the picture. Used for the grid, where fifty
 * tiles redraw on every change and the pixel measurement would be wasted.
 */

/**
 * Draw one glyph in a given colour.
 *
 * `Path.draw()` assigns `ctx.fillStyle` from the path's own `fill`, which is
 * black unless told otherwise — so a colour set on the context is thrown away.
 * Every glyph goes through here to avoid that; it is invisible in black on
 * white and wrong everywhere else.
 */
export function drawGlyphInto(
  ctx: CanvasRenderingContext2D,
  glyph: opentype.Glyph,
  x: number,
  baselineY: number,
  sizePx: number,
  fill: string,
) {
  const path = glyph.getPath(x, baselineY, sizePx)
  path.fill = fill
  path.draw(ctx)
}

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
  const s = { ...DEFAULT_STYLE, ...style }
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
  drawGlyphInto(ctx, lGlyph, pad, baselineY, sizePx, s.ink)
  drawGlyphInto(ctx, rGlyph, pad + (lAdvance + kern) * scale, baselineY, sizePx, s.ink)

  if (shade) {
    // The measurement reads brightness to find ink, so it needs a solid
    // ground — but filling the visible canvas would paint a rectangle over
    // whatever is behind it. So measure on a throwaway copy and paint the
    // result onto the real one.
    const gauge = document.createElement('canvas')
    gauge.width = canvas.width
    gauge.height = canvas.height
    const gctx = gauge.getContext('2d', { willReadFrequently: true })!
    gctx.scale(dpr, dpr)
    gctx.fillStyle = s.paper === 'transparent' ? DEFAULT_STYLE.paper : s.paper
    gctx.fillRect(0, 0, width, height)
    drawGlyphInto(gctx, lGlyph, pad, baselineY, sizePx, s.ink)
    drawGlyphInto(gctx, rGlyph, pad + (lAdvance + kern) * scale, baselineY, sizePx, s.ink)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    paintGap(
      ctx,
      gctx.getImageData(0, 0, gauge.width, gauge.height),
      gauge.width,
      0, gauge.width,
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
/**
 * Geometry of a pair, always measured at the same scale.
 *
 * Every caller used to measure whatever canvas it had already drawn — a 76px
 * survey cell, a 132px judge cell, a 220px preview — so the three disagreed
 * about the same pair. A survey warned that `f]` was touching at 0 and the
 * close-up then reported it clear at 0, -20, -40 and -60. That contradiction
 * is what let two enclosure pairs get kerned into their brackets.
 *
 * Measurement now happens here, at one scale, whatever is being drawn.
 */
const measured = new Map<string, PairMetrics>()
export function measurePair(
  lf: LoadedFont,
  left: string,
  right: string,
  kern: number,
): PairMetrics {
  const key = `${lf.familyName}|${lf.unitsPerEm}|${left}${right}|${kern}`
  const hit = measured.get(key)
  if (hit) return hit

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

  gauge ??= document.createElement('canvas')
  gauge.width = width
  gauge.height = height
  const ctx = gauge.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  drawGlyphInto(ctx, lGlyph, PAD_PX, baselineY, RENDER_PX, '#111111')
  drawGlyphInto(ctx, rGlyph, PAD_PX + (lAdvance + kern) * scale, baselineY, RENDER_PX, '#111111')

  // The FULL ink height, not the cap band.
  //
  // Measuring baseline-to-cap-height missed the two places pairs actually
  // collide: ascenders and descenders. On `f)` the pinch is the f's upper
  // terminal against the top of the bracket, well above cap height, so the
  // walk never saw it — it reported a flat 114 units at every value tried,
  // which read as roomy and was simply the stem against the bracket's middle.
  const m = measureBand(
    ctx.getImageData(0, 0, width, height),
    width,
    0,
    width,
    Math.max(0, Math.floor(baselineY - lf.ascender * scale)),
    Math.min(height - 1, Math.ceil(baselineY - lf.descender * scale)),
    PAD_PX + lAdvance * scale,
    1 / scale,
    nearUnits(lf),
  )
  measured.set(key, m)
  return m
}

/** Cleared when a new font is loaded, since the cache is keyed by family. */
export function forgetMeasurements() {
  measured.clear()
  floors.clear()
}

/**
 * How close counts as touching: 2% of the em.
 *
 * Relative to the em so it means the same thing in a 1000-unit face and a
 * 2048-unit one.
 */
export function nearUnits(lf: LoadedFont): number {
  return Math.round(lf.unitsPerEm * 0.02)
}

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
  drawGlyphInto(ctx, lGlyph, originX, baselineY, RENDER_PX, '#111111')
  drawGlyphInto(ctx, rGlyph, originX + (lAdvance + kern) * scale, baselineY, RENDER_PX, '#111111')

  // Delegated, not measured here: one code path means the close-up can never
  // contradict the sheet.
  const metrics = measurePair(lf, left, right, kern)

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
  /**
   * How close counts as touching, in FONT UNITS.
   *
   * This used to be a flat 3 pixels, which quietly meant a different thing on
   * every canvas: 3px was 39 units on a 76px survey cell and 14 units on a
   * 220px preview. The same pair then reported "touching" on the sheet and
   * "clear" in the close-up, and the contradiction taught the agent to ignore
   * the warning. Units are the same everywhere.
   */
  nearUnits: number,
): PairMetrics {
  const { data } = image
  const left0 = Math.max(0, Math.floor(x0))
  const right1 = Math.min(imageWidth, Math.ceil(x1))
  const split = Math.round(splitX)
  const inkAt = (x: number, y: number) => data[(y * imageWidth + x) * 4] < 128

  let areaPx = 0
  let minGapPx = Number.POSITIVE_INFINITY
  let maxGapPx = 0
  let collides = false
  let rows = 0
  let contactRows = 0
  let minAtY = 0
  const NEAR_CONTACT_PX = nearUnits / toUnits

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
    rows += 1
    areaPx += Math.max(0, gap)
    if (gap <= NEAR_CONTACT_PX) contactRows += 1
    if (gap < minGapPx) {
      minGapPx = gap
      minAtY = y
    }
    if (gap > maxGapPx) maxGapPx = gap
  }

  const bandHeight = Math.max(1, yBottom - Math.max(0, yTop))
  return {
    opticalArea: Math.round(areaPx * toUnits * toUnits),
    minGap: Number.isFinite(minGapPx) ? Math.round(minGapPx * toUnits) : 0,
    maxGap: Math.round(maxGapPx * toUnits),
    contact: rows > 0 ? contactRows / rows : 0,
    contactUnits: Math.round(contactRows * toUnits),
    contactAt: (minAtY - Math.max(0, yTop)) / bandHeight,
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
  for (const p of placed) {
    if (p.glyph) drawGlyphInto(ctx, p.glyph, p.at, baselineY, sizePx, ink)
  }

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

/** CSS family the proof lines are set in. */
export const LOADED_FAMILY = 'KernLoadedFace'

/**
 * Make the loaded font available to CSS so the proof lines are set in the face
 * being kerned rather than in a stand-in.
 *
 * The browser's own kerning has to be off: Kern applies its values as per-glyph
 * margins, so leaving the font's GPOS active would apply them twice. Ligatures
 * go too, or `f)` and `fi` fuse into a single glyph and the pair disappears.
 */
export function installFontFace(buffer: ArrayBuffer): () => void {
  if (typeof FontFace === 'undefined') return () => {}
  const face = new FontFace(LOADED_FAMILY, buffer)
  let live = true
  void face
    .load()
    .then(() => {
      if (live) document.fonts.add(face)
    })
    .catch(() => {})
  return () => {
    live = false
    document.fonts.delete(face)
  }
}

/**
 * Trapped white for one pair, measured as cheaply as possible.
 *
 * Building the pair list means measuring a few thousand candidates, so this
 * skips the device-pixel scaling and reuses a single canvas. Accuracy at 40px
 * is plenty for deciding whether a gap is worth a designer's attention.
 */
let gauge: HTMLCanvasElement | null = null

export function quickWhite(lf: LoadedFont, left: string, right: string): number | null {
  const SIZE = 40
  const PAD = 12
  const scale = SIZE / lf.unitsPerEm
  const lGlyph = lf.font.charToGlyph(left)
  const rGlyph = lf.font.charToGlyph(right)
  if (!lGlyph || !rGlyph) return null

  const lAdvance = lGlyph.advanceWidth ?? 0
  const rAdvance = rGlyph.advanceWidth ?? 0
  const width = Math.max(1, Math.ceil((lAdvance + rAdvance) * scale) + PAD * 2)
  const height = Math.ceil(SIZE * 1.3)
  const baselineY = Math.round(SIZE * 1.02)

  gauge ??= document.createElement('canvas')
  gauge.width = width
  gauge.height = height
  const ctx = gauge.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  drawGlyphInto(ctx, lGlyph, PAD, baselineY, SIZE, '#000000')
  drawGlyphInto(ctx, rGlyph, PAD + lAdvance * scale, baselineY, SIZE, '#000000')

  return measureBand(
    ctx.getImageData(0, 0, width, height),
    width,
    0,
    width,
    Math.max(0, Math.floor(baselineY - lf.capHeight * scale)),
    baselineY,
    PAD + lAdvance * scale,
    1 / scale,
    nearUnits(lf),
  ).opticalArea
}

/**
 * How far this pair can tighten before the outlines touch.
 *
 * Without it the only way to find the limit is to propose a value and be
 * refused — so an agent either guesses timidly or gets rejected repeatedly.
 * Measured, not modelled: the gap is walked down until it closes.
 */
/**
 * A crash, as opposed to two shapes legitimately sitting close.
 *
 * Needs BOTH a high proportion of the facing height AND a long run of it in
 * absolute terms. Proportion alone condemned `T.` and `r,`: a small mark has a
 * short facing height, so a couple of units of nearness read as 100% contact
 * and the tool called a correct, tight tuck a collision.
 */
export function isCrash(lf: LoadedFont, m: PairMetrics): boolean {
  if (m.collides) return true
  return m.contact >= 0.3 && m.contactUnits >= lf.capHeight * 0.25
}

const floors = new Map<string, number>()
export function safeFloor(
  lf: LoadedFont,
  left: string,
  right: string,
  from = 0,
): number {
  const cacheKey = `${lf.familyName}|${lf.unitsPerEm}|${left}${right}|${from}`
  const hit = floors.get(cacheKey)
  if (hit !== undefined) return hit

  const step = Math.round(lf.unitsPerEm / 100)
  const STEPS = 40
  // measurePair, not renderPair: this walk needs the numbers, and renderPair
  // also encodes a PNG that is thrown away.
  // Same definition of a crash the writer and the survey use.
  const crashes = (v: number) => isCrash(lf, measurePair(lf, left, right, v))

  // Halve the interval rather than walk it. Tightening only ever brings the
  // outlines closer, so the crash point is a single boundary and bisection
  // finds it in about six measurements instead of up to forty — and a survey
  // runs this for every cell on the sheet.
  let value: number
  if (crashes(from)) {
    value = from
  } else if (!crashes(from - STEPS * step)) {
    value = from - STEPS * step
  } else {
    let safe = 0
    let crashed = STEPS
    while (crashed - safe > 1) {
      const mid = (safe + crashed) >> 1
      if (crashes(from - mid * step)) crashed = mid
      else safe = mid
    }
    value = from - safe * step
  }
  floors.set(cacheKey, value)
  return value
}

/**
 * A line of text set twice: as the font ships, and as it stands now.
 *
 * `publish_specimen` was returning a contact sheet — the line chopped into pair
 * cells — while calling itself the word-rhythm check. That is the one view that
 * shows whether a value works in reading, and it never worked.
 */
export function drawSpecimen(
  lf: LoadedFont,
  text: string,
  kernFor: (left: string, right: string) => number,
  sizePx = 64,
): { dataUrl: string; base64: string } {
  // Anything wider than this is resized down before the model sees it, so the
  // extra pixels cost bytes and buy nothing — they cost detail, in fact, since
  // the resize squeezes the two lines together. Shrink the type to fit instead.
  const MAX_WIDTH = 1500
  const rough = [...text].reduce(
    (w, ch) => w + (lf.font.charToGlyph(ch)?.advanceWidth ?? 0),
    0,
  )
  const wouldBe = (rough * sizePx) / lf.unitsPerEm + sizePx * 0.6
  if (wouldBe > MAX_WIDTH) sizePx = Math.max(24, Math.floor((sizePx * MAX_WIDTH) / wouldBe))
  const pad = Math.round(sizePx * 0.3)
  const gap = Math.round(sizePx * 0.45)
  const lay = (kern: (l: string, r: string) => number) => {
    const chars = [...text]
    let pen = pad
    const placed = chars.map((ch, i) => {
      const glyph = lf.font.charToGlyph(ch)
      const at = pen
      pen += ((glyph?.advanceWidth ?? 0) * sizePx) / lf.unitsPerEm
      const next = chars[i + 1]
      if (next) pen += (kern(ch, next) * sizePx) / lf.unitsPerEm
      return { glyph, at }
    })
    return { placed, width: pen + pad }
  }

  const shipped = lay(() => 0)
  const now = lay(kernFor)
  const width = Math.ceil(Math.max(shipped.width, now.width))
  const line = Math.round(sizePx * 1.35)
  const height = line * 2 + gap + pad

  const canvas = document.createElement('canvas')
  // 1x on purpose. A retina canvas here is discarded by the resize above.
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.font = '12px ui-monospace, Menlo, monospace'
  ctx.fillStyle = '#8a857a'
  ctx.fillText('as the font ships', pad, pad * 0.8)
  for (const p of shipped.placed) {
    if (p.glyph) drawGlyphInto(ctx, p.glyph, p.at, pad + sizePx, sizePx, '#9aa1ab')
  }

  ctx.fillStyle = '#8a857a'
  ctx.fillText('kerned', pad, pad * 0.8 + line + gap)
  for (const p of now.placed) {
    if (p.glyph) {
      drawGlyphInto(ctx, p.glyph, p.at, pad + sizePx + line + gap, sizePx, '#16150f')
    }
  }

  const dataUrl = canvas.toDataURL('image/png')
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) }
}
