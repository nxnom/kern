import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Activity } from './Activity'
import { ActivityStrip } from './Activity'
import { Confirm } from './Confirm'
import { Tabs } from './Tabs'
import { Wordmark } from './Wordmark'
import { DownloadMenu } from './DownloadMenu'
import { IconClose, IconContrast, IconReset, IconUpload } from './Icons'
import { Toggle } from './Toggle'
import { PairDetail } from './PairDetail'
import { PairGrid } from './PairGrid'
import { Specimen } from './Specimen'
import type { LoadedFont } from './kern/font'
import {
  forgetMeasurements,
  installFontFace,
  loadFontFromBuffer,
  loadFontFromUrl,
} from './kern/font'
import type { PairState } from './kern/state'
import { SCOPES, buildPairList, pairsInScope } from './kern/pairs'
import type { ScopeId } from './kern/pairs'
import { initialPairs, pairKey, statusFor } from './kern/state'
import {
  clearSession,
  fontKey,
  loadSession,
  restore,
  saveSession,
  toStored,
} from './kern/storage'
import { useWebMCPSupport } from './kern/useWebMCPSupport'
import { WebMCPStatus } from './WebMCPStatus'
import { buildFeatureFile, buildKernedFont, download } from './kern/export'
import type { Applied, KernApi, Rejected } from './kern/useKernTools'
import {
  checkRange,
  forgetPreviews,
  registeredToolNames,
  resetGuidance,
  resetPreviewCount,
  useKernTools,
} from './kern/useKernTools'

const SAMPLE = {
  label: 'EB Garamond',
  url: `${import.meta.env.BASE_URL}fonts/EBGaramond-Regular.ttf`,
}
/**
 * How long after a tool call the agent still counts as working. It pauses to
 * read a contact sheet, so a short window kept dropping it back to idle in the
 * middle of a run.
 */
const BUSY_MS = 30_000
/**
 * How long the tiles it touched stay lit. Much shorter than BUSY_MS on
 * purpose: the narration describes a run, but a lit tile claims "checking this
 * right now", and seventeen of them still glowing thirty seconds later is a
 * lie about where the agent's attention is.
 */
const ACTIVE_MS = 6_000

const PANGRAM = 'Waltz, bad nymph, for quick jigs vex.'

/** One line each, so the tools tab explains itself without the schemas. */
const TOOL_BLURBS: Record<string, string> = {
  preview_pairs: 'Several pairs at several values, one sheet, one call.',
  list_pairs: 'Every pair with its value, state and shape class. Text only.',
  survey_pairs: '36 pairs to screen, or 12 large enough to judge. One sheet.',
  preview_pair: 'One pair at several candidate values, side by side.',
  publish_specimen: 'A line of real words, as the font ships and as kerned.',
  set_kern: 'Applies values. The only tool that writes.',
  revert: 'Puts pairs back to what the font shipped.',
  export_font: 'Saves the kerned .ttf, with real GPOS and kern tables.',
}

/**
 * Each changed pair sandwiched between control glyphs — `H` for caps, `n` for
 * lowercase — which is how kerning is judged in practice. The controls have
 * even, vertical sidebearings, so they give the eye a reference rhythm to
 * compare the pair against.
 */
function inControlContext(keys: string[]): string {
  return keys
    .slice(0, 10)
    .map((k) => {
      const control = /[A-Z]/.test(k[0]) ? 'H' : 'n'
      return `${control}${control}${k}${control}${control}`
    })
    .join(' ')
}

/** Short, human phrasing for a past timestamp. */
function relativeTime(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000)
  if (mins < 1) return 'a moment ago'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

interface LogLine { id: number; at: number; text: string; rejected: boolean }

export default function App() {
  const webmcp = useWebMCPSupport()
  const [loaded, setLoaded] = useState<LoadedFont | null>(null)
  const [pairs, setPairs] = useState<Map<string, PairState>>(new Map())
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  /** Nothing is selected until you pick something. */
  const [selected, setSelected] = useState<string | null>(null)
  const [shade, setShade] = useState(true)
  /** null means "the pairs the agent changed", rebuilt as it works. */
  const [proofText, setProofText] = useState<string | null>(null)
  const [agentLine, setAgentLine] = useState<string | null>(null)
  /** Identifies the loaded font by its bytes, so sessions cannot cross over. */
  const [key, setKey] = useState<string | null>(null)
  const [restored, setRestored] = useState<{ at: number; count: number } | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [activity, setActivity] = useState<Activity | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [scope, setScope] = useState<ScopeId>('essential')
  /** Every candidate the face turned up, so changing scope costs no measuring. */
  const generated = useRef<ReturnType<typeof buildPairList>>([])
  /** Set while a font is being read and its pairs measured. */
  const [busy, setBusy] = useState<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)
  /**
   * Proof claims the work is done, so it should not appear mid-run. It latches
   * on once the agent has either published a specimen or stopped calling
   * tools, and stays on — gating it on live activity alone would make it blink
   * in and out between bursts.
   */
  const [proofReady, setProofReady] = useState(false)
  const [log, setLog] = useState<LogLine[]>([])
  const [tab, setTab] = useState('main')
  const [error, setError] = useState<string | null>(null)

  const fileInput = useRef<HTMLInputElement>(null)
  const busyTimer = useRef<number | undefined>(undefined)
  const activeTimer = useRef<number | undefined>(undefined)
  /** Read at swap time to tell an interruption from a fresh start. */
  const activityRef = useRef<Activity | null>(null)

  /**
   * Bumped whenever the human swaps the font. The next tool call, whichever it
   * is, fails once so the agent learns its plan is stale — then work resumes
   * normally. Silently continuing against a different typeface is the worst of
   * the options: every measurement it holds is wrong and nothing says so.
   */
  const fontEpoch = useRef(0)
  const seenEpoch = useRef(0)
  /** Same idea for scope, but advisory: the work changed size, not identity. */
  const scopeEpoch = useRef(0)
  const seenScope = useRef(0)
  const logId = useRef(0)
  const [callCount, setCallCount] = useState(0)
  const logBody = useRef<HTMLOListElement>(null)
  // Tools read state through this ref so they never close over a stale map,
  // and so registering them does not depend on every keystroke of state.
  const pairsRef = useRef(pairs)
  pairsRef.current = pairs
  /** Which keys the chosen scope covers, read when a tool asks for the pairs. */
  const inScopeRef = useRef<Set<string>>(new Set())

  // Escape gives the selection up, and so does clicking empty space.
  //
  // Only genuinely empty space, though. A blanket click-away handler drops the
  // selection when you reach for a toolbar button or the panel's own controls,
  // which costs more than an armed selection does — so anything interactive,
  // any tile, and the detail panel itself all leave it alone.
  const KEEPS_SELECTION =
    '.tile, .selected-bar, button, input, select, textarea, a, label, [role="tab"]'
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target?.closest(KEEPS_SELECTION)) setSelected(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  // Keep the newest line in view, both on open and as calls arrive.
  useEffect(() => {
    if (tab !== 'log') return
    const el = logBody.current
    if (el) el.scrollTop = el.scrollHeight
  }, [tab, log])

  useEffect(() => {
    void pick(SAMPLE)
  }, [])

  async function pick(font: typeof SAMPLE) {
    try {
      const lf = await loadFontFromUrl(font.url, font.label)
      await withBusy(`Reading ${font.label}`, async () => {
        await adopt(lf)
      })
    } catch (e) {
      setError(String(e))
    }
  }

  /**
   * Measuring a face's pairs blocks for a moment, and React will not paint a
   * loading state and then run the work in the same tick — so yield once to
   * let the message reach the screen first.
   */
  async function withBusy(label: string, work: () => Promise<void>) {
    setBusy(label)
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    try {
      await work()
    } finally {
      setBusy(null)
    }
  }

  // Hand the loaded face to CSS, so the proof lines are set in the font being
  // kerned rather than in a stand-in serif.
  useEffect(() => {
    if (!loaded) return
    return installFontFace(loaded.buffer)
  }, [loaded])

  async function adopt(lf: LoadedFont) {
    // Only a swap counts, and only one that interrupts a run: an agent that
    // had already finished has no stale plan to warn it about.
    if (loadedRef.current && activityRef.current) fontEpoch.current += 1
    setActivity(null)
    // Everything the tools remember is about the font that just went away:
    // which values were previewed, how many previews had gone unapplied, the
    // measurement cache, and whether the workflow text had been printed.
    forgetPreviews()
    resetPreviewCount()
    resetGuidance()
    forgetMeasurements()
    generated.current = buildPairList(lf)
    const fresh = initialPairs(lf, generated.current)
    const id = await fontKey(lf.buffer)
    const saved = loadSession(id)

    setLoaded(lf)
    setKey(id)
    setLog([])
    setActiveKeys([])
    setError(null)

    if (saved) {
      const merged = restore(fresh, saved.pairs)
      pairsRef.current = merged
      setPairs(merged)
      setAgentLine(saved.specimen ?? null)
      if (saved.scope && saved.scope in SCOPES) setScope(saved.scope as ScopeId)
      setRestored({ at: saved.savedAt, count: Object.keys(saved.pairs).length })
    } else {
      pairsRef.current = fresh
      setPairs(fresh)
      setAgentLine(null)
      setRestored(null)
    }
  }

  /** Write after a pause, so a batch of set_kern calls costs one save. */
  useEffect(() => {
    if (!loaded || !key) return
    const stored = toStored(pairs)
    if (Object.keys(stored).length === 0) return
    const timer = window.setTimeout(() => {
      saveSession({
        version: 'v1',
        fontKey: key,
        familyName: loaded.familyName,
        savedAt: Date.now(),
        scope,
        specimen: agentLine ?? undefined,
        specimenAt: agentLine ? Date.now() : undefined,
        pairs: stored,
      })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [pairs, agentLine, scope, loaded, key])

  /**
   * Scope narrows the view, never the work. Rebuilding the map dropped every
   * pair outside the new scope — and the autosave then wrote that shorter map,
   * so narrowing quietly erased values you had already set.
   */
  function changeScope(next: ScopeId) {
    if (next !== scope) scopeEpoch.current += 1
    setScope(next)
  }

  function resetSession() {
    setConfirmingReset(false)
    if (!loaded) return
    if (key) clearSession(key)
    const fresh = initialPairs(loaded)
    pairsRef.current = fresh
    setPairs(fresh)
    setAgentLine(null)
    setProofText(null)
    setRestored(null)
    setProofReady(false)
    setLog([])
    setActiveKeys([])
  }

  /**
   * Appended, not prepended: the log reads top to bottom like a transcript.
   * `replaceKey` rewrites the last line when it belongs to the same pair, so a
   * run of nudges stays one entry that keeps up rather than fifty.
   */
  const log_ = useCallback((text: string, rejected = false, replaceKey?: string) => {
    // Both allocated before the updater: React may run one more than once, and
    // an id handed out twice would give two lines the same key.
    const at = Date.now()
    const id = logId.current++
    setLog((prev) => {
      const last = prev.at(-1)
      if (replaceKey && last?.text.startsWith(`${replaceKey} ·`)) {
        return [...prev.slice(0, -1), { ...last, at, text, rejected }]
      }
      return [...prev, { id, at, text, rejected }].slice(-250)
    })
  }, [])

  const highlight = useCallback((keys: string[]) => {
    setActiveKeys(keys)
    window.clearTimeout(activeTimer.current)
    activeTimer.current = window.setTimeout(() => setActiveKeys([]), ACTIVE_MS)
  }, [])

  /** The single write path. Rejects per pair so one bad value cannot block a batch. */
  /**
   * The single write path.
   *
   * Everything is computed from the ref before the state call, not inside the
   * updater. React may run an updater more than once — twice in development —
   * so collecting results in there double-counted them, and the return value
   * raced the state update, leaving the tool reporting on work it could not
   * yet see.
   */
  const applyKerns = useCallback(
    (
      updates: { left: string; right: string; value: number }[],
      force: boolean,
      by: 'agent' | 'human' = 'agent',
    ) => {
      const current = pairsRef.current
      const em = loadedRef.current?.unitsPerEm ?? 1000
      const applied: Applied[] = []
      const rejected: Rejected[] = []
      const coalesced = new Set<string>()
      const burstStart = new Map<string, number>()
      const next = new Map(current)

      for (const u of updates) {
        const key = pairKey(u.left, u.right)
        const cur = next.get(key)
        if (!cur) {
          rejected.push({ key, value: u.value, reason: 'not a pair on this page' })
          continue
        }
        const problem = force ? null : checkRange(u.left, u.right, u.value, em)
        if (problem) {
          rejected.push({ key, value: u.value, reason: problem })
          next.set(key, {
            ...cur,
            status: 'rejected',
            note: problem,
            attempts: [
              ...cur.attempts,
              { value: u.value, rejected: true, at: Date.now(), by },
            ],
          })
          continue
        }
        applied.push({ key, from: cur.kern, to: u.value })
        // The trail is a record of reasoning, and hand edits have none to
        // show — only where they ended up. So consecutive human edits collapse
        // into a single entry that keeps updating, however far apart they are.
        // The agent's attempts still each get their own entry.
        const last = cur.attempts.at(-1)
        const coalesce = by === 'human' && last?.by === 'human' && !last.rejected
        if (coalesce) coalesced.add(key)
        if (coalesce) burstStart.set(key, last?.from ?? cur.kern)
        const attempt = {
          value: u.value,
          rejected: false,
          at: Date.now(),
          by,
          // Keep the start of the run so the log can say 0 → −80, not 0 → −10.
          from: coalesce ? (last?.from ?? cur.kern) : cur.kern,
        }
        const attempts = coalesce
          ? [...cur.attempts.slice(0, -1), attempt]
          : [...cur.attempts, attempt]
        next.set(key, {
          ...cur,
          kern: u.value,
          status: statusFor(u.value, cur.original, attempts),
          note: undefined,
          attempts,
          touchedAt: Date.now(),
          reviewedAt: Date.now(),
        })
      }

      pairsRef.current = next
      setPairs(next)

      for (const a of applied) {
        // A run of nudges keeps one line, rewritten to where it has got to —
        // skipping it left the log showing the first value for ever.
        const from = burstStart.get(a.key) ?? a.from
        log_(
          `${a.key} · ${from} → ${a.to}${by === 'human' ? ' (you)' : ''}`,
          false,
          coalesced.has(a.key) ? a.key : undefined,
        )
      }
      for (const r of rejected) log_(`${r.key} · rejected: ${r.reason}`, true)
      return { applied, rejected }
    },
    [log_],
  )

  /** A value the human set by hand. Forced, because their eye outranks the rule. */
  const nudge = useCallback(
    (key: string, value: number) => {
      const state = pairsRef.current.get(key)
      if (!state) return
      applyKerns([{ left: state.left, right: state.right, value }], true, 'human')
    },
    [applyKerns],
  )

  // Arrow keys nudge whichever pair is selected, so the grid can be worked
  // through without reaching for the panel each time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      if (!selected) return
      const state = pairsRef.current.get(selected)
      if (!state) return
      e.preventDefault()
      // Ten units is roughly one percent of an em — the smallest step you can
      // actually see. One unit is a real value but an invisible edit.
      const step = e.shiftKey ? 1 : 10
      nudge(selected, state.kern + (e.key === 'ArrowLeft' ? -step : step))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, nudge])

  const loadedRef = useRef(loaded)
  loadedRef.current = loaded
  activityRef.current = activity

  const inScope = useMemo(
    () => new Set(pairsInScope(generated.current, SCOPES[scope].extra).map((p) => `${p.left}${p.right}`)),
    [scope, loaded],
  )
  const list = useMemo(
    () => [...pairs.values()].filter((p) => inScope.has(p.key)),
    [pairs, inScope],
  )
  inScopeRef.current = inScope


  const changed = useMemo(
    () =>
      [...pairs.values()]
        .filter((p) => p.kern !== p.original)
        .map((p) => ({ left: p.left, right: p.right, value: p.kern })),
    [pairs],
  )
  const hasChanges = changed.length > 0
  const showProof = hasChanges && (proofReady || Boolean(agentLine) || !activity)
  if (showProof && !proofReady) setProofReady(true)
  const changedPairsLine = useMemo(
    () =>
      [...pairs.values()]
        .filter((p) => p.kern !== p.original)
        .map((p) => p.key)
        .join(' '),
    [pairs],
  )
  const contextLine = useMemo(
    () => inControlContext(changedPairsLine.split(' ').filter(Boolean)),
    [changedPairsLine],
  )
  const proof = proofText ?? changedPairsLine

  const api: KernApi = useMemo(
    () => ({
      font: loaded,
      getFont: () => loadedRef.current,
      fontId: key,
      notify: (message: string) => {
        setNotice(message)
        log_(message, true)
        // The run is over, so it must stop counting as live. Otherwise the
        // refused call itself keeps the agent "working" for another thirty
        // seconds, and the next font swap re-arms the guard on what is really
        // a fresh start.
        window.clearTimeout(busyTimer.current)
        window.clearTimeout(activeTimer.current)
        setActivity(null)
        activityRef.current = null
        setActiveKeys([])
        window.clearTimeout(noticeTimer.current)
        noticeTimer.current = window.setTimeout(() => setNotice(null), 12_000)
      },
      takeFontChange: () => {
        if (seenEpoch.current === fontEpoch.current) return null
        seenEpoch.current = fontEpoch.current
        return loadedRef.current?.familyName ?? 'a different font'
      },
      // The agent is given the scope the reader chose, not the whole face.
      getPairs: () =>
        new Map([...pairsRef.current].filter(([key]) => inScopeRef.current.has(key))),
      applyKerns,
      takeScopeChange: () => {
        if (seenScope.current === scopeEpoch.current) return null
        seenScope.current = scopeEpoch.current
        const all = [...pairsRef.current].filter(([k]) => inScopeRef.current.has(k))
        const fresh = all.filter(([, p]) => !p.reviewedAt).length
        return (
          `The human changed how much of this face to work through. You now have ` +
          `${all.length} pairs in scope, ${fresh} of them not yet reviewed. Your ` +
          `earlier decisions still stand — call survey_pairs with status ` +
          `"unreviewed" for what is new, and do not redo what you have done.`
        )
      },
      markReviewed: (keys: string[]) => {
        const next = new Map(pairsRef.current)
        for (const key of keys) {
          const cur = next.get(key)
          if (cur) next.set(key, { ...cur, reviewedAt: Date.now() })
        }
        pairsRef.current = next
        setPairs(next)
      },
      highlight,
      log: log_,
      countCall: (tool: string) => {
        setCallCount((n) => n + 1)
        log_(`→ ${tool}`)
        // No disconnect event exists, so "working" means "called something
        // recently"; the strip falls back to a summary after a quiet spell.
        setActivity({ tool, at: Date.now() })
        window.clearTimeout(busyTimer.current)
        busyTimer.current = window.setTimeout(() => {
          setActivity(null)
          setActiveKeys([])
        }, BUSY_MS)
      },
      // Publishing selects it too — the agent chose it, so show it.
      setSpecimen: (text: string) => {
        setAgentLine(text)
        setProofText(text)
      },
      // `exportFont` is a hoisted declaration further down, and it reads the
      // pairs through a ref, so calling it from here is always current.
      exportFont: () => {
        const written = exportFont()
        if (!written) throw new Error('No font is loaded, so nothing was written.')
        return written
      },
    }),
    [loaded, key, applyKerns, highlight, log_],
  )
  useKernTools(api)
  const registered = registeredToolNames(loaded !== null)

  async function onFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      await withBusy(`Reading ${file.name}`, async () => {
        await adopt(loadFontFromBuffer(buffer, file.name))
      })
    } catch {
      setError(`Could not read ${file.name}. Kern needs a .ttf or .otf file.`)
    }
  }

  // Only a click selects. The agent's attention shows as a ring on the tiles;
  // letting it drive this panel meant it replaced whatever you were looking at
  // every time it called a tool.
  const detail = pairs.get(selected ?? '')

  /** Returns what was written, so the agent's request can report it back. */
  function exportFont(): { filename: string; bytes: number; pairs: number } | null {
    const lf = loadedRef.current
    if (!lf) return null
    try {
      // Read through the ref, not the memoised list: a value applied moments
      // ago must be in the file.
      const entries = [...pairsRef.current.values()]
        .filter((p) => p.kern !== p.original)
        .map((p) => ({ left: p.left, right: p.right, value: p.kern }))
      const bytes = buildKernedFont(lf.buffer, lf, entries)
      const filename = `${lf.familyName.replace(/\s+/g, '')}-Kerned.ttf`
      download(bytes, filename, 'font/ttf')
      log_(`exported ${filename} · ${entries.length} pairs`)
      return { filename, bytes: bytes.byteLength, pairs: entries.length }
    } catch (e) {
      setError(`Export failed: ${String(e)}`)
      return null
    }
  }

  // Everything downstream reads the font — its metrics, its glyphs, its saved
  // session. Rendering the page around a null one meant the header, the WebMCP
  // banner and the empty grid each appeared on their own, which read as a
  // fault rather than as loading.
  if (!loaded) {
    return (
      <div className="app booting">
        <h1>
          <span className="wordmark-fallback">Kern</span>
        </h1>
        {error ? (
          <div className="error">{error}</div>
        ) : (
          <p className="muted">Loading {SAMPLE.label}…</p>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <header className="head">
        <h1>
          <Wordmark loaded={loaded} pairs={pairs} />
        </h1>

        <p
          className="face"
          title={`${loaded.source} · ${loaded.unitsPerEm} units per em`}
        >
          <b>{loaded.familyName}</b>
          {loaded.styleName && <i> {loaded.styleName}</i>}
          {loaded.source !== SAMPLE.label && (
            <button
              className="unload"
              onClick={() => void pick(SAMPLE)}
              title="Use the sample font. Your kerning for this font is kept."
              aria-label="Use the sample font"
            >
              <IconClose />
            </button>
          )}
        </p>

        <div className="head-actions">
          <Toggle on={shade} onChange={setShade} icon={<IconContrast />}>
            <span className="btn-label">Negative space</span>
          </Toggle>
          {hasChanges && (
            <button onClick={() => setConfirmingReset(true)} title="Discard all changes">
              <IconReset />
              <span className="btn-label">Reset</span>
            </button>
          )}
          <DownloadMenu
            disabled={!hasChanges}
            options={[
              {
                label: 'Font (.ttf)',
                hint: 'GPOS kerning, ready to install',
                onSelect: exportFont,
              },
              {
                label: 'Features (.fea)',
                hint: 'Adobe syntax for fontmake or AFDKO',
                onSelect: () =>
                  download(
                    buildFeatureFile(loaded, changed),
                    `${loaded.familyName.replace(/\s+/g, '')}-kern.fea`,
                    'text/plain',
                  ),
              },
            ]}
          />
          <button onClick={() => fileInput.current?.click()} title="Load a font file">
            <IconUpload />
            <span className="btn-label">Load</span>
          </button>
          <input ref={fileInput} type="file" accept=".ttf,.otf" hidden onChange={onFile} />
        </div>
      </header>

      <WebMCPStatus support={webmcp} registered={registered} />
      {error && <div className="error">{error}</div>}
      {notice && (
        <p className="notice" role="status">
          {notice}
          <button onClick={() => setNotice(null)} aria-label="Dismiss">
            <IconClose />
          </button>
        </p>
      )}

      <div className={`now ${activity ? 'live' : ''}`}>
        <ActivityStrip
          activity={activity}
          activeKeys={activeKeys}
          note={detail?.note}
          changed={changed.length}
          total={list.length}
          calls={callCount}
          everCalled={callCount > 0}
        />
        {restored && (
          <span className="facts">
            restored {restored.count} from {relativeTime(restored.at)}
          </span>
        )}
      </div>

      <Tabs
        tabs={[
          {
            id: 'main',
            label: 'Main',
            badge: `${list.filter((p) => p.reviewedAt).length}/${list.length}`,
          },
          { id: 'proof', label: 'Proof', badge: changed.length, disabled: !showProof },
          { id: 'tools', label: 'WebMCP tools', badge: registered.length },
          { id: 'log', label: 'Activity', badge: log.length, disabled: !log.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div hidden={tab !== 'main'}>
        <div className="grid-head">
          <label className="scope">
            <span>Work through</span>
            <select
              value={scope}
              onChange={(e) => changeScope(e.target.value as ScopeId)}
            >
              {(Object.keys(SCOPES) as ScopeId[]).map((id) => (
                <option key={id} value={id}>
                  {SCOPES[id].label} ·{' '}
                  {pairsInScope(generated.current, SCOPES[id].extra).length} pairs
                </option>
              ))}
            </select>
          </label>
          <span className="grid-note">{SCOPES[scope].note}</span>
        </div>
          {detail && (
            <div className="selected-bar">
              <PairDetail
                loaded={loaded}
                pair={detail}
                shade={shade}
                onNudge={(value) => nudge(detail.key, value)}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
          <PairGrid
            loaded={loaded}
            pairs={list}
            activeKeys={activeKeys}
            selectedKey={selected ?? ''}
            onSelect={setSelected}
            shade={shade}
          />
      </div>

      <div className="view" hidden={tab !== 'proof' || !showProof}>
          <div className="chips">
            <button
              className={proof === changedPairsLine ? 'on' : ''}
              onClick={() => setProofText(null)}
            >
              Changed pairs
            </button>
            {agentLine && (
              <button
                className={proof === agentLine ? 'on' : ''}
                onClick={() => setProofText(agentLine)}
              >
                Agent’s line
              </button>
            )}
            <button
              className={proof === contextLine ? 'on' : ''}
              onClick={() => setProofText(contextLine)}
              title={contextLine}
            >
              In context
            </button>
            <button
              className={proof === PANGRAM ? 'on' : ''}
              onClick={() => setProofText(PANGRAM)}
              title={PANGRAM}
            >
              Pangram
            </button>
          </div>
          <Specimen loaded={loaded} word={proof} pairs={pairs} shade={shade} />
      </div>

      <div className="view" hidden={tab !== 'tools'}>
          <p className="view-lead">
            {webmcp.source === 'native'
              ? 'This browser provides WebMCP itself. '
              : 'This browser does not implement WebMCP, so nothing can call these. '}
            Registered on <code>document.modelContext</code>: they appear when a font
            is loaded and unregister when one is swapped, which is what fires{' '}
            <code>toolchange</code>.
          </p>
          <ul className="tool-list">
            {registered.map((name) => (
              <li key={name}>
                <code>{name}</code>
                <span>{TOOL_BLURBS[name]}</span>
              </li>
            ))}
          </ul>
      </div>

      <div className="view" hidden={tab !== 'log'}>
          <ol className="log-list" ref={logBody}>
            {log.map((l) => (
              <li
                key={l.id}
                className={`${l.rejected ? 'rejected' : ''} ${
                  l.text.startsWith('→') ? 'call' : ''
                }`}
              >
                <time>{new Date(l.at).toLocaleTimeString('en-GB')}</time>
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
      </div>

      {busy && (
        <div className="busy-scrim" role="status" aria-live="polite">
          <div className="busy">
            <span className="busy-rule" aria-hidden="true" />
            <p className="busy-title">{busy}</p>
            <p className="busy-detail">measuring the pairs it traps white in</p>
          </div>
        </div>
      )}

      {confirmingReset && (
        <Confirm
          title="Reset this font"
          body={`This discards all ${changed.length} kerning changes and the saved session for ${loaded.familyName}. It cannot be undone.`}
          confirmLabel="Discard changes"
          onConfirm={resetSession}
          onCancel={() => setConfirmingReset(false)}
        />
      )}
    </div>
  )
}
