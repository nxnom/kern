import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CopyPrompt } from './CopyPrompt'
import { Wordmark } from './Wordmark'
import { DownloadMenu } from './DownloadMenu'
import { IconChevron, IconContrast, IconUpload } from './Icons'
import { Toggle } from './Toggle'
import { PairDetail } from './PairDetail'
import { PairGrid } from './PairGrid'
import { Section } from './Section'
import { Specimen } from './Specimen'
import type { LoadedFont } from './kern/font'
import { installFontFace, loadFontFromBuffer, loadFontFromUrl } from './kern/font'
import type { PairState } from './kern/state'
import { initialPairs, pairKey } from './kern/state'
import { useWebMCPSupport } from './kern/useWebMCPSupport'
import { WebMCPStatus } from './WebMCPStatus'
import { buildFeatureFile, buildKernedFont, download } from './kern/export'
import type { Applied, KernApi, Rejected } from './kern/useKernTools'
import { checkRange, registeredToolNames, useKernTools } from './kern/useKernTools'

const SAMPLE = {
  label: 'EB Garamond',
  url: `${import.meta.env.BASE_URL}fonts/EBGaramond-Regular.ttf`,
}
/** How long tiles stay lit after the agent touches them. */
const ACTIVE_MS = 2600

const PANGRAM = 'Waltz, bad nymph, for quick jigs vex.'

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

interface LogLine { id: number; at: number; text: string; rejected: boolean }

export default function App() {
  const webmcp = useWebMCPSupport()
  const [loaded, setLoaded] = useState<LoadedFont | null>(null)
  const [pairs, setPairs] = useState<Map<string, PairState>>(new Map())
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [selected, setSelected] = useState('AV')
  const [shade, setShade] = useState(true)
  /** null means "the pairs the agent changed", rebuilt as it works. */
  const [proofText, setProofText] = useState<string | null>(null)
  const [agentLine, setAgentLine] = useState<string | null>(null)
  const [log, setLog] = useState<LogLine[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInput = useRef<HTMLInputElement>(null)
  const activeTimer = useRef<number | undefined>(undefined)
  const logId = useRef(0)
  const [callCount, setCallCount] = useState(0)
  const logBody = useRef<HTMLOListElement>(null)
  // Tools read state through this ref so they never close over a stale map,
  // and so registering them does not depend on every keystroke of state.
  const pairsRef = useRef(pairs)
  pairsRef.current = pairs

  // Keep the newest line in view, both on open and as calls arrive.
  useEffect(() => {
    if (!logOpen) return
    const el = logBody.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logOpen, log])

  useEffect(() => {
    loadFontFromUrl(SAMPLE.url, SAMPLE.label)
      .then(adopt)
      .catch((e: unknown) => setError(String(e)))
  }, [])

  // Hand the loaded face to CSS, so the proof lines are set in the font being
  // kerned rather than in a stand-in serif.
  useEffect(() => {
    if (!loaded) return
    return installFontFace(loaded.buffer)
  }, [loaded])

  function adopt(lf: LoadedFont) {
    setLoaded(lf)
    setPairs(initialPairs(lf))
    setLog([])
    setActiveKeys([])
    setError(null)
  }

  // Appended, not prepended: the log reads top to bottom like a transcript.
  const log_ = useCallback((text: string, rejected = false) => {
    setLog((prev) =>
      [...prev, { id: logId.current++, at: Date.now(), text, rejected }].slice(-250),
    )
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
    (updates: { left: string; right: string; value: number }[], force: boolean) => {
      const current = pairsRef.current
      const em = loadedRef.current?.unitsPerEm ?? 1000
      const applied: Applied[] = []
      const rejected: Rejected[] = []
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
            attempts: [...cur.attempts, { value: u.value, rejected: true, at: Date.now() }],
          })
          continue
        }
        applied.push({ key, from: cur.kern, to: u.value })
        next.set(key, {
          ...cur,
          kern: u.value,
          status: 'adjusted',
          note: undefined,
          attempts: [...cur.attempts, { value: u.value, rejected: false, at: Date.now() }],
          touchedAt: Date.now(),
        })
      }

      pairsRef.current = next
      setPairs(next)

      for (const a of applied) log_(`${a.key} · ${a.from} → ${a.to}`)
      for (const r of rejected) log_(`${r.key} · rejected: ${r.reason}`, true)
      return { applied, rejected }
    },
    [log_],
  )

  const loadedRef = useRef(loaded)
  loadedRef.current = loaded

  const list = useMemo(() => [...pairs.values()], [pairs])
  // How much kerning the font arrived with — the honest starting point.
  const kernedInFont = list.filter((p) => p.original !== 0).length

  const changed = useMemo(
    () =>
      [...pairs.values()]
        .filter((p) => p.kern !== p.original)
        .map((p) => ({ left: p.left, right: p.right, value: p.kern })),
    [pairs],
  )
  const hasChanges = changed.length > 0
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
      getPairs: () => pairsRef.current,
      applyKerns,
      highlight,
      log: log_,
      countCall: (tool: string) => {
        setCallCount((n) => n + 1)
        log_(`→ ${tool}`)
      },
      // Publishing selects it too — the agent chose it, so show it.
      setSpecimen: (text: string) => {
        setAgentLine(text)
        setProofText(text)
      },
    }),
    [loaded, applyKerns, highlight, log_],
  )
  useKernTools(api)
  const registered = registeredToolNames(loaded !== null)

  async function onFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    if (!file) return
    try {
      adopt(loadFontFromBuffer(await file.arrayBuffer(), file.name))
    } catch {
      setError(`Could not read ${file.name}. Kern needs a .ttf or .otf file.`)
    }
  }

  const detail = pairs.get(activeKeys[0] ?? selected)

  function exportFont() {
    if (!loaded) return
    try {
      download(
        buildKernedFont(loaded.buffer, loaded, changed),
        `${loaded.familyName.replace(/\s+/g, '')}-Kerned.ttf`,
        'font/ttf',
      )
    } catch (e) {
      setError(`Export failed: ${String(e)}`)
    }
  }

  return (
    <div className={`app ${log.length > 0 ? "has-drawer" : ""}`}>
      <header className="head">
        <h1>
          <Wordmark loaded={loaded} pairs={pairs} />
        </h1>
        <div className="head-right">
          <dl className="spec">
            <dt>face</dt>
            <dd>
              {loaded ? loaded.familyName : 'loading'}
              {loaded?.styleName && <i> {loaded.styleName}</i>}
            </dd>
            <dt>em</dt>
            <dd>{loaded ? loaded.unitsPerEm : '—'}</dd>
            <dt>shipped</dt>
            <dd>
              {kernedInFont}<i>/{list.length} kerned</i>
            </dd>
          </dl>
          <button onClick={() => fileInput.current?.click()} title="Load a font file">
            <IconUpload />
            <span className="btn-label">Load font</span>
          </button>
          <input ref={fileInput} type="file" accept=".ttf,.otf" hidden onChange={onFile} />
        </div>
      </header>

      <WebMCPStatus support={webmcp} registered={registered} />
      {error && <div className="error">{error}</div>}

      <section className="bar">
        <div className="stats">
          <span><b>{changed.length}</b> of {list.length} kerned</span>
        </div>
        <Toggle on={shade} onChange={setShade} icon={<IconContrast />}>
          <span className="btn-label">Negative space</span>
        </Toggle>
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
                loaded &&
                download(
                  buildFeatureFile(loaded, changed),
                  `${loaded.familyName.replace(/\s+/g, '')}-kern.fea`,
                  'text/plain',
                ),
            },
          ]}
        />
      </section>

      <section className={`now ${activeKeys.length ? 'live' : ''}`}>
        {activeKeys.length ? (
          <>
            <span className="dot" />
            {activeKeys.length === 1 ? (
              <>Agent is looking at <code>{activeKeys[0]}</code></>
            ) : (
              <>Agent is surveying <b>{activeKeys.length}</b> pairs</>
            )}
            {detail?.note && <span className="reason"> · {detail.note}</span>}
          </>
        ) : (
          <span className="idle">
            <span className="muted">Idle. Ask your agent:</span>
            <CopyPrompt text="Survey the kerning of the loaded font and fix what needs it, using this page’s WebMCP tools." />
          </span>
        )}
      </section>

      {loaded && (
        <Section
          label="Survey"
          meta={<>{list.length} pairs worth attention in this face</>}
        >
          <PairGrid
            loaded={loaded}
            pairs={list}
            activeKeys={activeKeys}
            onSelect={setSelected}
            shade={shade}
          />
        </Section>
      )}

      {/* Always present once a pair is selected: hiding it for untouched pairs
          made the page jump every time you clicked around the grid. */}
      {loaded && detail && (
        <Section
          label="Selected"
          meta={
            detail.attempts.length > 0 ? (
              <>
                {detail.key} · {detail.attempts.length} attempt
                {detail.attempts.length === 1 ? '' : 's'}
              </>
            ) : (
              <>{detail.key} · untouched</>
            )
          }
        >
          <PairDetail loaded={loaded} pair={detail} shade={shade} />
        </Section>
      )}

      {loaded && hasChanges && (
        <Section label="Proof" meta={<>set the line you want to judge</>}>
          <div className="specimen-head">
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
          </div>
          <Specimen
            loaded={loaded}
            word={proof}
            pairs={pairs}
            shade={shade}
          />
        </Section>
      )}

      {/* Nothing to show before the first tool call, so stay out of the way. */}
      {log.length > 0 && (
        <aside className={`drawer ${logOpen ? 'open' : ''}`}>
          <button className="drawer-handle" onClick={() => setLogOpen((v) => !v)}>
            <span>Tool calls</span>
            <b>{callCount}</b>
            <span className="chev">
              <IconChevron up={!logOpen} />
            </span>
          </button>
          <ol className="drawer-body" ref={logBody}>
            {log.map((l) => (
              <li
                key={l.id}
                className={`${l.rejected ? 'rejected' : ''} ${
                  l.text.startsWith('→') ? 'call' : ''
                }`}
              >
                <time>{new Date(l.at).toLocaleTimeString('en-GB')}</time>
                {l.text}
              </li>
            ))}
          </ol>
        </aside>
      )}

    </div>
  )
}
