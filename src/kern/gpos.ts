/**
 * Build a minimal GPOS table containing a single `kern` feature.
 *
 * The legacy `kern` table is not enough on its own: HarfBuzz, browsers, macOS
 * and opentype.js all consult GPOS first and ignore `kern` when GPOS kerning
 * exists. Since nearly every modern font ships GPOS, an export that only wrote
 * `kern` would be silently discarded by the things people actually use.
 *
 * Layout is LookupType 2 (PairPos), Format 1, with ValueFormat 0x0004 —
 * an XAdvance applied to the first glyph of each pair.
 */
export interface GlyphPair {
  left: number
  right: number
  value: number
}

export function makeGposKernTable(pairs: GlyphPair[]): Uint8Array {
  // Group by first glyph; both the groups and each group's seconds must be
  // sorted by glyph id, because Coverage and PairSet are binary-searched.
  const byFirst = new Map<number, GlyphPair[]>()
  for (const p of pairs) {
    const list = byFirst.get(p.left)
    if (list) list.push(p)
    else byFirst.set(p.left, [p])
  }
  const firsts = [...byFirst.keys()].sort((a, b) => a - b)
  for (const f of firsts) byFirst.get(f)!.sort((a, b) => a.right - b.right)

  const HEADER = 10
  const SCRIPT_LIST = 20
  const FEATURE_LIST = 14
  const LOOKUP_LIST = 12

  const scriptListOff = HEADER
  const featureListOff = scriptListOff + SCRIPT_LIST
  const lookupListOff = featureListOff + FEATURE_LIST
  const pairPosOff = lookupListOff + LOOKUP_LIST

  // PairPos: fixed fields, then one Offset16 per PairSet.
  const pairPosHeader = 10 + firsts.length * 2
  const pairSetOffsets: number[] = []
  let cursor = pairPosHeader
  for (const f of firsts) {
    pairSetOffsets.push(cursor)
    cursor += 2 + byFirst.get(f)!.length * 4
  }
  const coverageOff = cursor
  const pairPosSize = coverageOff + 4 + firsts.length * 2

  const buf = new Uint8Array(pairPosOff + pairPosSize)
  const v = new DataView(buf.buffer)

  // ---- header -------------------------------------------------------
  v.setUint16(0, 1)
  v.setUint16(2, 0)
  v.setUint16(4, scriptListOff)
  v.setUint16(6, featureListOff)
  v.setUint16(8, lookupListOff)

  // ---- ScriptList: one DFLT script with one default LangSys ----------
  let o = scriptListOff
  v.setUint16(o, 1)
  writeTag(v, o + 2, 'DFLT')
  v.setUint16(o + 6, 8) // Script offset, from the ScriptList start
  const scriptOff = scriptListOff + 8
  v.setUint16(scriptOff, 4) // defaultLangSys offset, from the Script start
  v.setUint16(scriptOff + 2, 0) // no extra LangSys records
  const langSysOff = scriptOff + 4
  v.setUint16(langSysOff, 0) // lookupOrder, always null
  v.setUint16(langSysOff + 2, 0xffff) // no required feature
  v.setUint16(langSysOff + 4, 1)
  v.setUint16(langSysOff + 6, 0) // feature index 0

  // ---- FeatureList: one `kern` feature pointing at lookup 0 ----------
  o = featureListOff
  v.setUint16(o, 1)
  writeTag(v, o + 2, 'kern')
  v.setUint16(o + 6, 8)
  const featureOff = featureListOff + 8
  v.setUint16(featureOff, 0) // no feature params
  v.setUint16(featureOff + 2, 1)
  v.setUint16(featureOff + 4, 0) // lookup index 0

  // ---- LookupList: one PairPos lookup --------------------------------
  o = lookupListOff
  v.setUint16(o, 1)
  v.setUint16(o + 2, 4) // Lookup offset, from the LookupList start
  const lookupOff = lookupListOff + 4
  v.setUint16(lookupOff, 2) // LookupType 2, pair adjustment
  v.setUint16(lookupOff + 2, 0) // no flags
  v.setUint16(lookupOff + 4, 1)
  v.setUint16(lookupOff + 6, pairPosOff - lookupOff)

  // ---- PairPos format 1 ----------------------------------------------
  o = pairPosOff
  v.setUint16(o, 1)
  v.setUint16(o + 2, coverageOff)
  v.setUint16(o + 4, 0x0004) // valueFormat1: XAdvance only
  v.setUint16(o + 6, 0) // valueFormat2: nothing for the second glyph
  v.setUint16(o + 8, firsts.length)
  firsts.forEach((_, i) => v.setUint16(o + 10 + i * 2, pairSetOffsets[i]))

  firsts.forEach((f, i) => {
    const set = byFirst.get(f)!
    let p = pairPosOff + pairSetOffsets[i]
    v.setUint16(p, set.length)
    p += 2
    for (const pair of set) {
      v.setUint16(p, pair.right)
      v.setInt16(p + 2, Math.round(pair.value))
      p += 4
    }
  })

  // ---- Coverage format 1 ---------------------------------------------
  const cov = pairPosOff + coverageOff
  v.setUint16(cov, 1)
  v.setUint16(cov + 2, firsts.length)
  firsts.forEach((f, i) => v.setUint16(cov + 4 + i * 2, f))

  return buf
}

function writeTag(v: DataView, offset: number, tag: string) {
  for (let i = 0; i < 4; i++) v.setUint8(offset + i, tag.charCodeAt(i))
}
