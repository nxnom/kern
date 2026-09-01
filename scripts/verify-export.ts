import opentype from 'opentype.js'
import fs from 'node:fs'
import { buildKernedFont } from '../src/kern/export.ts'

const buf = fs.readFileSync('public/fonts/EBGaramond-Regular.ttf')
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const font = opentype.parse(ab)
const lf = { font, familyName: 'EB Garamond', unitsPerEm: font.unitsPerEm,
             capHeight: 700, xHeight: 500, buffer: ab }

const entries = [
  { left: 'A', right: 'V', value: -80 },
  { left: 'T', right: 'o', value: -95 },
  { left: 'r', right: '.', value: -120 },
  { left: 'L', right: 'T', value: -110 },
]
const out = buildKernedFont(ab, lf, entries)
fs.writeFileSync('/tmp/kerned.ttf', Buffer.from(out))
console.log('wrote', out.byteLength, 'bytes (original', ab.byteLength, ')')

const round = opentype.parse(out)
console.log('reparsed ok:', round.names.fontFamily?.en)
for (const e of entries) {
  const v = round.getKerningValue(round.charToGlyph(e.left), round.charToGlyph(e.right))
  console.log(`  ${e.left}${e.right}: wrote ${e.value}, read back ${v}`, v === e.value ? 'OK' : 'MISMATCH')
}

// Guard against a "valid but broken" font: the original and the export should
// agree on everything except kerning.
const nameOf = (f) => f.names?.fontFamily?.en ?? f.names?.windows?.fontFamily?.en ?? '(none)'
console.log('\noriginal family:', nameOf(font), '| exported:', nameOf(round))
console.log('numGlyphs      :', font.numGlyphs, '->', round.numGlyphs,
            font.numGlyphs === round.numGlyphs ? 'OK' : 'MISMATCH')
console.log('unitsPerEm     :', font.unitsPerEm, '->', round.unitsPerEm,
            font.unitsPerEm === round.unitsPerEm ? 'OK' : 'MISMATCH')
const pa = font.charToGlyph('A').getPath(0, 0, 100).toPathData(1)
const pb = round.charToGlyph('A').getPath(0, 0, 100).toPathData(1)
console.log('glyph A outline:', pa.length, 'chars ->', pb.length,
            pa === pb ? 'IDENTICAL' : 'CHANGED')
console.log('advance width A:', font.charToGlyph('A').advanceWidth,
            '->', round.charToGlyph('A').advanceWidth)
