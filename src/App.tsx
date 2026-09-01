import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CopyPrompt } from './CopyPrompt'
import { DownloadMenu } from './DownloadMenu'
import { IconChevron, IconContrast, IconUpload } from './Icons'
import { Toggle } from './Toggle'
import { PairDetail } from './PairDetail'
import { PairGrid } from './PairGrid'
import { Specimen } from './Specimen'
import type { LoadedFont } from './kern/font'
import { loadFontFromBuffer, loadFontFromUrl } from './kern/font'
import type { PairState } from './kern/state'
import { initialPairs, pairKey } from './kern/state'
import { useWebMCPSupport } from './kern/useWebMCPSupport'
import { WebMCPStatus } from './WebMCPStatus'
import { buildFeatureFile, buildKernedFont, download } from './kern/export'
import type { Applied, KernApi, Rejected } from './kern/useKernTools'
import { checkRange, registeredToolNames, useKernTools } from './kern/useKernTools'

const SAMPLE_FONT = `${import.meta.env.BASE_URL}fonts/EBGaramond-Regular.ttf`
/** How long tiles stay lit after the agent touches them. */
const ACTIVE_MS = 2600

interface LogLine { id: number; at: number; text: string; rejected: boolean }

export default function App() {
  const webmcp = useWebMCPSupport()
  const [loaded, setLoaded] = useState<LoadedFont | null>(null)
  const [pairs, setPairs] = useState<Map<string, PairState>>(new Map())
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [selected, setSelected] = useState('AV')
  const [shade, setShade] = useState(true)
  const [specimen, setSpecimenState] = useState<
    { text: string; note?: string; fromAgent: string } | null
  >(null)
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
    loadFontFromUrl(SAMPLE_FONT, 'bundled sample').then(adopt).catch((e: unknown) => setError(String(e)))
  }, [])

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
  const applyKerns = useCallback(
    (updates: { left: string; right: string; value: number }[], force: boolean) => {
      const applied: Applied[] = []
      const rejected: Rejected[] = []
      const em = pairsRef.current.size ? loadedRef.current!.unitsPerEm : 1000

      setPairs((prev) => {
        const next = new Map(prev)
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
        return next
      })

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
      hasChanges,
      setSpecimen: (text: string, note?: string) =>
        setSpecimenState({ text, note, fromAgent: text }),
    }),
    [loaded, applyKerns, highlight, log_, hasChanges],
  )
  useKernTools(api)
  const registered = registeredToolNames(loaded !== null, hasChanges)

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
  const detailChanged = detail ? detail.kern !== detail.original : false

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
        <h1>Kern</h1>
        <div className="head-right">
          <div className="font-id">
            <strong>
              {loaded ? loaded.familyName : 'Loading…'}
              {loaded?.styleName && <span className="style"> {loaded.styleName}</span>}
            </strong>
            {loaded && (
              <span className="muted">
                {loaded.source} · {loaded.unitsPerEm} units/em ·{' '}
                {kernedInFont} of {list.length} pairs already kerned
              </span>
            )}
          </div>
          <button onClick={() => fileInput.current?.click()}>
            <IconUpload />
            Load font
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
          Negative space
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
        <PairGrid
          loaded={loaded}
          pairs={list}
          activeKeys={activeKeys}
          onSelect={setSelected}
          shade={shade}
        />
      )}

      {loaded && detail && (detail.attempts.length > 0 || detailChanged) && (
        <PairDetail loaded={loaded} pair={detail} shade={shade} />
      )}

      {loaded && specimen && (
        <section className="specimen">
          <div className="specimen-head">
            <h2>Proof</h2>
            <input
              value={specimen.text}
              aria-label="Specimen text"
              spellCheck={false}
              onChange={(e) =>
                setSpecimenState({ ...specimen, text: e.target.value })
              }
            />
            {specimen.text === specimen.fromAgent ? (
              <span className="muted">chosen by the agent · edit it if you like</span>
            ) : (
              <button
                onClick={() =>
                  setSpecimenState({ ...specimen, text: specimen.fromAgent })
                }
              >
                Reset to the agent’s
              </button>
            )}
          </div>
          <Specimen loaded={loaded} word={specimen.text} pairs={pairs} showBefore />
          {specimen.note && specimen.text === specimen.fromAgent && (
            <p className="specimen-note">{specimen.note}</p>
          )}
        </section>
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
