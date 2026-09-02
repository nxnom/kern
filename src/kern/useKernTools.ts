import { useWebMCPTool } from './useWebMCPTool'
import type { LoadedFont } from './font'
import type { PairMetrics } from './font'
import { drawPair, relativeWhite, renderPair, safeFloor } from './font'
import { drawSheet } from './sheet'
import { typicalRange } from './pairs'
import type { PairState, PairStatus } from './state'

export interface KernApi {
  font: LoadedFont | null
  /** The font loaded right now, which is not always the one a tool captured. */
  getFont: () => LoadedFont | null
  /**
   * Returns the new font's name the first time it is called after a swap, and
   * null thereafter. Every tool trips this once so a stale plan cannot survive
   * a change of typeface unnoticed.
   */
  takeFontChange: () => string | null
  /** Short fingerprint of the loaded font's bytes — the same one sessions are
   *  filed under, so the agent and the page name the face identically. */
  fontId: string | null
  /** Surfaces a refusal to the human as well as to the agent. */
  notify: (message: string) => void
  /** Records that the agent looked at these pairs and decided about them. */
  markReviewed: (keys: string[]) => void
  /**
   * Reports a change of scope once. Advisory, not a stop: the work changed
   * size, and what has been decided is still decided.
   */
  takeScopeChange: () => string | null
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


/** The run is the human's to restart after they change the font mid-work. */
function stopForFontChange(api: KernApi, swapped: string) {
  const message =
    `STOP. The human loaded a different font while you were working. ` +
    `The page now has "${swapped}" (${api.fontId ?? '—'}). Everything you ` +
    `measured belongs to the previous face and none of it applies here.\n\n` +
    `Do not call any more tools and do not start a new survey. End your ` +
    `turn now and tell the user: the font changed, so this run has ` +
    `stopped, and they should ask again if they want "${swapped}" kerned.`
  api.notify(
    `Font changed to ${swapped}. The run was stopped — ask again to kern this font.`,
  )
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

/**
 * Stamped on every response so the agent always knows which face it is holding
 * — and can tell, across a pause or a fresh chat, whether the page still has
 * the one it planned against.
 */
function stamp(api: KernApi, rescoped?: string | null): string {
  const line = `font: ${api.font?.familyName ?? 'none'} (${api.fontId ?? '—'})`
  return rescoped ? `${rescoped}\n\n${line}` : line
}

/** Below this the outlines are effectively touching, in font units at 1000/em. */
const COLLISION_FLOOR = 8

/**
 * What the numbers suggest — never what to do.
 *
 * These read as verdicts once, and an agent applied one value per shape class
 * to seventy-six pairs after previewing three. Area alone cannot tell a wedge
 * from an even gap, or a wide surround from a tight contact point, so the
 * label now says which of those it is looking at and leaves the call open.
 */
function reading(m: PairMetrics, rel: number): string {
  if (m.collides) return 'COLLIDING — do not tighten'
  // A gap several times wider at one end than the other is a wedge: it reads
  // loose to a person however little area it holds.
  const wedge = m.minGap > 0 ? m.maxGap / m.minGap : Infinity
  if (m.minGap <= 12) return 'already touching at its narrowest — tightening will collide'
  if (wedge >= 3) return `wedge-shaped gap (${m.minGap}–${m.maxGap}) — look before deciding`
  if (rel >= 1.4) return 'wide, and evenly so — look'
  if (rel >= 1.15) return 'slightly wide'
  return 'unremarkable by area, which does not mean settled'
}

/**
 * Where the survey has got to.
 *
 * Reviewed, changed and not-yet-reached are three different things. Reporting
 * only the first two let a run stop at sixty of two hundred and sixty-one and
 * describe itself as complete.
 */
function progressLine(pairs: Map<string, PairState>): string {
  const all = [...pairs.values()]
  const changed = all.filter((p) => p.kern !== p.original)
  const reviewed = all.filter((p) => p.reviewedAt)
  const left = all.length - reviewed.length

  if (!reviewed.length) {
    return (
      `None of the ${all.length} pairs has been reviewed yet. Nothing is applied; ` +
      `rendering changes nothing, set_kern does.`
    )
  }
  return (
    `PROGRESS: ${reviewed.length} of ${all.length} reviewed · ` +
    `${changed.length} changed · ${reviewed.length - changed.length} left as they were · ` +
    `${left} NOT YET REACHED.` +
    (left > 0
      ? ` You are not finished. Call survey_pairs with status "unreviewed" for the next sheet.`
      : ` Every pair has been decided.`)
  )
}

/**
 * What an earlier run left behind.
 *
 * Nothing here is remembered — every claim is derived from the pairs as they
 * stand now. A stored "finished" flag would rot the moment a run was
 * interrupted, and a run that touched every pair is not necessarily a good one.
 */
function resumeLine(api: KernApi, font: LoadedFont): string | null {
  const all = [...api.getPairs().values()]
  const touched = all.filter((p) => p.attempts.length > 0 || p.kern !== p.original)
  if (!touched.length) return null

  const byHuman = touched.filter((p) => p.attempts.some((a) => a.by === 'human'))
  // A rejected proposal with nothing after it is a thought that was never
  // finished — the clearest sign a previous run stopped part-way.
  const abandoned = touched.filter((p) => p.attempts.at(-1)?.rejected)
  const loose = all
    .map((p) => ({
      p,
      rel: relativeWhite(font, p.left, renderPair(font, p.left, p.right, p.kern).metrics.opticalArea),
    }))
    .filter(({ rel }) => rel > 1.4)
    .sort((a, b) => b.rel - a.rel)

  const last = Math.max(...touched.map((p) => p.touchedAt ?? 0))
  const mins = last ? Math.round((Date.now() - last) / 60000) : 0

  return [
    `RESUMED SESSION. ${touched.length} of ${all.length} pairs already worked on` +
      (mins > 0 ? `, last touched ${mins} minute(s) ago` : '') + '.',
    byHuman.length
      ? `${byHuman.length} were set by the human by hand — treat those as decided ` +
        `unless they say otherwise: ${byHuman.map((p) => p.key).join(', ')}`
      : '',
    abandoned.length
      ? `${abandoned.length} were rejected and never revisited, so a previous run ` +
        `probably stopped mid-thought: ${abandoned.map((p) => p.key).join(', ')}`
      : '',
    loose.length
      ? `${loose.length} still measure loose regardless of what happened before: ` +
        loose.slice(0, 8).map(({ p, rel }) => `${p.key} ${rel.toFixed(2)}x`).join(', ')
      : `Nothing measures above 1.4x any more.`,
    `A finished run is not necessarily a good one. Judge from the ratios.`,
  ]
    .filter(Boolean)
    .join('\n')
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
export function registeredToolNames(ready: boolean): string[] {
  return ready
    ? [
        'list_pairs',
        'survey_pairs',
        'preview_pair',
        'publish_specimen',
        'set_kern',
        'revert',
      ]
    : []
}

export function useKernTools(api: KernApi) {
  const { font } = api
  const ready = font !== null

  // ---- list_pairs: cheap planning, no image ---------------------------
  useWebMCPTool<{ status?: 'all' | 'unreviewed' | 'untouched' | 'adjusted' | 'rejected' }>(
    {
      name: 'list_pairs',
      description:
        'Kern is a font-kerning workbench. These tools operate on the font file ' +
        'loaded in the app, not on the web page’s own CSS. List the pairs with ' +
        'their current value, status and shape class. The list is generated from ' +
        'this face — every pair in it traps more white than a control pair does — ' +
        'and it is ordered worst first, so the top of the list is where the work ' +
        'is. Text only and cheap: use it to plan which batch to look at next.',
      annotations: READ_ONLY,
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['all', 'unreviewed', 'untouched', 'adjusted', 'rejected'],
            description: 'Filter by status. Defaults to all.',
          },
        },
      } as const,
      enabled: ready,
      execute: async ({ status }) => {
        api.countCall('list_pairs')
        const swapped = api.takeFontChange()
        if (swapped) return stopForFontChange(api, swapped)
        const rescoped = api.takeScopeChange()
        const wanted = (status ?? 'all') as PairStatus | 'all' | 'unreviewed'
        const shown = [...api.getPairs().values()].filter((p) =>
          wanted === 'all'
            ? true
            : wanted === 'unreviewed'
              ? !p.reviewedAt
              : p.status === wanted,
        )
        const rows = shown
          .map(
            (p) =>
              `${p.key}\t${p.kern}\t(was ${p.original})\t${p.status}\t` +
              `${typicalRange(p.left, p.right, font!.unitsPerEm).pairClass}\t` +
              `${p.attempts.length} attempts`,
          )
        api.highlight(shown.map((p) => p.key))
        const resume = resumeLine(api, font!)
        return text_(
          `${stamp(api, rescoped)}\n\n` +
          (resume ? `${resume}\n\n` : '') +
          `pair\tkern\toriginal\tstatus\tclass\tattempts\n${rows.join('\n')}\n\n` +
            `${rows.length} pairs. em = ${font!.unitsPerEm}.\n${progressLine(api.getPairs())}`,
        )
      },
    },
    [ready, font],
  )

  // ---- render_sheet: survey many pairs in one image -------------------
  useWebMCPTool<{ pairs?: string[]; status?: 'all' | 'unreviewed' | 'untouched' | 'adjusted' | 'rejected'; offset?: number; limit?: number; columns?: number }>(
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
            enum: ['all', 'unreviewed', 'untouched', 'adjusted', 'rejected'],
            description:
              'Which pairs to pull when `pairs` is omitted. Use "unreviewed" to ' +
              'walk the list without going over ground twice.',
          },
          offset: { type: 'number', description: 'Skip this many, for paging.' },
          limit: { type: 'number', description: 'How many to show. Default 9, max 12 — the renders are large so you can actually judge them.' },
          columns: { type: 'number', description: 'Sheet columns. Default 4.' },
        },
      } as const,
      enabled: ready,
      execute: async ({ pairs, status, offset, limit, columns }) => {
        api.countCall('survey_pairs')
        const swapped = api.takeFontChange()
        if (swapped) return stopForFontChange(api, swapped)
        const rescoped = api.takeScopeChange()
        const all = api.getPairs()
        let chosen: PairState[]
        if (pairs?.length) {
          chosen = pairs
            .map((k) => all.get(k))
            .filter((p): p is PairState => Boolean(p))
        } else {
          const wanted = (status ?? 'all') as PairStatus | 'all' | 'unreviewed' | 'unreviewed'
          chosen = [...all.values()].filter((p) =>
            wanted === 'all'
              ? true
              : wanted === 'unreviewed'
                ? !p.reviewedAt
                : p.status === wanted,
          )
        }
        const start = Math.max(0, offset ?? 0)
        const take = Math.min(12, Math.max(1, limit ?? 9))
        chosen = chosen.slice(start, start + take)

        if (!chosen.length) return text_('No pairs match that filter.')

        const sheet = drawSheet(
          font!,
          chosen.map((p) => ({ left: p.left, right: p.right, kern: p.kern })),
          columns ?? 3,
        )
        api.highlight(chosen.map((p) => p.key))
        api.log(`sheet · ${chosen.length} pairs (${chosen[0].key}…${chosen.at(-1)!.key})`)

        const rows = sheet.cells.map((c) => ({
          c,
          rel: relativeWhite(font!, c.left, c.metrics.opticalArea),
        }))
        const table = rows
          .map(
            ({ c, rel }) =>
              `${c.left}${c.right}\t${c.kern}\t${rel.toFixed(2)}x` +
              `\t${c.metrics.minGap}–${c.metrics.maxGap}\t${reading(c.metrics, rel)}`,
          )
          .join('\n')
        const worst = [...rows]
          .sort((a, b) => b.rel - a.rel)
          .slice(0, 5)
          .filter(({ rel }) => rel > 1.35)

        return {
          content: [
            { type: 'image' as const, data: sheet.base64, mimeType: 'image/png' },
            {
              type: 'text' as const,
              text:
                `${stamp(api, rescoped)}\n\n` +
                `${sheet.cells.length} pairs, ${sheet.columns} columns, ` +
                `reading left to right.\n\n` +
                `ratio = this pair's trapped white over a control pair's (HH for ` +
                `caps, nn for lowercase). gap = narrowest–widest distance between ` +
                `the outlines.\n\n` +
                `READ THE PICTURE, NOT THE TABLE. The numbers shortlist; they do ` +
                `not decide. Area is a poor judge on its own: a wedge that is ` +
                `narrow at one end and wide at the other reads loose while ` +
                `measuring near 1.00x, and a pair whose surround is open but whose ` +
                `contact point is tight measures high and must not be closed. ` +
                `A control like HH cannot speak for an overhang like T or V.\n\n` +
                `Never apply one value across a shape class. Preview every pair ` +
                `you intend to change, or change only the ones you previewed.\n\n` +
                `HOW TO WORK THROUGH THIS WITHOUT IT TAKING ALL DAY:\n` +
                `1. Screen with sheets, not previews. Walk the whole list with ` +
                `status "unreviewed" before you change anything, so you know what ` +
                `is there.\n` +
                `2. On each sheet, name the two or three worth a closer look. ` +
                `Everything else on that sheet goes in set_kern's "keep" list — ` +
                `that is how a pair counts as decided rather than unreached.\n` +
                `3. Preview shortlisted pairs with "values": [-40,-60,-80] to see ` +
                `candidates side by side. One call, not three.\n` +
                `4. Apply in batches with "keep" alongside, then move on.\n` +
                `Being later in the list does not mean a pair is fine. The order ` +
                `is by trapped white, which is exactly the measure that misses ` +
                `wedges like Vo and Tr.\n\n` +
                `pair\tkern\tratio\tgap\tnotes\n${table}\n\n` +
                (worst.length
                  ? `Worst first: ${worst
                      .map(({ c, rel }) => `${c.left}${c.right} (${rel.toFixed(2)}x)`)
                      .join(', ')}. Start there.\n\n`
                  : `Nothing here is far from the control.\n\n`) +
                progressLine(api.getPairs()),
            },
          ],
        }
      },
    },
    [ready, font],
  )

  // ---- render_pair: zoom in on one -----------------------------------
  useWebMCPTool<{
    left: string
    right: string
    kern?: number
    values?: number[]
  }>(
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
          values: {
            type: 'array',
            items: { type: 'number' },
            description:
              'Up to four values to see side by side, e.g. [-40,-60,-80]. One call ' +
              'instead of three — use this rather than previewing one value at a time.',
          },
        },
        required: ['left', 'right'],
      } as const,
      enabled: ready,
      execute: async ({ left, right, kern, values }) => {
        api.countCall('preview_pair')
        const swapped = api.takeFontChange()
        if (swapped) return stopForFontChange(api, swapped)
        const rescoped = api.takeScopeChange()
        if ([...left].length !== 1 || [...right].length !== 1) {
          throw new Error('left and right must each be exactly one character.')
        }
        const key = `${left}${right}`
        const state = api.getPairs().get(key)
        const value = kern ?? state?.kern ?? 0
        const range = typicalRange(left, right, font!.unitsPerEm)

        previewsSinceApply += 1

        // Several candidates in one sheet: previewing them one at a time was
        // three round trips to answer one question.
        if (values?.length) {
          const wanted = values.slice(0, 4)
          const sheet = drawSheet(
            font!,
            wanted.map((v) => ({ left, right, kern: v })),
            wanted.length,
          )
          api.markReviewed([key])
          api.highlight([key])
          api.log(`${key} · previewing ${wanted.join(', ')}`)
          return {
            content: [
              { type: 'image' as const, data: sheet.base64, mimeType: 'image/png' },
              {
                type: 'text' as const,
                text: [
                  stamp(api, rescoped),
                  '',
                  `${key} at ${wanted.join(', ')} — left to right.`,
                  `tightest safe value: ${safeFloor(font!, left, right)}`,
                  ...sheet.cells.map(
                    (c) =>
                      `${c.kern}\tgap ${c.metrics.minGap}–${c.metrics.maxGap}` +
                      `${c.metrics.collides ? '\tCOLLIDES' : ''}`,
                  ),
                  '',
                  'PREVIEW ONLY. Apply the one you chose with set_kern.',
                ].join('\n'),
              },
            ],
          }
        }

        const { render, metrics } = renderPair(font!, left, right, value)
        api.markReviewed([key])
        api.highlight([key])
        api.log(`${key} · preview ${value} · white ${metrics.opticalArea}`)

        return {
          content: [
            { type: 'image' as const, data: render.base64, mimeType: 'image/png' },
            {
              type: 'text' as const,
              text: [
                stamp(api, rescoped),
                '',
                `pair: ${key}`,
                `tightest safe value: ${safeFloor(font!, left, right)} — past this ` +
                  `the outlines touch and set_kern will refuse`,
                previewsSinceApply >= 3
                  ? `STOP PREVIEWING. You have previewed ${previewsSinceApply} values ` +
                    `without applying any. Nothing you have done so far has changed the ` +
                    `font. Call set_kern now with the values you have settled on.`
                  : `PREVIEW ONLY — nothing has been applied.`,
                `previewing: ${value} (the applied value is still ${state?.kern ?? 0})`,
                `original: ${state?.original ?? 0}`,
                `trapped white: ${relativeWhite(font!, left, metrics.opticalArea).toFixed(2)}x ` +
                  `a control pair (1.00x is normal, above 1.4x is loose)`,
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
  useWebMCPTool<{ text: string; note?: string }>(
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
        const swapped = api.takeFontChange()
        if (swapped) return stopForFontChange(api, swapped)
        const rescoped = api.takeScopeChange()
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
        api.highlight(moved.map((m) => m.state!.key))
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
                ...(rescoped ? [rescoped, ''] : []),
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

  // ---- revert: back out of a decision ---------------------------------
  useWebMCPTool<{ pairs?: string[]; all?: boolean }>(
    {
      name: 'revert',
      description:
        'Kern is a font-kerning workbench. Put pairs back to the value the font ' +
        'shipped with. Use it when a change made the rhythm worse, or to clear a ' +
        'line of work and start it again. Reverting is not failure — it is cheaper ' +
        'than guessing another value on top of a bad one.',
      inputSchema: {
        type: 'object',
        properties: {
          pairs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Pairs to put back, e.g. ["AV","To"].',
          },
          all: {
            type: 'boolean',
            description: 'Put every pair you changed back. Ignores `pairs`.',
          },
        },
      } as const,
      enabled: ready,
      execute: async ({ pairs, all }) => {
        api.countCall('revert')
        const swapped = api.takeFontChange()
        if (swapped) return stopForFontChange(api, swapped)
        const rescoped = api.takeScopeChange()

        const state = api.getPairs()
        const targets = all
          ? [...state.values()].filter((p) => p.kern !== p.original)
          : (pairs ?? [])
              .map((k) => state.get(k))
              .filter((p): p is NonNullable<typeof p> => Boolean(p))

        if (!targets.length) {
          return text_('Nothing to revert: none of those pairs differ from the font.')
        }

        const { applied } = api.applyKerns(
          targets.map((p) => ({ left: p.left, right: p.right, value: p.original })),
          true,
        )
        api.highlight(targets.map((p) => p.key))
        return text_(
          `${stamp(api, rescoped)}\n\nReverted ${applied.length} pair(s) to the font's own ` +
            `values: ${applied.map((a) => `${a.key} → ${a.to}`).join(', ')}`,
        )
      },
    },
    [ready, font],
  )

  // ---- set_kern: the only writer --------------------------------------
  useWebMCPTool<{
    pairs: { pair: string; kern: number }[]
    keep?: string[]
    force?: boolean
  }>(
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
          keep: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Pairs you looked at and are deliberately leaving as they are, e.g. ' +
              '["HI","nn"]. Marks them reviewed so the survey can tell them apart ' +
              'from pairs nobody has reached yet. Costs nothing — send it with ' +
              'every batch.',
          },
          force: {
            type: 'boolean',
            description:
              'Accept values outside the typical range. Use only when a render ' +
              'clearly justifies it.',
          },
        },
      } as const,
      enabled: ready,
      execute: async ({ pairs, keep, force }) => {
        api.countCall('set_kern')
        const swapped = api.takeFontChange()
        if (swapped) return stopForFontChange(api, swapped)
        const rescoped = api.takeScopeChange()
        // A call already in flight when the swap happened still holds the old
        // font, which the epoch check cannot see.
        if (api.getFont() !== font) {
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `STOP. This call was made against "${font!.familyName}", but the ` +
                  `page now has "${api.getFont()?.familyName ?? 'no font'}". Nothing ` +
                  `was applied. End your turn and tell the user the font changed ` +
                  `mid-run, so this one has stopped.`,
              },
            ],
            isError: true,
          }
        }
        const updates = pairs
          .filter((p) => [...p.pair].length === 2)
          .map((p) => ({ left: p.pair[0], right: p.pair[1], value: p.kern }))
        if (!updates.length) throw new Error('No valid pairs. Each must be two characters.')

        previewsSinceApply = 0
        // The measurement warned about tight contact points; refusing here is
        // what stops that warning from being ignored. `f)` traps a lot of white
        // around a join that is already closed, so its ratio invites exactly
        // the change that ruins it.
        const collides: Rejected[] = []
        const safe = updates.filter((u) => {
          if (force) return true
          const before = renderPair(font!, u.left, u.right, u.value).metrics
          if (before.minGap > COLLISION_FLOOR && !before.collides) return true
          collides.push({
            key: `${u.left}${u.right}`,
            value: u.value,
            reason:
              `at ${u.value} the outlines come within ${before.minGap} units` +
              `${before.collides ? ' and overlap' : ''}. The white this pair traps ` +
              `sits around the join, not in it — closing it makes the contact ` +
              `worse. Preview it before forcing.`,
          })
          return false
        })

        const { applied, rejected } = api.applyKerns(safe, Boolean(force))
        rejected.push(...collides)
        api.highlight(updates.map((u) => `${u.left}${u.right}`))

        if (keep?.length) api.markReviewed(keep)

        const lines = [
          stamp(api, rescoped),
          '',
          `applied ${applied.length} of ${updates.length}`,
          keep?.length ? `left ${keep.length} reviewed and unchanged` : '',
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
