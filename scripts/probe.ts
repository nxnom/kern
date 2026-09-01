import opentype from 'opentype.js'
import fs from 'node:fs'
import { loadFontFromBuffer } from '../src/kern/font.ts'
import { initialPairs } from '../src/kern/state.ts'

const b = fs.readFileSync('public/fonts/Roboto-Regular.ttf')
const lf = loadFontFromBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'Roboto')
console.log(`${lf.familyName} ${lf.styleName} · ${lf.unitsPerEm} upem`)

for (const strip of [false, true]) {
  const pairs = [...initialPairs(lf, strip).values()]
  const withRef = pairs.filter((p) => p.reference !== 0)
  const atZero = pairs.filter((p) => p.original === 0)
  console.log(
    `strip=${String(strip).padEnd(5)} reference values: ${withRef.length}/${pairs.length}` +
    ` · starting at zero: ${atZero.length}`,
  )
}
