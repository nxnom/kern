import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PairGrid } from './PairGrid'
import { Specimen } from './Specimen'
import type { LoadedFont } from './kern/font'
import { drawPair, loadFontFromBuffer, loadFontFromUrl } from './kern/font'
import { SPECIMEN_WORDS, typicalRange } from './kern/pairs'
import type { PairState } from './kern/state'
import { initialPairs, pairKey } from './kern/state'
import { buildFeatureFile, buildKernedFont, download } from './kern/export'
import type { ToolEvent } from './kern/useRenderPairTool'
import { useRenderPairTool } from './kern/useRenderPairTool'

const SAMPLE_FONT = `${import.meta.env.BASE_URL}fonts/EBGaramond-Regular.ttf`
/** How long a tile stays lit after the agent touches it. */
const ACTIVE_MS = 2200

interface LogLine {
  id: number
  text: string
  rejected: boolean
}

export default function App() {
  const [loaded, setLoaded] = useState<LoadedFont | null>(null)
  const [pairs, setPairs] = useState<Map<string, PairState>>(new Map())
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [selected, setSelected] = useState('AV')
  const [showOriginal, setShowOriginal] = useState(false)
  const [log, setLog] = useState<LogLine[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasWebMCP, setHasWebMCP] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const activeTimer = useRef<number | undefined>(undefined)
  const logId = useRef(0)

  useEffect(() => {
    setHasWebMCP(typeof document !== 'undefined' && 'modelContext' in document)
  }, [])

  useEffect(() => {
    loadFontFromUrl(SAMPLE_FONT).then(adopt).catch((e: unknown) => setError(String(e)))
  }, [])

  function adopt(lf: LoadedFont) {
    setLoaded(lf)
    setPairs(initialPairs(lf))
    setLog([])
    setActiveKey(null)
    setError(null)
  }

  /** Every tool call lands here: light the tile, record the attempt, log it. */
  const onEvent = useCallback((e: ToolEvent) => {
    const key = pairKey(e.left, e.right)

    setActiveKey(key)
    window.clearTimeout(activeTimer.current)
    activeTimer.current = window.setTimeout(() => setActiveKey(null), ACTIVE_MS)

    setPairs((prev) => {
      const next = new Map(prev)
      const cur = next.get(key)
      if (!cur) return prev
      next.set(key, {
        ...cur,
        kern: e.rejected ? cur.kern : e.kern,
        status: e.rejected
          ? 'rejected'
          : e.kern === cur.original
            ? 'examining'
            : 'adjusted',
        attempts: [...cur.attempts, e.kern],
        note: e.rejected,
        touchedAt: Date.now(),
      })
      return next
    })

    setLog((prev) =>
      [
        {
          id: logId.current++,
          rejected: Boolean(e.rejected),
          text: e.rejected
            ? `${e.left}${e.right} — proposed ${e.kern}, rejected as out of range`
            : `${e.left}${e.right} — kern ${e.kern} · white ${e.opticalArea} · gap ${e.minGap}` +
              (e.collides ? ' · COLLIDES' : ''),
        },
        ...prev,
      ].slice(0, 200),
    )
  }, [])

  useRenderPairTool({ loaded, onEvent })

  async function onFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    if (!file) return
    try {
      adopt(loadFontFromBuffer(await file.arrayBuffer()))
    } catch {
      setError(`Could not read ${file.name}. Kern needs a .ttf or .otf file.`)
    }
  }

  const list = useMemo(() => [...pairs.values()], [pairs])
  const changed = useMemo(
    () =>
      list
        .filter((p) => p.kern !== p.original)
        .map((p) => ({ left: p.left, right: p.right, value: p.kern })),
    [list],
  )
  const calls = list.reduce((n, p) => n + p.attempts.length, 0)
  const detail = pairs.get(activeKey ?? selected)

  function exportFont() {
    if (!loaded) return
    try {
      const bytes = buildKernedFont(loaded.buffer, loaded, changed)
      download(bytes, `${loaded.familyName.replace(/\s+/g, '')}-Kerned.ttf`, 'font/ttf')
    } catch (e) {
      setError(`Export failed: ${String(e)}`)
    }
  }

  function exportFeatures() {
    if (!loaded) return
    download(
      buildFeatureFile(loaded, changed),
      `${loaded.familyName.replace(/\s+/g, '')}-kern.fea`,
      'text/plain',
    )
  }

  return (
    <div className={`app ${logOpen ? 'log-open' : ''}`}>
      <header className="head">
        <h1>Kern</h1>
        <div className="head-right">
          <strong>{loaded ? loaded.familyName : 'Loading…'}</strong>
          {loaded && <span className="muted"> · {loaded.unitsPerEm} units/em</span>}
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
        <button
          className={showOriginal ? 'on' : ''}
          onMouseDown={() => setShowOriginal(true)}
          onMouseUp={() => setShowOriginal(false)}
          onMouseLeave={() => setShowOriginal(false)}
          onClick={() => setShowOriginal((v) => !v)}
        >
          {showOriginal ? 'Showing before' : 'Hold to compare'}
        </button>
        <button onClick={exportFont} disabled={!changed.length}>
          Download .ttf
        </button>
        <button onClick={exportFeatures} disabled={!changed.length}>
          Download .fea
        </button>
      </section>

      <section className={`now ${activeKey ? 'live' : ''}`}>
        {activeKey ? (
          <>
            <span className="dot" />
            Agent is looking at <code>{activeKey}</code>
            {detail && detail.attempts.length > 1 && (
              <span className="muted"> · attempt {detail.attempts.length}</span>
            )}
            {detail?.note && <span className="reason"> · {detail.note}</span>}
          </>
        ) : (
          <span className="muted">
            Idle. Ask your agent: “Work through the kerning pairs on this page.”
          </span>
        )}
      </section>

      {loaded && (
        <PairGrid
          loaded={loaded}
          pairs={list}
          activeKey={activeKey}
          onSelect={setSelected}
          showOriginal={showOriginal}
        />
      )}

      {loaded && detail && (
        <section className="detail">
          <figure>
            <img src={drawPair(loaded, detail.left, detail.right, detail.original, 150)} alt="before" />
            <figcaption>before · {detail.original}</figcaption>
          </figure>
          <figure className={detail.kern !== detail.original ? 'changed' : ''}>
            <img src={drawPair(loaded, detail.left, detail.right, detail.kern, 150)} alt="after" />
            <figcaption>after · {detail.kern}</figcaption>
          </figure>
          <dl>
            <dt>class</dt>
            <dd>{typicalRange(detail.left, detail.right, loaded.unitsPerEm).pairClass}</dd>
            <dt>change</dt>
            <dd>{detail.kern - detail.original}</dd>
            <dt>attempts</dt><dd>{detail.attempts.length}</dd>
          </dl>
        </section>
      )}

      {loaded && (
        <section className="specimen">
          {SPECIMEN_WORDS.map((w) => (
            <Specimen key={w} loaded={loaded} word={w} pairs={pairs} />
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
