/**
 * Guard the font export.
 *
 * The first version of this wrote only a legacy `kern` table, which read back
 * as zero for every pair because GPOS takes precedence. The bug was invisible:
 * the file opened fine and silently ignored the work. So the export is checked
 * on every deploy, and a failure here stops the build.
 */
import opentype from 'opentype.js'
import fs from 'node:fs'
import { loadFontFromBuffer } from '../src/kern/font.ts'
import { buildKernedFont } from '../src/kern/export.ts'

const path = 'public/fonts/EBGaramond-Regular.ttf'
const file = fs.readFileSync(path)
const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
const source = loadFontFromBuffer(bytes, path)

const entries = [
  { left: 'A', right: 'V', value: -80 },
  { left: 'T', right: 'o', value: -95 },
  { left: 'r', right: '.', value: -120 },
  { left: 'L', right: 'T', value: -110 },
  { left: 'f', right: ')', value: 20 },
]

const exported = buildKernedFont(bytes, source, entries)
const round = opentype.parse(exported)

const failures: string[] = []
const check = (label: string, actual: unknown, expected: unknown, shown?: string) => {
  const ok = actual === expected
  const detail = shown ?? String(actual)
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${detail}` +
      (ok ? '' : ` (expected ${String(expected).slice(0, 60)})`),
  )
  if (!ok) failures.push(label)
}

console.log(`\nkerning round-trips through ${(exported.byteLength / 1024) | 0}KB of font:`)
for (const e of entries) {
  const read = round.getKerningValue(round.charToGlyph(e.left), round.charToGlyph(e.right))
  check(`${e.left}${e.right}`, read, e.value)
}

console.log('\nthe rest of the font survives:')
check('family name', loadFontFromBuffer(exported, 'out').familyName, source.familyName)
check('glyph count', round.numGlyphs, source.font.numGlyphs)
check('units per em', round.unitsPerEm, source.unitsPerEm)
const outlineOf = (f: opentype.Font) =>
  f.charToGlyph('A').getPath(0, 0, 100).toPathData(1)
const after = outlineOf(round)
check('glyph A outline', after, outlineOf(source.font), `${after.length} chars, unchanged`)
check('advance width A', round.charToGlyph('A').advanceWidth, source.font.charToGlyph('A').advanceWidth)

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nexport verified\n')
