import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PairGrid } from './PairGrid'
import { Specimen } from './Specimen'
import type { LoadedFont } from './kern/font'
import { drawPair, loadFontFromBuffer, loadFontFromUrl } from './kern/font'
import { SPECIMEN_WORDS, typicalRange } from './kern/pairs'
import type { PairState } from './kern/state'
import { initialPairs, pairKey } from './kern/state'
import { buildFeatureFile, buildKernedFont, download } from './kern/export'
import type { Applied, KernApi, Rejected } from './kern/useKernTools'
import { checkRange, useKernTools } from './kern/useKernTools'

const SAMPLE_FONT = `${import.meta.env.BASE_URL}fonts/EBGaramond-Regular.ttf`
/** How long tiles stay lit after the agent touches them. */
const ACTIVE_MS = 2600

interface LogLine { id: number; text: string; rejected: boolean }

export default function App() {
  const [loaded, setLoaded] = useState<LoadedFont | null>(null)
  const [pairs, setPairs] = useState<Map<string, PairState>>(new Map())
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [selected, setSelected] = useState('AV')
  const [showOriginal, setShowOriginal] = useState(false)
  const [shade, setShade] = useState(true)
  const [log, setLog] = useState<LogLine[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasWebMCP, setHasWebMCP] = useState(false)

  const fileInput = useRef<HTMLInputElement>(null)
  const activeTimer = useRef<number | undefined>(undefined)
  const logId = useRef(0)
  // Tools read state through this ref so they never close over a stale map,
  // and so registering them does not depend on every keystroke of state.
  const pairsRef = useRef(pairs)
  pairsRef.current = pairs

  useEffect(() => {
    setHasWebMCP(typeof document !== 'undefined' && 'modelContext' in document)
  }, [])

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

  const log_ = useCallback((text: string, rejected = false) => {
    setLog((prev) => [{ id: logId.current++, text, rejected }, ...prev].slice(0, 250))
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
              attempts: [...cur.attempts, u.value],
            })
            continue
          }
          applied.push({ key, from: cur.kern, to: u.value })
          next.set(key, {
            ...cur,
            kern: u.value,
            status: 'adjusted',
            note: undefined,
            attempts: [...cur.attempts, u.value],
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
  const calls = list.reduce((n, p) => n + p.attempts.length, 0)
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
      hasChanges,
    }),
    [loaded, applyKerns, highlight, log_, hasChanges],
  )
  useKernTools(api)

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
    <div className="app">
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
          <button onClick={() => fileInput.current?.click()}>Load font</button>
          <input ref={fileInput} type="file" accept=".ttf,.otf" hidden onChange={onFile} />
        </div>
      </header>

      {!hasWebMCP && (
        <div className="banner">
          WebMCP not detected. Open in the ChatGPT app’s browser, or Chrome 149+ with{' '}
          <code>chrome://flags/#enable-webmcp-testing</code> enabled.
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <section className="bar">
        <div className="stats">
          <span><b>{changed.length}</b> of {list.length} kerned</span>
          <span><b>{calls}</b> tool calls</span>
        </div>
        <button className={shade ? 'on' : ''} onClick={() => setShade((v) => !v)}>
          Negative space
        </button>
        {hasChanges && (
          <button
            className={showOriginal ? 'on' : ''}
            onMouseDown={() => setShowOriginal(true)}
            onMouseUp={() => setShowOriginal(false)}
            onMouseLeave={() => setShowOriginal(false)}
          >
            {showOriginal ? 'Showing before' : 'Hold to compare'}
          </button>
        )}
        <button onClick={exportFont} disabled={!hasChanges}>Download .ttf</button>
        <button
          onClick={() =>
            loaded &&
            download(
              buildFeatureFile(loaded, changed),
              `${loaded.familyName.replace(/\s+/g, '')}-kern.fea`,
              'text/plain',
            )
          }
          disabled={!hasChanges}
        >
          Download .fea
        </button>
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
          <span className="muted">
            Idle. Ask your agent: “Survey the kerning on this page and fix what needs it.”
          </span>
        )}
      </section>

      {loaded && (
        <PairGrid
          loaded={loaded}
          pairs={list}
          activeKeys={activeKeys}
          onSelect={setSelected}
          showOriginal={showOriginal}
          shade={shade}
        />
      )}

      {loaded && detail && (
        <section className="detail">
          {detailChanged && (
            <figure>
              <img src={drawPair(loaded, detail.left, detail.right, detail.original, 140, shade)} alt="before" />
              <figcaption>before · {detail.original}</figcaption>
            </figure>
          )}
          <figure className={detailChanged ? 'changed' : ''}>
            <img src={drawPair(loaded, detail.left, detail.right, detail.kern, 140, shade)} alt={detail.key} />
            <figcaption>{detailChanged ? `after · ${detail.kern}` : `${detail.key} · ${detail.kern}`}</figcaption>
          </figure>
          <dl>
            <dt>class</dt>
            <dd>{typicalRange(detail.left, detail.right, loaded.unitsPerEm).pairClass}</dd>
            {detailChanged && (<><dt>change</dt><dd>{detail.kern - detail.original}</dd></>)}
            <dt>attempts</dt><dd>{detail.attempts.length}</dd>
          </dl>
        </section>
      )}

      {loaded && (
        <section className="specimen">
          {SPECIMEN_WORDS.map((w) => (
            <Specimen key={w} loaded={loaded} word={w} pairs={pairs} showBefore={hasChanges} />
          ))}
        </section>
      )}

      <aside className={`drawer ${logOpen ? 'open' : ''}`}>
        <button className="drawer-handle" onClick={() => setLogOpen((v) => !v)}>
          <span>Tool calls</span>
          <b>{log.length}</b>
          <span className="chev">{logOpen ? '▾' : '▴'}</span>
        </button>
        <ol className="drawer-body">
          {log.map((l) => (
            <li key={l.id} className={l.rejected ? 'rejected' : ''}>{l.text}</li>
          ))}
        </ol>
      </aside>
    </div>
  )
}
