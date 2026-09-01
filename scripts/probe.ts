import opentype from 'opentype.js'
import fs from 'node:fs'
import { PRIORITY_PAIRS } from '../src/kern/pairs.ts'

for (const [name, path] of [['Roboto', '/tmp/Roboto.ttf'],
                            ['EB Garamond', 'public/fonts/EBGaramond-Regular.ttf']]) {
  const b = fs.readFileSync(path)
  const f = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
  console.log(`\n=== ${name} · upem ${f.unitsPerEm} ===`)
  let nonzero = 0
  const rows: string[] = []
  for (const [l, r] of PRIORITY_PAIRS) {
    const v = f.getKerningValue(f.charToGlyph(l), f.charToGlyph(r))
    if (v) nonzero++
    // px shift at the 88px tile size the grid draws at
    const px = (v / f.unitsPerEm) * 88
    rows.push(`${l}${r}=${String(v).padStart(5)} (${px.toFixed(1)}px)`)
  }
  console.log(rows.join('  '))
  console.log(`nonzero: ${nonzero}/${PRIORITY_PAIRS.length}`)
}
