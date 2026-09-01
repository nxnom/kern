import { useWebMCP } from 'usewebmcp'
import type { LoadedFont } from './font'
import { drawPair, renderPair } from './font'
import { drawSheet } from './sheet'
import { typicalRange } from './pairs'
import type { PairState, PairStatus } from './state'

export interface KernApi {
  font: LoadedFont | null
  /** Read through a ref so tools never close over stale state. */
  getPairs: () => Map<string, PairState>
  /** Applies values, returning what stuck and what did not. */
  applyKerns: (
    updates: { left: string; right: string; value: number }[],
    force: boolean,
  ) => { applied: Applied[]; rejected: Rejected[] }
  /** Light the tiles the agent is currently looking at. */
  highlight: (keys: string[]) => void
  log: (line: string, rejected?: boolean) => void
  /** Called once per tool invocation, so the counter means what it says. */
  countCall: (tool: string) => void
  /** True once the agent has changed anything — gates compare_to_reference. */
  hasChanges: boolean
  /** The agent's chosen proof text, shown on the page when it is done. */
  setSpecimen: (text: string, note?: string) => void
}

export interface Applied { key: string; from: number; to: number }
export interface Rejected { key: string; value: number; reason: string }

const text_ = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })
const READ_ONLY = { readOnlyHint: true }

/** Counts previews since the last write, so the nudge can escalate. */
let previewsSinceApply = 0
export function resetPreviewCount() {
  previewsSinceApply = 0
}

/** Appended to read tools so progress and the next step are always in view. */
function progressLine(pairs: Map<string, PairState>): string {
  const all = [...pairs.values()]
  const done = all.filter((p) => p.kern !== p.original).length
  return done === 0
    ? `Nothing has been applied yet — all ${all.length} pairs are still at the font's ` +
        `original values. Rendering changes nothing; call set_kern to apply.`
    : `${done} of ${all.length} pairs changed so far.`
}


/**
 * The tools this page asks for, given its current state.
 *
 * Reported separately from `getTools()` because the two answer different
 * questions: this is what we registered, that is what a connected client can
 * currently see. Polyfilled runtimes can return an empty list while our
 * registrations are perfectly fine, so treating theirs as authoritative
 * produces a false alarm.
 */
export function registeredToolNames(ready: boolean, hasChanges: boolean): string[] {
  if (!ready) return []
  const names = ['list_pairs', 'survey_pairs', 'preview_pair', 'publish_specimen', 'set_kern']
  if (hasChanges) names.push('compare_to_reference')
  return names
}

export function useKernTools(api: KernApi) {
  const { font } = api
  const ready = font !== null

  // ---- list_pairs: cheap planning, no image ---------------------------
  useWebMCP(
    {
      name: 'list_pairs',
      description:
        'Kern is a font-kerning workbench. These tools operate on the font file loaded in the app, not on the web page’s own CSS. List the kerning pairs on the page with their current value, status and ' +
        'shape class. Text only and cheap — use it to plan which batch to look at next.',
      annotations: READ_ONLY,
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['all', 'untouched', 'adjusted', 'rejected'],
            description: 'Filter by status. Defaults to all.',
          },
        },
      } as const,
      enabled: ready,
      execute: async ({ status }) => {
        api.countCall('list_pairs')
        const wanted = (status ?? 'all') as PairStatus | 'all'
        const rows = [...api.getPairs().values()]
          .filter((p) => wanted === 'all' || p.status === wanted)
          .map(
            (p) =>
              `${p.key}\t${p.kern}\t(was ${p.original})\t${p.status}\t` +
              `${typicalRange(p.left, p.right, font!.unitsPerEm).pairClass}\t` +
              `${p.attempts.length} attempts`,
          )
        return text_(
          `pair\tkern\toriginal\tstatus\tclass\tattempts\n${rows.join('\n')}\n\n` +
            `${rows.length} pairs. em = ${font!.unitsPerEm}.\n${progressLine(api.getPairs())}`,
        )
      },
    },
    [ready, font],
  )

  // ---- render_sheet: survey many pairs in one image -------------------
  useWebMCP(
    {
      name: 'survey_pairs',
      description:
        'Kern is a font-kerning workbench. Use these tools rather than screenshots or the DOM — the page cannot be kerned by CSS. Render up to 24 pairs onto a single labelled contact sheet and return it ' +
        'with a metrics table. This is the fast way to work: survey a batch, find ' +
        'the two or three that look wrong, then zoom in with preview_pair. Prefer ' +
        'this over calling preview_pair repeatedly.',
      annotations: READ_ONLY,
      inputSchema: {
        type: 'object',
        properties: {
          pairs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Explicit pairs like ["AV","To"]. Omit to use the filter.',
          },
          status: {
            type: 'string',
            enum: ['all', 'untouched', 'adjusted', 'rejected'],
            description: 'Which pairs to pull when `pairs` is omitted.',
          },
          offset: { type: 'number', description: 'Skip this many, for paging.' },
          limit: { type: 'number', description: 'How many to show. Default 16, max 24.' },
          columns: { type: 'number', description: 'Sheet columns. Default 4.' },
        },
      } as const,
      enabled: ready,
      execute: async ({ pairs, status, offset, limit, columns }) => {
        api.countCall('survey_pairs')
        const all = api.getPairs()
        let chosen: PairState[]
        if (pairs?.length) {
          chosen = pairs
            .map((k) => all.get(k))
            .filter((p): p is PairState => Boolean(p))
        } else {
          const wanted = (status ?? 'all') as PairStatus | 'all'
          chosen = [...all.values()].filter(
            (p) => wanted === 'all' || p.status === wanted,
          )
        }
        const start = Math.max(0, offset ?? 0)
        const take = Math.min(24, Math.max(1, limit ?? 16))
        chosen = chosen.slice(start, start + take)

        if (!chosen.length) return text_('No pairs match that filter.')

        const sheet = drawSheet(
          font!,
          chosen.map((p) => ({ left: p.left, right: p.right, kern: p.kern })),
          columns ?? 4,
        )
        api.highlight(chosen.map((p) => p.key))
        api.log(`sheet · ${chosen.length} pairs (${chosen[0].key}…${chosen.at(-1)!.key})`)

        const table = sheet.cells
          .map(
            (c) =>
              `${c.left}${c.right}\t${c.kern}\twhite ${c.metrics.opticalArea}` +
              `\tgap ${c.metrics.minGap}${c.metrics.collides ? '\tCOLLIDES' : ''}`,
          )
          .join('\n')

        return {
          content: [
            { type: 'image' as const, data: sheet.base64, mimeType: 'image/png' },
            {
              type: 'text' as const,
              text:
                `${sheet.cells.length} pairs, ${sheet.columns} columns, ` +
                `reading left to right.\n\npair\tkern\toptical white\tnarrowest gap\n${table}\n\n` +
                `Pairs of the same shape class should have similar optical white. ` +
                `Look for the outliers, then apply your corrections in one set_kern ` +
                `call.\n\n${progressLine(api.getPairs())}`,
            },
          ],
        }
      },
    },
    [ready, font],
  )

  // ---- render_pair: zoom in on one -----------------------------------
  useWebMCP(
    {
      name: 'preview_pair',
      description:
        'Kern is a font-kerning workbench. PREVIEW ONLY — this changes nothing. Render a single pair large at a given ' +
        'kerning value and return the image with its measurements. Use it after ' +
        'render_sheet when one pair needs a closer look. Once you are happy with a ' +
        'value you MUST call set_kern to actually apply it; previewing alone leaves ' +
        'the font untouched.',
      annotations: READ_ONLY,
      inputSchema: {
        type: 'object',
        properties: {
          left: { type: 'string', description: 'Left character, e.g. "A"' },
          right: { type: 'string', description: 'Right character, e.g. "V"' },
          kern: {
            type: 'number',
            description: 'Value to preview in font units. Omit for the current value.',
          },
        },
        required: ['left', 'right'],
      } as const,
      enabled: ready,
      execute: async ({ left, right, kern }) => {
        api.countCall('preview_pair')
        if ([...left].length !== 1 || [...right].length !== 1) {
          throw new Error('left and right must each be exactly one character.')
        }
        const key = `${left}${right}`
        const state = api.getPairs().get(key)
        const value = kern ?? state?.kern ?? 0
        const range = typicalRange(left, right, font!.unitsPerEm)

        previewsSinceApply += 1
        const { render, metrics } = renderPair(font!, left, right, value)
        api.highlight([key])
        api.log(`${key} · preview ${value} · white ${metrics.opticalArea}`)

        return {
          content: [
            { type: 'image' as const, data: render.base64, mimeType: 'image/png' },
            {
              type: 'text' as const,
              text: [
                `pair: ${key}`,
                previewsSinceApply >= 3
                  ? `STOP PREVIEWING. You have previewed ${previewsSinceApply} values ` +
                    `without applying any. Nothing you have done so far has changed the ` +
                    `font. Call set_kern now with the values you have settled on.`
                  : `PREVIEW ONLY — nothing has been applied.`,
                `previewing: ${value} (the applied value is still ${state?.kern ?? 0})`,
                `original: ${state?.original ?? 0}`,
                `optical white: ${metrics.opticalArea}`,
                `narrowest gap: ${metrics.minGap}`,
                metrics.collides ? 'WARNING: the outlines collide.' : '',
                `class ${range.pairClass}, typical ${range.min} to ${range.max}`,
                value !== (state?.kern ?? 0)
                  ? `To keep this value, call set_kern with [{ pair: "${key}", kern: ${value} }].`
                  : '',
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        }
      },
    },
    [ready, font],
  )

  // ---- render_specimen: publishes to the page and answers the agent -----
  useWebMCP(
    {
      name: 'publish_specimen',
      description:
        'Kern is a font-kerning workbench. Write a line at the current kerning ' +
        'values. It is shown on the page, before and after, with every gap that ' +
        'moved marked — and the image comes back to you. A pair can look right ' +
        'alone and still break the rhythm of a word, so check a specimen before ' +
        'calling a batch finished, and again at the end.\n\n' +
        'Cover as many of the pairs you changed as you can — that is what the line ' +
        'is for. Real words are nicer to read than fragments, but coverage matters ' +
        'more than grammar, so do not drop a pair to keep the sentence tidy.',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description:
              'A readable sentence or phrase, up to about 60 characters, chosen so ' +
              'that it contains the pairs you changed. Real language, not a list of ' +
              'letter pairs.',
          },
          note: {
            type: 'string',
            description: 'One line on why this text shows the change. Shown beside it.',
          },
        },
        required: ['text'],
      } as const,
      enabled: ready,
      execute: async ({ text, note }) => {
        api.countCall('publish_specimen')
        const line = text.slice(0, 60)
        const chars = [...line]
        const pairs = api.getPairs()
        const adjacent = chars.slice(0, -1).map((c, i) => ({
          left: c,
          right: chars[i + 1],
          state: pairs.get(`${c}${chars[i + 1]}`),
        }))
        const moved = adjacent.filter((a) => a.state && a.state.kern !== a.state.original)

        api.setSpecimen(line, note)
        api.log(`specimen "${line}" · ${moved.length} changed pairs`)

        const sheet = drawSheet(
          font!,
          adjacent.slice(0, 24).map((a) => ({
            left: a.left,
            right: a.right,
            kern: a.state?.kern ?? 0,
          })),
          6,
        )

        return {
          content: [
            { type: 'image' as const, data: sheet.base64, mimeType: 'image/png' },
            {
              type: 'text' as const,
              text: [
                `Published "${line}" to the page.`,
                moved.length
                  ? `${moved.length} of its pairs have been changed: ${moved
                      .map((m) => m.state!.key)
                      .join(', ')}`
                  : `WARNING: none of its pairs have been changed, so the before and ` +
                    `after lines are identical. Apply values with set_kern first, or ` +
                    `pick words containing pairs you have already changed.`,
                '',
                sheet.cells
                  .map((c) => `${c.left}${c.right}\t${c.kern}\twhite ${c.metrics.opticalArea}`)
                  .join('\n'),
                '',
                'Uneven optical white across a line is what a reader notices.',
                progressLine(api.getPairs()),
              ].join('\n'),
            },
          ],
        }
      },
    },
    [ready, font],
  )

  // ---- set_kern: the only writer --------------------------------------
  useWebMCP(
    {
      name: 'set_kern',
      description:
        'Kern is a font-kerning workbench. Apply kerning values to one or many pairs. This is the only tool that ' +
        'changes anything. Values outside the typical range for a pair’s shape class ' +
        'are rejected individually — the rest of the batch still applies — so fix ' +
        'the rejects and call again rather than forcing.',
      inputSchema: {
        type: 'object',
        properties: {
          pairs: {
            type: 'array',
            description: 'The values to apply.',
            items: {
              type: 'object',
              properties: {
                pair: { type: 'string', description: 'Two characters, e.g. "AV"' },
                kern: { type: 'number', description: 'Value in font units' },
              },
              required: ['pair', 'kern'],
            },
          },
          force: {
            type: 'boolean',
            description:
              'Accept values outside the typical range. Use only when a render ' +
              'clearly justifies it.',
          },
        },
        required: ['pairs'],
      } as const,
      enabled: ready,
      execute: async ({ pairs, force }) => {
        api.countCall('set_kern')
        const updates = pairs
          .filter((p) => [...p.pair].length === 2)
          .map((p) => ({ left: p.pair[0], right: p.pair[1], value: p.kern }))
        if (!updates.length) throw new Error('No valid pairs. Each must be two characters.')

        previewsSinceApply = 0
        const { applied, rejected } = api.applyKerns(updates, Boolean(force))
        api.highlight(updates.map((u) => `${u.left}${u.right}`))

        const lines = [
          `applied ${applied.length} of ${updates.length}`,
          ...applied.map((a) => `  ${a.key}: ${a.from} → ${a.to}`),
        ]
        if (rejected.length) {
          lines.push(`rejected ${rejected.length}:`)
          lines.push(...rejected.map((r) => `  ${r.key}: ${r.reason}`))
          lines.push('Revise the rejected pairs and call set_kern again.')
        }
        return text_(lines.join('\n'))
      },
    },
    [ready, font],
  )

  // ---- compare_to_reference: only exists once there is work to score ---
  useWebMCP(
    {
      name: 'compare_to_reference',
      description:
        'Kern is a font-kerning workbench. Score the current values against the kerning the font shipped with. ' +
        'Only available once at least one pair has been changed.',
      annotations: READ_ONLY,
      inputSchema: { type: 'object', properties: {} } as const,
      enabled: ready && api.hasChanges,
      execute: async () => {
        api.countCall('compare_to_reference')
        const rows = [...api.getPairs().values()].filter((p) => p.original !== 0)
        if (!rows.length) {
          return text_('This font shipped no kerning for these pairs, so there is nothing to score against.')
        }
        const diffs = rows.map((p) => Math.abs(p.kern - p.original))
        const within = (n: number) => diffs.filter((d) => d <= n).length
        const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length
        return text_(
          [
            `Scored against ${rows.length} pairs the designer kerned.`,
            `mean absolute difference: ${mean.toFixed(1)} font units`,
            `within 10 units: ${within(10)} of ${rows.length}`,
            `within 25 units: ${within(25)} of ${rows.length}`,
            `within 50 units: ${within(50)} of ${rows.length}`,
            '',
            ...rows
              .map((p) => ({ p, d: Math.abs(p.kern - p.original) }))
              .sort((a, b) => b.d - a.d)
              .slice(0, 8)
              .map(({ p, d }) => `  ${p.key}: yours ${p.kern}, designer ${p.original} (off by ${d})`),
          ].join('\n'),
        )
      },
    },
    [ready, font, api.hasChanges],
  )
}

/** Shared by the tool and the UI so the rule lives in one place. */
export function checkRange(
  left: string,
  right: string,
  value: number,
  unitsPerEm: number,
): string | null {
  const range = typicalRange(left, right, unitsPerEm)
  if (value >= range.min && value <= range.max) return null
  return (
    `${value} is outside the typical range for ${range.pairClass} pairs ` +
    `(${range.min} to ${range.max})`
  )
}

export { drawPair }
