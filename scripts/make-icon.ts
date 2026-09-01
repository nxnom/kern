/**
 * Build the favicon from the bundled sample font's own K, rather than drawing
 * one by hand. A type tool should wear its own typeface.
 */
import opentype from 'opentype.js'
import fs from 'node:fs'

const b = fs.readFileSync('public/fonts/EBGaramond-Regular.ttf')
const font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))

const SIZE = 64
const CAP = 40 // cap height of the K within the 64px tile
const glyph = font.charToGlyph('K')
const scale = CAP / (font.tables.os2?.sCapHeight ?? font.unitsPerEm * 0.7)
const width = (glyph.advanceWidth ?? 0) * (scale / 1) * (font.unitsPerEm / font.unitsPerEm)

const fontSize = font.unitsPerEm * scale
const advance = (glyph.advanceWidth ?? 0) * scale
const x = (SIZE - advance) / 2
const y = (SIZE + CAP) / 2
const path = glyph.getPath(x, y, fontSize).toPathData(2)

fs.writeFileSync(
  'public/icon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" rx="13" fill="#16150f"/>
  <path d="${path}" fill="#fbfbfa"/>
</svg>
`,
)
console.log(`K from ${font.names.windows?.fontFamily?.en}, advance ${advance.toFixed(1)}px, ${path.length} chars of path data`)
