import opentype from 'opentype.js'
import fs from 'node:fs'
import { loadFontFromBuffer } from '../src/kern/font.ts'
for (const [label, p] of [['Roboto','/tmp/Roboto.ttf'], ['sample','public/fonts/EBGaramond-Regular.ttf']]) {
  const b = fs.readFileSync(p)
  const lf = loadFontFromBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), label)
  console.log(`${label}: "${lf.familyName}" ${lf.styleName} · ${lf.unitsPerEm} upem · cap ${lf.capHeight}`)
}
