import { useCallback, useEffect, useRef, useState } from 'react'
import type { LoadedFont } from './kern/font'
import { existingKern, loadFontFromBuffer, loadFontFromUrl, renderPair } from './kern/font'
import { PRIORITY_PAIRS, typicalRange } from './kern/pairs'
import type { ToolCall } from './kern/useRenderPairTool'
import { useRenderPairTool } from './kern/useRenderPairTool'

const SAMPLE_FONT = `${import.meta.env.BASE_URL}fonts/EBGaramond-Regular.ttf`

export default function App() {
  const [loaded, setLoaded] = useState<LoadedFont | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pair, setPair] = useState<[string, string]>(['A', 'V'])
  const [kern, setKern] = useState(0)
  const [preview, setPreview] = useState<string | null>(null)
  const [calls, setCalls] = useState<ToolCall[]>([])
  const [hasWebMCP, setHasWebMCP] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setHasWebMCP(typeof document !== 'undefined' && 'modelContext' in document)
  }, [])

  // Load the bundled sample so the page is useful on first paint.
  useEffect(() => {
    loadFontFromUrl(SAMPLE_FONT)
      .then(setLoaded)
      .catch((e: unknown) => setError(String(e)))
  }, [])

  // Redraw whenever the font or the pair changes.
  useEffect(() => {
    if (!loaded) return
    const seed = existingKern(loaded, pair[0], pair[1])
    setKern(seed)
  }, [loaded, pair])

  useEffect(() => {
    if (!loaded) return
    try {
      const { render } = renderPair(loaded, pair[0], pair[1], kern)
      setPreview(render.dataUrl)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [loaded, pair, kern])

  const onRender = useCallback(
    (left: string, right: string, value: number, dataUrl: string) => {
      setPair([left, right])
      setKern(value)
      setPreview(dataUrl)
    },
    [],
  )

  const onCall = useCallback((call: ToolCall) => {
    setCalls((prev) => [call, ...prev].slice(0, 60))
  }, [])

  useRenderPairTool({ loaded, onRender, onCall })

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setLoaded(loadFontFromBuffer(await file.arrayBuffer()))
      setError(null)
    } catch {
      setError(`Could not read ${file.name}. Kern needs a .ttf or .otf file.`)
    }
  }

  const range = loaded ? typicalRange(pair[0], pair[1], loaded.unitsPerEm) : null

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
          The page still works by hand below.
        </div>
      )}

      <section className="controls">
        <div className="font-row">
          <strong>{loaded ? loaded.familyName : 'Loading…'}</strong>
          {loaded && <span className="muted"> · {loaded.unitsPerEm} units/em</span>}
          <button onClick={() => fileInput.current?.click()}>Load a font</button>
          <input
            ref={fileInput}
            type="file"
            accept=".ttf,.otf"
            hidden
            onChange={onFile}
          />
        </div>

        <div className="pair-row">
          <label>
            Pair
            <input
              value={pair[0]}
              maxLength={1}
              onChange={(e) => setPair([e.target.value || 'A', pair[1]])}
            />
            <input
              value={pair[1]}
              maxLength={1}
              onChange={(e) => setPair([pair[0], e.target.value || 'V'])}
            />
          </label>
          <select
            value={`${pair[0]}${pair[1]}`}
            onChange={(e) => setPair([e.target.value[0], e.target.value[1]])}
          >
            {PRIORITY_PAIRS.map(([l, r]) => (
              <option key={`${l}${r}`} value={`${l}${r}`}>
                {l}
                {r}
              </option>
            ))}
          </select>
        </div>

        {loaded && range && (
          <div className="kern-row">
            <input
              type="range"
              min={Math.round(-0.25 * loaded.unitsPerEm)}
              max={Math.round(0.1 * loaded.unitsPerEm)}
              value={kern}
              onChange={(e) => setKern(Number(e.target.value))}
            />
            <span className="value">{kern}</span>
            <span className="muted">
              {range.pairClass} · typical {range.min} to {range.max}
            </span>
          </div>
        )}
      </section>

      {error && <div className="error">{error}</div>}

      <section className="preview">
        {preview && <img src={preview} alt={`${pair[0]}${pair[1]} at ${kern}`} />}
      </section>

      <section className="log">
        <h2>Tool calls ({calls.length})</h2>
        {calls.length === 0 && (
          <p className="muted">
            Nothing yet. Ask your agent: “Kern the pair AV in this font.”
          </p>
        )}
        <ol>
          {calls.map((c) => (
            <li key={c.at} className={c.rejected ? 'rejected' : ''}>
              <code>
                {c.left}
                {c.right}
              </code>{' '}
              kern {c.kern}
              {c.rejected ? (
                <span className="reason"> — {c.rejected}</span>
              ) : (
                <span className="muted">
                  {' '}
                  · white {c.opticalArea} · gap {c.minGap}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
