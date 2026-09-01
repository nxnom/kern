import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PairGrid } from './PairGrid'
import type { LoadedFont } from './kern/font'
import { drawPair, loadFontFromBuffer, loadFontFromUrl } from './kern/font'
import { SPECIMEN_WORDS, typicalRange } from './kern/pairs'
import type { PairState } from './kern/state'
import { initialPairs, pairKey } from './kern/state'
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
  const [selected, setSelected] = useState<string>('AV')
  const [log, setLog] = useState<LogLine[]>([])
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
      const cur =
        next.get(key) ??
        ({
          key,
          left: e.left,
          right: e.right,
          original: 0,
          kern: 0,
          status: 'untouched',
          attempts: [],
        } as PairState)

      next.set(key, {
        ...cur,
        kern: e.rejected ? cur.kern : e.kern,
        status: e.rejected ? 'rejected' : e.kern === cur.original ? 'examining' : 'adjusted',
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
            : `${e.left}${e.right} — kern ${e.kern}, white ${e.opticalArea}, gap ${e.minGap}` +
              (e.collides ? ' — COLLIDES' : ''),
        },
        ...prev,
      ].slice(0, 80),
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
  const touched = list.filter((p) => p.status === 'adjusted').length
  const calls = list.reduce((n, p) => n + p.attempts.length, 0)
  const detail = pairs.get(activeKey ?? selected)

  return (
    <div className="app">
      <header>
        <h1>Kern</h1>
        <p className="tagline">
          Kerning is not about making the distance between letters equal. It is about
          making the <em>negative space</em> between them look equal. That is why a
          script cannot do it, and why an agent that can see can.
        </p>
      </header>

      {!hasWebMCP && (
        <div className="banner">
          WebMCP not detected. Open this page in the ChatGPT app’s browser, or in
          Chrome 149+ with <code>chrome://flags/#enable-webmcp-testing</code> enabled.
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <section className="bar">
        <div>
          <strong>{loaded ? loaded.familyName : 'Loading…'}</strong>
          {loaded && <span className="muted"> · {loaded.unitsPerEm} units/em</span>}
        </div>
        <div className="stats">
          <span><b>{touched}</b> of {list.length} kerned</span>
          <span><b>{calls}</b> tool calls</span>
        </div>
        <button onClick={() => fileInput.current?.click()}>Load a font</button>
        <input ref={fileInput} type="file" accept=".ttf,.otf" hidden onChange={onFile} />
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
        />
      )}

      {loaded && detail && (
        <section className="detail">
          <img
            src={drawPair(loaded, detail.left, detail.right, detail.kern, 190)}
            alt={detail.key}
          />
          <dl>
            <dt>pair</dt><dd>{detail.key}</dd>
            <dt>kern</dt><dd>{detail.kern}</dd>
            <dt>was</dt><dd>{detail.original}</dd>
            <dt>class</dt>
            <dd>{typicalRange(detail.left, detail.right, loaded.unitsPerEm).pairClass}</dd>
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

      <section className="log">
        <h2>Tool calls</h2>
        <ol>
          {log.map((l) => (
            <li key={l.id} className={l.rejected ? 'rejected' : ''}>{l.text}</li>
          ))}
        </ol>
      </section>
    </div>
  )
}

/** Specimen text drawn with whatever kerning the agent has settled on so far. */
function Specimen({
  loaded,
  word,
  pairs,
}: {
  loaded: LoadedFont
  word: string
  pairs: Map<string, PairState>
}) {
  const chars = [...word]
  return (
    <div className="word">
      {chars.map((ch, i) => {
        const next = chars[i + 1]
        const k = next ? pairs.get(pairKey(ch, next))?.kern ?? 0 : 0
        return (
          <span
            key={`${ch}-${i}`}
            style={{ marginRight: `${(k / loaded.unitsPerEm) * 46}px` }}
          >
            {ch}
          </span>
        )
      })}
    </div>
  )
}
