import type { LoadedFont } from './font'

export interface KernEntry {
  left: string
  right: string
  value: number
}

/**
 * Build a legacy `kern` table (format 0) and splice it into the original font
 * bytes.
 *
 * opentype.js can parse kerning but its writer emits neither `kern` nor
 * `GPOS`, so round-tripping through toArrayBuffer() would quietly discard
 * every value. Instead we keep every original table byte-for-byte and rebuild
 * only the sfnt directory around one added table.
 */
export function buildKernedFont(
  original: ArrayBuffer,
  lf: LoadedFont,
  entries: KernEntry[],
): ArrayBuffer {
  const pairs = entries
    .map((e) => ({
      left: lf.font.charToGlyphIndex(e.left),
      right: lf.font.charToGlyphIndex(e.right),
      value: Math.round(e.value),
    }))
    .filter((p) => p.left > 0 && p.right > 0 && p.value !== 0)
    // The format requires pairs sorted by the combined glyph index.
    .sort((a, b) => a.left - b.left || a.right - b.right)

  const tables = readTables(original)
  tables.set('kern', makeKernTable(pairs))
  return writeSfnt(new DataView(original).getUint32(0), tables)
}

function makeKernTable(
  pairs: { left: number; right: number; value: number }[],
): Uint8Array {
  const n = pairs.length
  const subtableLength = 14 + n * 6
  const buf = new Uint8Array(4 + subtableLength)
  const view = new DataView(buf.buffer)

  view.setUint16(0, 0) // table version
  view.setUint16(2, 1) // one subtable

  view.setUint16(4, 0) // subtable version
  view.setUint16(6, subtableLength)
  view.setUint16(8, 0x0001) // format 0, horizontal

  // Binary-search hints the format requires.
  const pow = n > 0 ? Math.floor(Math.log2(n)) : 0
  const largestPow2 = n > 0 ? 2 ** pow : 0
  view.setUint16(10, n)
  view.setUint16(12, largestPow2 * 6)
  view.setUint16(14, pow)
  view.setUint16(16, n * 6 - largestPow2 * 6)

  let o = 18
  for (const p of pairs) {
    view.setUint16(o, p.left)
    view.setUint16(o + 2, p.right)
    view.setInt16(o + 4, p.value)
    o += 6
  }
  return buf
}

function readTables(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const view = new DataView(buffer)
  const numTables = view.getUint16(4)
  const tables = new Map<string, Uint8Array>()
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    const tag = String.fromCharCode(
      view.getUint8(rec), view.getUint8(rec + 1),
      view.getUint8(rec + 2), view.getUint8(rec + 3),
    )
    const offset = view.getUint32(rec + 8)
    const length = view.getUint32(rec + 12)
    tables.set(tag, new Uint8Array(buffer, offset, length))
  }
  return tables
}

function writeSfnt(sfntVersion: number, tables: Map<string, Uint8Array>): ArrayBuffer {
  // The directory must be sorted by tag; table data conventionally follows.
  const tags = [...tables.keys()].sort()
  const numTables = tags.length
  const headerSize = 12 + numTables * 16

  let total = headerSize
  const offsets = new Map<string, number>()
  for (const tag of tags) {
    offsets.set(tag, total)
    total += align4(tables.get(tag)!.length)
  }

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)

  const pow = Math.floor(Math.log2(numTables))
  view.setUint32(0, sfntVersion)
  view.setUint16(4, numTables)
  view.setUint16(6, 2 ** pow * 16)
  view.setUint16(8, pow)
  view.setUint16(10, numTables * 16 - 2 ** pow * 16)

  tags.forEach((tag, i) => {
    const data = tables.get(tag)!
    const offset = offsets.get(tag)!
    out.set(data, offset)

    const rec = 12 + i * 16
    for (let c = 0; c < 4; c++) view.setUint8(rec + c, tag.charCodeAt(c))
    view.setUint32(rec + 4, checksum(out, offset, align4(data.length)))
    view.setUint32(rec + 8, offset)
    view.setUint32(rec + 12, data.length)
  })

  // head.checkSumAdjustment is computed over the finished file, so it must be
  // zeroed first and patched last.
  const headOffset = offsets.get('head')
  if (headOffset !== undefined) {
    view.setUint32(headOffset + 8, 0)
    const fileSum = checksum(out, 0, out.length)
    view.setUint32(headOffset + 8, (0xb1b0afba - fileSum) >>> 0)
  }

  return out.buffer
}

function align4(n: number) {
  return (n + 3) & ~3
}

function checksum(data: Uint8Array, offset: number, length: number): number {
  const view = new DataView(data.buffer, data.byteOffset)
  let sum = 0
  for (let i = offset; i < offset + length; i += 4) {
    sum = (sum + view.getUint32(i)) >>> 0
  }
  return sum
}

/**
 * Adobe feature-file syntax. This is what a type designer actually drops into
 * a real build with fontmake or AFDKO, so it is the more useful of the two
 * exports even though it is the less impressive one.
 */
export function buildFeatureFile(lf: LoadedFont, entries: KernEntry[]): string {
  const lines = entries
    .filter((e) => e.value !== 0)
    .map((e) => {
      const l = lf.font.charToGlyph(e.left)?.name ?? e.left
      const r = lf.font.charToGlyph(e.right)?.name ?? e.right
      return `    pos ${l} ${r} ${Math.round(e.value)};`
    })

  return [
    `# Kerning for ${lf.familyName}`,
    `# ${lines.length} pairs, in font units (em = ${lf.unitsPerEm})`,
    '',
    'feature kern {',
    ...lines,
    '} kern;',
    '',
  ].join('\n')
}

export function download(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
