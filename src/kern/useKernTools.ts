import { useWebMCPTool } from './useWebMCPTool'
import type { LoadedFont } from './font'
import type { PairMetrics } from './font'
import { drawPair, drawSpecimen, measurePair, nearUnits, renderPair, safeFloor } from './font'
import { SHEET_SIZES, drawSheet } from './sheet'
import type { SheetSize } from './sheet'
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
  /**
   * Writes the kerned font to the reader's disk.
   *
   * No confirmation step, by design. A dialog that blocks the call hangs the
   * agent on a human who may be away; one that does not block is just noise on
   * the page. The guard belongs in the tool description instead: this runs only
   * when the reader has actually asked for a file.
   */
  exportFont: () => { filename: string; bytes: number; pairs: number }
}

export interface Applied { key: string; from: number; to: number }
export interface Rejected { key: string; value: number; reason: string }

const text_ = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })
/**
 * The only annotation these tools need.
 *
 * WebMCP defines exactly two — `readOnlyHint` and `untrustedContentHint` — and
 * `idempotentHint`/`openWorldHint` are MCP server hints that the browser API
 * does not carry. Everything a client should know about running these
 * concurrently is therefore said in the description, because there is nowhere
 * structural to put it.
 */
/**
 * Every reply carries the loaded font's family name, and that string comes out
 * of the name table of a file the reader handed us. A font can be built with
 * anything in there, including text shaped like instructions, so the payload is
 * labelled untrusted on every tool. `sanitise` below is the other half: the
 * label warns the agent, the trim removes the means.
 */
const UNTRUSTED = { untrustedContentHint: true }
const READ_ONLY = { readOnlyHint: true, ...UNTRUSTED }


/**
 * Said once, on the FIRST tool call of a session, whichever tool that is.
 *
 * WebMCP gives a page no way to say anything except through a tool.
 * `ModelContext` has four members — registerTool, getTools, executeTool and
 * ontoolchange — and none of its seven dictionaries carries page-level context.
 * MCP one layer down does have somewhere to put this: its initialize response
 * returns an `instructions` field, described there as optional instructions for
 * the client. A WebMCP page cannot populate it.
 *
 * So the doctrine rides along with something the agent already calls. Tying it
 * to the first survey meant a run that opened with list_pairs got it late, and
 * one that jumped straight to preview_pairs never got it at all. Every tool
 * stamps its reply, so every tool delivers it — moving it here took a full run
 * from about 4m17s to 2m34s.
 *
 * A dedicated `help` tool would be the obvious alternative, and the wrong one:
 * nothing obliges an agent to call it, and the guidance an agent skips is
 * exactly the guidance it needed.
 */
let guidanceGiven = false
export function resetGuidance() {
  guidanceGiven = false
}

const WORKFLOW = [
  'HOW TO GET THROUGH THIS QUICKLY:',
  '1. Screen the whole list first — status "unreviewed", detail "screen", 36 at',
  '   a time — before changing anything.',
  '2. The read tools are SAFE TO RUN CONCURRENTLY. Send as many as you like in',
  '   one turn. None of them changes the font, and the session state they touch',
  '   is additive — previews recorded, pairs marked as looked at — so parallel',
  '   calls cannot corrupt each other or land in a wrong order. Only the',
  '   sequence preview -> judge -> apply has to stay in order, because each',
  '   step needs the one before it. Everything else should go at once: the',
  '   waiting is most of the time a run takes.',
  '3. A sheet is looking. If several pairs sit together on one you have seen',
  '   and their geometry agrees, decide them together — what ruins a font is',
  '   applying a value to pairs you never saw, not applying one to a group you',
  '   did.',
  '4. Use preview_pairs to compare candidates: several pairs, several values,',
  '   one sheet.',
  '5. Apply in batches, and send "keep" alongside for the ones you looked at',
  '   and are leaving — that is what marks them decided rather than unreached.',
].join('\n')

/**
 * Values to show when the caller does not name any.
 *
 * These used to be `[0, floor/2, floor]`, and the floor is always negative, so
 * every candidate offered was zero or tighter. An agent shown only those
 * options concluded that `f)` was fine at 0 — the direction it needed, +20,
 * was never on the sheet. Where a pair's class allows opening, the default
 * spread now crosses zero.
 */
function defaultCandidates(lf: LoadedFont, left: string, right: string): number[] {
  const floor = safeFloor(lf, left, right)
  const { min, max } = typicalRange(left, right, lf.unitsPerEm)
  // Never propose past a collision, and never lead with the floor: it is a
  // limit, and offering it as a candidate invites the over-tightening it is
  // supposed to prevent.
  const lo = Math.max(min, floor)

  // Spend the four slots where the pair actually lives. `AT` sits in a class
  // running -120..+40, and leading with +40 spent a slot on a direction the
  // pair does not want. Offer the positive end only where the class leans that
  // way — brackets after an f, straight-sided pairs — and otherwise start at 0.
  const top = max > 0 && max >= Math.abs(min) ? max : Math.min(max, 0)

  // Weighted toward the near end, not spread evenly. Four equal steps across
  // a -110..+10 class meant 40-unit jumps, so the useful -20 and -40 were never
  // offered and 0 looked like the only restrained choice. Real kerning clusters
  // near the light end of a class, so the candidates do too.
  const span = top - lo
  const round5 = (n: number) => Math.round(n / 5) * 5
  const out = [0, 0.2, 0.45, 0.8].map((t) => round5(top - span * t))

  // Keep zero on the sheet when it is legal — it is the reference every other
  // cell is judged against — but put it in place of the value NEAREST zero, not
  // a fixed slot. Overwriting slot 2 threw away -65 from AT's spread and left
  // nothing between -15 and -120, which is exactly the range the pair wanted.
  if (lo <= 0 && top >= 0 && !out.includes(0)) {
    let nearest = 0
    for (let i = 1; i < out.length; i++) {
      if (Math.abs(out[i]) < Math.abs(out[nearest])) nearest = i
    }
    out[nearest] = 0
  }
  return [...new Set(out)].sort((a, b) => b - a).slice(0, 4)
}

/**
 * What to call a pair's state when talking to the agent.
 *
 * The stored status is derived from the value alone, so a pair sent through
 * `keep` — looked at and deliberately left — still read as "untouched" while
 * the progress line counted it as reviewed. Two names for one thing, and the
 * agent noticed. The page keeps its own labels; this one is for the tools.
 */
function statusLabel(p: PairState): string {
  if (p.status === 'untouched' && p.reviewedAt) return 'reviewed-unchanged'
  return p.status
}

/**
 * Which way a shape class usually goes.
 *
 * Read straight off the calibrated range, so it is a statement about the class
 * rather than an opinion about the pair. Agents arrive assuming kerning means
 * tightening, and for `f)` \u2014 whose range runs -20..+60 \u2014 that assumption
 * kept landing on 0 when the pair wanted opening.
 */
function classLeaning(lf: LoadedFont, left: string, right: string): string {
  const { min, max } = typicalRange(left, right, lf.unitsPerEm)
  // Weak on purpose. It is a prior drawn from one calibration face, and it was
  // wrong for `f)` in a casual font — so it must not read as a recommendation.
  if (max > 0 && Math.abs(max) > Math.abs(min)) {
    return 'this class often opens (weak hint — the render decides)'
  }
  if (max <= 0) return ''
  return ''
}

/** Counts previews since the last write, so the nudge can escalate. */
let previewsSinceApply = 0

/**
 * Values the agent has actually looked at, per pair.
 *
 * A value that has been previewed and judged should not then be refused for
 * sitting outside a shape class's usual range — the range is a guess about
 * pairs in general, and the render is evidence about this one. Refusing after
 * previewing cost a second call and, worse, taught the agent to ask permission.
 */
const previewed = new Map<string, Set<number>>()

function notePreview(key: string, value: number) {
  const seen = previewed.get(key) ?? new Set<number>()
  seen.add(value)
  previewed.set(key, seen)
}

export function forgetPreviews() {
  previewed.clear()
}
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
/**
 * A font's name, made safe to repeat.
 *
 * Line breaks are what turn an echoed string into what looks like a new
 * instruction, so they go, along with anything else non-printing, and the
 * result is capped. A name table is not a place to take dictation from.
 */
function sanitise(name: string | undefined | null): string {
  if (!name) return 'none'
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 64) || 'none'
}

function stamp(api: KernApi, rescoped?: string | null): string {
  const line = `font: ${sanitise(api.font?.familyName)} (${api.fontId ?? '—'})`
  const head = rescoped ? `${rescoped}\n\n${line}` : line
  if (guidanceGiven) return head
  guidanceGiven = true
  return `${WORKFLOW}\n\n${head}`
}

/**
 * How much of the facing height must be in contact before a value is refused.
 *
 * The guard used to refuse on the minimum gap alone, which treated a serif tip
 * grazing its neighbour exactly like two outlines crashing. In a serif face
 * that is most of the pairs worth kerning — `LV`, `YA`, `TA` — so the agent
 * had to ask a human to force through work it had already previewed and judged.
 * A graze is fine. A crash is not.
 */
const CRASH_CONTACT = 0.3
/** Below this, contact is a serif tip rather than anything to worry about. */
const SERIF_GRAZE = 0.08

/**
 * What the geometry can honestly say: whether tightening this pair is safe.
 *
 * Nothing here judges quality. Reporting a ratio and calling it "still loose"
 * gave the agent a number to satisfy, and it satisfied it — tightening `f)`
 * until the outlines met, because each step improved the figure the tool kept
 * showing it. Only the picture can judge spacing; the numbers exist to stop
 * the agent doing something it cannot undo.
 */
type Risk = 'clear' | 'tight' | 'very tight' | 'touching' | 'crash'

/** Contact is a risk, never a score. */
function risk(lf: LoadedFont, m: PairMetrics): { risk: Risk; why: string } {
  const where =
    m.contactAt < 0.35 ? 'up top' : m.contactAt > 0.7 ? 'at the foot' : 'mid-height'
  const near = nearUnits(lf)

  if (m.collides || m.contact >= CRASH_CONTACT) {
    return {
      risk: 'crash',
      why: `outlines meet across ${Math.round(m.contact * 100)}% of the height ${where}`,
    }
  }
  // A couple of per cent is a serif tip meeting its neighbour, which is
  // ordinary in a serif face. Calling that "touching" read as a warning and
  // talked the agent out of kerning `AT` at all.
  if (m.contact >= SERIF_GRAZE) {
    return {
      risk: 'touching',
      why: `touching ${Math.round(m.contact * 100)}% ${where} — look before tightening`,
    }
  }
  if (m.contact > 0) {
    return {
      risk: m.minGap < near * 2 ? 'tight' : 'clear',
      why:
        `serif tips graze ${Math.round(m.contact * 100)}% ${where} — normal in a ` +
        `serif face, and not a reason to leave the pair alone`,
    }
  }
  // The tier that was missing. Outlines that do not intersect can still be far
  // too close to read, and reporting only contact meant the gap between "fine"
  // and "crash" was invisible — so `f)` and `f]` were tightened into their
  // brackets while the tool reported no contact at every value offered.
  if (m.minGap < near) {
    return { risk: 'very tight', why: `only ${m.minGap} units clear ${where} — do not close this further` }
  }
  if (m.minGap < near * 2) {
    return { risk: 'tight', why: `${m.minGap} units clear ${where} — little room left` }
  }
  return { risk: 'clear', why: `${m.minGap} units clear ${where}` }
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
  // Counted as sets that actually overlap, not by subtracting one total from
  // another: a changed-but-unreviewed pair used to make this print a negative.
  const reviewed = all.filter((p) => p.reviewedAt || p.kern !== p.original)
  const changed = reviewed.filter((p) => p.kern !== p.original)
  const kept = reviewed.length - changed.length
  const left = all.length - reviewed.length

  if (!reviewed.length) {
    return (
      `None of the ${all.length} pairs has been reviewed yet. Nothing is applied; ` +
      `rendering changes nothing, set_kern does.`
    )
  }
  return (
    `PROGRESS: ${reviewed.length} of ${all.length} reviewed · ` +
    `${changed.length} changed · ${kept} left as they were · ` +
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
function resumeLine(api: KernApi): string | null {
  const all = [...api.getPairs().values()]
  const touched = all.filter((p) => p.attempts.length > 0 || p.kern !== p.original)
  if (!touched.length) return null

  const byHuman = touched.filter((p) => p.attempts.some((a) => a.by === 'human'))
  // A rejected proposal with nothing after it is a thought that was never
  // finished — the clearest sign a previous run stopped part-way.
  const abandoned = touched.filter((p) => p.attempts.at(-1)?.rejected)
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
    `A run that touched every pair is not the same as a good one. Survey what ` +
      `is left and look at it before deciding anything.`,
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
        'preview_pairs',
        'publish_specimen',
        'set_kern',
        'revert',
        'export_font',
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
        'Kern is a font-kerning workbench. ' +
        'SAFE TO RUN CONCURRENTLY — send as many as you like in one turn.' +
        ' These tools operate on the font file ' +
        'loaded in the app, not on the web page’s own CSS. List the pairs with ' +
        'their current value, status and shape class. The list is the classic ' +
        'families every face needs kerned — which are here whatever they measure — ' +
        'followed by whatever else this face traps unusual white in, worst first. ' +
        'Being late in it means little: the ordering is by area, which is the ' +
        'measure that misses wedges. Text only and cheap: use it to plan.',
      // Read-only and independent of every other read tool: the client is free
      // to run several of these in one turn. Waiting for each in turn was most
      // of the wall-clock time of a run.
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
              `${p.key}\t${p.kern}\t(was ${p.original})\t${statusLabel(p)}\t` +
              `${typicalRange(p.left, p.right, font!.unitsPerEm).pairClass}\t` +
              `${p.attempts.length} attempts`,
          )
        api.highlight(shown.map((p) => p.key))
        const resume = resumeLine(api)
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
  useWebMCPTool<{
    pairs?: string[]
    status?: 'all' | 'unreviewed' | 'untouched' | 'adjusted' | 'rejected'
    detail?: 'screen' | 'judge'
    offset?: number
    limit?: number
    columns?: number
  }>(
    {
      name: 'survey_pairs',
      description:
        'Kern is a font-kerning workbench. ' +
        'SAFE TO RUN CONCURRENTLY — send as many as you like in one turn.' +
        ' Use these tools rather than screenshots or the DOM — the page cannot be kerned by CSS. Render up to 36 pairs to screen, or 12 large enough to judge, onto one labelled contact sheet and return it ' +
        'with a metrics table. This is the fast way to work: survey a batch, find ' +
        'the two or three that look wrong, then zoom in with preview_pair. Prefer ' +
        'this over calling preview_pair repeatedly.',
      // Read-only and independent of every other read tool: the client is free
      // to run several of these in one turn. Waiting for each in turn was most
      // of the wall-clock time of a run.
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
          detail: {
            type: 'string',
            enum: ['screen', 'judge'],
            description:
              'screen: 36 small pairs at a time, for walking the list and finding ' +
              'what deserves a look. judge: 12 large ones, where a serif meeting ' +
              'its neighbour is visible and a value can actually be decided. ' +
              'Screen first, judge second. Defaults to screen.',
          },
          limit: {
            type: 'number',
            description: 'How many to show. Capped by detail: 36 screening, 12 judging.',
          },
          columns: { type: 'number', description: 'Sheet columns. Default 4.' },
        },
      } as const,
      enabled: ready,
      execute: async ({ pairs, status, offset, limit, columns, detail }) => {
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
        const size: SheetSize = detail === 'judge' ? 'judge' : 'screen'
        const cap = SHEET_SIZES[size].max
        const take = Math.min(cap, Math.max(1, limit ?? cap))
        chosen = chosen.slice(start, start + take)

        if (!chosen.length) return text_('No pairs match that filter.')

        const sheet = drawSheet(
          font!,
          chosen.map((p) => ({ left: p.left, right: p.right, kern: p.kern })),
          columns ?? (size === 'screen' ? 6 : 3),
          size,
          // Screening is triage — "which of these deserves a look" — and the
          // flanking letters cost a column of density to answer a question
          // triage does not ask. Deciding is where company matters.
          size === 'judge',
        )
        api.highlight(chosen.map((p) => p.key))
        api.log(`sheet · ${chosen.length} pairs (${chosen[0].key}…${chosen.at(-1)!.key})`)

        const table = sheet.cells
          .map((c) => {
            const r = risk(font!, c.metrics)
            const lean = classLeaning(font!, c.left, c.right)
            return (
              `${c.left}${c.right}\t${c.kern}\t` +
              `${safeFloor(font!, c.left, c.right)}\t${r.risk}\t` +
              `${[lean, r.why].filter(Boolean).join(' — ')}`
            )
          })
          .join('\n')
        const risky = sheet.cells.filter((c) => {
      const t = risk(font!, c.metrics).risk
      return t !== 'clear' && t !== 'tight'
    })

        return {
          content: [
            { type: 'image' as const, data: sheet.base64, mimeType: 'image/png' },
            {
              type: 'text' as const,
              text:
                `${stamp(api, rescoped)}\n\n` +
                `${sheet.cells.length} pairs, ${sheet.columns} columns, ` +
                `reading left to right.\n` +
                (sheet.narrowedFrom
                  ? `(You asked for ${sheet.narrowedFrom} columns; ${sheet.columns} ` +
                    `is the most that fits before the image is scaled down and ` +
                    `detail is lost.)\n`
                  : '') +
                `\n` +
                `Each cell stands the pair between grey control letters. Judge the black pair; the grey is company, ` +
                `not part of the pair — a pair can look settled alone and wrong ` +
                `with a neighbour on each side.\n\n` +
                `THE PICTURE DECIDES. Look at the sheet and judge the spacing by ` +
                `eye. The table below says only what would break — nothing in it ` +
                `tells you whether a pair looks right, because no measurement can.\n\n` +
                `collision_floor = the negative value at which the outlines meet. ` +
                `A hard limit, NOT a recommendation, and not a direction: plenty ` +
                `of pairs want opening, so a positive value is always available.\n` +
                `"clear" means nothing is colliding. It does NOT mean the pair is ` +
                `optically balanced — only the picture can tell you that.\n` +
                `risk = what is already touching, if anything.\n\n` +
                `pair\tkern\tcollision_floor\trisk\twhere\n${table}\n\n` +
                (risky.length
                  ? `Touching already: ${risky
                      .map((c) => `${c.left}${c.right}`)
                      .join(', ')} — tighten these only if the render says so.\n\n`
                  : '') +
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
        'Kern is a font-kerning workbench. ' +
        'SAFE TO RUN CONCURRENTLY — send as many as you like in one turn.' +
        ' PREVIEW ONLY — this changes nothing. Render a single pair large at a given ' +
        'kerning value and return the image with its measurements. Use it after ' +
        'survey_pairs when one pair needs a closer look. Once you are happy with a ' +
        'value you MUST call set_kern to actually apply it; previewing alone leaves ' +
        'the font untouched.',
      // Read-only and independent of every other read tool: the client is free
      // to run several of these in one turn. Waiting for each in turn was most
      // of the wall-clock time of a run.
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
          const floor = safeFloor(font!, left, right)
          // Include the boundary unasked: it is the value most likely to be
          // wanted next, and finding it cost a second call every time.
          const wanted = [...new Set([...values.slice(0, 4), floor])].sort((a, b) => b - a)
          const sheet = drawSheet(
            font!,
            wanted.map((v) => ({ left, right, kern: v })),
            wanted.length,
            'judge',
            // No control letters here. Company helps when comparing DIFFERENT
            // pairs; in a row of candidate values for the SAME pair the flanks
            // are identical in every cell, so they only add width — enough that
            // a four-value row no longer fitted and wrapped onto the next line.
            false,
          )
          for (const v of wanted) notePreview(key, v)
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
                  `${floor} is where the outlines meet — a limit, not a suggestion.`,
                  ...sheet.cells.map(
                    (c) =>
                      `${c.kern}\tgap ${c.metrics.minGap}–${c.metrics.maxGap}` +
                      `\ttouching over ${Math.round(c.metrics.contact * 100)}% of the height` +
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
        notePreview(key, value)
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
                `collision_floor: ${safeFloor(font!, left, right)} — where the outlines ` +
                  `meet and set_kern refuses. A limit in one direction only; this pair ` +
                  `may well want a positive value instead.`,
                previewsSinceApply >= 3
                  ? `STOP PREVIEWING. You have previewed ${previewsSinceApply} values ` +
                    `without applying any. Nothing you have done so far has changed the ` +
                    `font. Call set_kern now with the values you have settled on.`
                  : `PREVIEW ONLY — nothing has been applied.`,
                `previewing: ${value} (the applied value is still ${state?.kern ?? 0})`,
                `original: ${state?.original ?? 0}`,
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
        'Kern is a font-kerning workbench. ' +
        ' Write a line at the current kerning ' +
        'values. It is shown on the page, before and after, with every gap that ' +
        'moved marked — and the image comes back to you. A pair can look right ' +
        'alone and still break the rhythm of a word, so check a specimen before ' +
        'calling a batch finished, and again at the end.\n\n' +
        'Cover as many of the pairs you changed as you can — that is what the line ' +
        'is for. Real words are nicer to read than fragments, but coverage matters ' +
        'more than grammar, so do not drop a pair to keep the sentence tidy.',
      annotations: UNTRUSTED,
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
        // Distinct pairs, not occurrences: a line holding `ow` twice reported
        // eleven changed pairs when it covered ten.
        const moved = [
          ...new Map(
            adjacent
              .filter((a) => a.state && a.state.kern !== a.state.original)
              .map((a) => [a.state!.key, a]),
          ).values(),
        ]

        api.setSpecimen(line, note)
        api.highlight(moved.map((m) => m.state!.key))
        api.log(`specimen "${line}" · ${moved.length} changed pairs`)

        // A real line, not the line cut into pair cells: this is the only view
        // that shows whether a value survives being read.
        const image = drawSpecimen(font!, line, (l, r) => pairs.get(`${l}${r}`)?.kern ?? 0)

        return {
          content: [
            { type: 'image' as const, data: image.base64, mimeType: 'image/png' },
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
                `image ${Math.round((image.base64.length * 3) / 4 / 1024)} KB`,
                'The same line twice: as the font ships, then as it stands now.',
                'This is the check that matters — a value can look right on its',
                'own and still break the rhythm of a word.',
                progressLine(api.getPairs()),
              ].join('\n'),
            },
          ],
        }
      },
    },
    [ready, font],
  )

  // ---- preview_pairs: many pairs, many values, one call ---------------
  useWebMCPTool<{
    pairs: { pair: string; values: number[] }[]
  }>(
    {
      name: 'preview_pairs',
      description:
        'Kern is a font-kerning workbench. ' +
        'SAFE TO RUN CONCURRENTLY — send as many as you like in one turn.' +
        ' Compare several pairs at several ' +
        'candidate values in ONE sheet — one row per pair, one column per value, ' +
        'each cell labelled. Use this instead of calling preview_pair over and ' +
        'over: a run that previewed twenty-six pairs one at a time took nine ' +
        'minutes, and most of it was waiting. Everything shown here counts as ' +
        'previewed, so set_kern will accept these values without arguing about ' +
        'the shape-class range.',
      // Read-only and independent of every other read tool: the client is free
      // to run several of these in one turn. Waiting for each in turn was most
      // of the wall-clock time of a run.
      annotations: READ_ONLY,
      inputSchema: {
        type: 'object',
        properties: {
          pairs: {
            type: 'array',
            description: 'Up to 8 pairs, each with up to 4 values.',
            items: {
              type: 'object',
              properties: {
                pair: { type: 'string', description: 'Two characters, e.g. "AV"' },
                values: {
                  type: 'array',
                  items: { type: 'number' },
                  description:
                    'Values to compare. Omit to get 0, a moderate value and the ' +
                    'a spread across the pair class range, which may include ' +
                    'positive values.',
                },
              },
              required: ['pair'],
            },
          },
        },
        // Nothing is required: `keep` alone is a valid call.
        required: [],
      } as const,
      enabled: ready,
      execute: async ({ pairs }) => {
        api.countCall('preview_pairs')
        const swapped = api.takeFontChange()
        if (swapped) return stopForFontChange(api, swapped)
        const rescoped = api.takeScopeChange()

        const wanted = pairs.slice(0, 8).filter((p) => [...p.pair].length === 2)
        if (!wanted.length) throw new Error('Give at least one two-character pair.')

        const columns = Math.max(
          ...wanted.map((p) => Math.min(4, p.values?.length || 4)),
        )
        const rows = wanted.map((p) => {
          const [left, right] = [...p.pair]
          const floor = safeFloor(font!, left, right)
          const values = (p.values?.length
            ? p.values.slice(0, columns)
            : defaultCandidates(font!, left, right)
          ).slice(0, columns)
          // Pad so every row starts in the same column — but with values not
          // already shown. Repeating the last one spent a cell saying nothing.
          for (const v of defaultCandidates(font!, left, right)) {
            if (values.length >= columns) break
            if (!values.includes(v)) values.push(v)
          }
          while (values.length < columns) values.push(values[values.length - 1])
          return { left, right, floor, values }
        })

        const sheet = drawSheet(
          font!,
          rows.flatMap((r) => r.values.map((v) => ({ left: r.left, right: r.right, kern: v }))),
          columns,
          'judge',
          false,
        )

        for (const r of rows) {
          const key = `${r.left}${r.right}`
          for (const v of r.values) notePreview(key, v)
        }
        api.markReviewed(rows.map((r) => `${r.left}${r.right}`))
        api.highlight(rows.map((r) => `${r.left}${r.right}`))
        api.log(`preview · ${rows.length} pairs × ${columns} values`)

        const table = sheet.cells
          .map(
            (c) =>
              `${c.left}${c.right}\t${c.kern}\tgap ${c.metrics.minGap}–${c.metrics.maxGap}` +
              `\ttouching ${Math.round(c.metrics.contact * 100)}%` +
              `${c.metrics.collides ? '\tCOLLIDES' : ''}`,
          )
          .join('\n')

        return {
          content: [
            { type: 'image' as const, data: sheet.base64, mimeType: 'image/png' },
            {
              type: 'text' as const,
              text: [
                stamp(api, rescoped),
                '',
                `${rows.length} pairs, ${columns} values each, one row per pair.`,
                ...rows.map(
                  (r) =>
                    `${r.left}${r.right}: ${r.values.join(', ')} · floor ${r.floor}` +
                    (classLeaning(font!, r.left, r.right)
                      ? ` · ${classLeaning(font!, r.left, r.right)}`
                      : ''),
                ),
                '',
                `pair\tvalue\tgap\tcontact`,
                table,
                '',
                'PREVIEW ONLY. Apply what you chose with set_kern — these values ' +
                  'will not be argued with.',
                '',
                'Safe to run concurrently, including with itself. If you have ' +
                  'more groups to compare, send them all in this turn rather than ' +
                  'one after another — they cannot conflict, and the waiting is ' +
                  'most of the time a run takes.',
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
        'Kern is a font-kerning workbench. ' +
        ' Put pairs back to the value the font ' +
        'shipped with. Use it when a change made the rhythm worse, or to clear a ' +
        'line of work and start it again. Reverting is not failure — it is cheaper ' +
        'than guessing another value on top of a bad one.',
      annotations: UNTRUSTED,
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
        'Kern is a font-kerning workbench. ' +
        ' Apply kerning values to one or many pairs. This is the only tool that ' +
        'changes anything. Send `keep` on its own to mark pairs reviewed without ' +
        'changing them — that is a normal call, not a workaround. ' +
        'A value you previewed is accepted as it stands — the render you looked ' +
        'at outranks the shape-class range, so you never need to ask permission ' +
        'for it. Values you did not preview are checked against that range and ' +
        'rejected individually; the rest of the batch still applies. Pairs you ' +
        'judged together on one sheet can be applied together in one call.',
      annotations: UNTRUSTED,
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
              'Accept a value outside the typical range for the pair’s shape ' +
              'class. You do not need this for ordinary work, and you do not ' +
              'need to ask anyone before using it: if you previewed the pair and ' +
              'the render is right, apply it.',
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
                  `STOP. This call was made against "${sanitise(font!.familyName)}", ` +
                  `but the page now has "${sanitise(api.getFont()?.familyName)}". Nothing ` +
                  `was applied. End your turn and tell the user the font changed ` +
                  `mid-run, so this one has stopped.`,
              },
            ],
            isError: true,
          }
        }
        // `pairs` is optional: a call that only marks pairs reviewed is a
        // normal, useful call. It used to throw twice over — omitting `pairs`
        // hit `undefined.filter`, and sending `[]` hit "No valid pairs" — so
        // the keep list was thrown away and those pairs stayed unreviewed,
        // which made a finished run look half-done.
        const updates = (pairs ?? [])
          .filter((p) => [...p.pair].length === 2)
          .map((p) => ({ left: p.pair[0], right: p.pair[1], value: p.kern }))
        if (!updates.length && !keep?.length) {
          throw new Error(
            'Nothing to do: send pairs to apply, keep to mark reviewed, or both.',
          )
        }
        if (!updates.length) {
          api.markReviewed(keep!)
          api.highlight(keep!)
          return text_(
            `${stamp(api, api.takeScopeChange())}\n\n` +
              `Marked ${keep!.length} pair(s) reviewed and left at their current ` +
              `values: ${keep!.join(', ')}\n\n${progressLine(api.getPairs())}`,
          )
        }

        previewsSinceApply = 0
        // The measurement warned about tight contact points; refusing here is
        // what stops that warning from being ignored. `f)` traps a lot of white
        // around a join that is already closed, so its ratio invites exactly
        // the change that ruins it.
        // Sighted FIRST, before any guard.
        //
        // A value that came back from preview_pair or preview_pairs has been
        // looked at. The description promises those are accepted, and running
        // the crash guard ahead of this check broke that promise: eight values
        // the agent had just compared on a sheet were refused, and it had to
        // resort to force. The render the agent saw outranks both the
        // shape-class range and a measurement that disagrees with the picture.
        const sighted = updates.filter((u) =>
          previewed.get(`${u.left}${u.right}`)?.has(u.value),
        )
        const unseen = updates.filter((u) => !sighted.includes(u))

        const collides: Rejected[] = []
        const safe = unseen.filter((u) => {
          if (force) return true
          // measurePair, not renderPair: this needs the numbers, and renderPair
          // encodes a PNG that is thrown away.
          const m = measurePair(font!, u.left, u.right, u.value)
          // Only a real crash is refused: outlines that overlap, or that meet
          // across a third of the facing height. A serif touching at a point
          // is ordinary in a serif face and no reason to block the value.
          if (!m.collides && m.contact < CRASH_CONTACT) return true
          collides.push({
            key: `${u.left}${u.right}`,
            value: u.value,
            reason:
              `at ${u.value} the outlines ${m.collides ? 'overlap' : 'meet'} across ` +
              `${Math.round(m.contact * 100)}% of the facing height. Preview it: if ` +
              `the render looks right, applying it again will be accepted without ` +
              `force, because you will have seen it.`,
          })
          return false
        })

        const a = api.applyKerns(sighted, true)
        const b = api.applyKerns(safe, Boolean(force))
        const applied = [...a.applied, ...b.applied]
        const rejected = [...a.rejected, ...b.rejected]
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

  // ---- export_font: hands over the finished file -----------------------
  useWebMCPTool<Record<string, never>>(
    {
      name: 'export_font',
      description:
        'Kern is a font-kerning workbench. Write the kerned font to the ' +
        'reader\u2019s disk as a .ttf, with the values you applied baked into real ' +
        'GPOS and kern tables. Call this once the work is done and the specimen ' +
        'reads well AND the reader has asked for the file. Do not call it to ' +
        'round off a run: exporting writes to their disk, and they may still be ' +
        'deciding. Finishing without it is normal \u2014 say the font is ready and ' +
        'let them ask. Applying values alone does not produce a file.',
      annotations: UNTRUSTED,
      inputSchema: { type: 'object', properties: {} } as const,
      enabled: ready,
      execute: async () => {
        api.countCall('export_font')
        const swapped = api.takeFontChange()
        if (swapped) return stopForFontChange(api, swapped)
        if (api.getFont() !== font) {
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `STOP. Nothing was exported: this call was made against ` +
                  `"${sanitise(font!.familyName)}" but the page now has a different font.`,
              },
            ],
            isError: true,
          }
        }

        const { filename, bytes, pairs } = api.exportFont()
        if (pairs === 0) {
          return text_(
            `Exported ${filename}, but NOTHING WAS KERNED — every pair still ` +
              `carries the value the font shipped with, so the file is a copy of ` +
              `the original.`,
          )
        }
        return text_(
          `${stamp(api, api.takeScopeChange())}\n\n` +
            `Downloaded ${filename} \u2014 ${Math.round(bytes / 1024)} KB, ` +
            `${pairs} kerned pair(s) written into the font's GPOS and kern ` +
            `tables. It will kern in any application that reads either table.\n\n` +
            `The file went to the browser's download folder under that name. A ` +
            `page cannot be told the absolute path it was saved to, so there is ` +
            `none to report.`,
        )
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
