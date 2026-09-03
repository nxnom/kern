import { useEffect, useState } from 'react'

/**
 * No polyfill any more, so there is no third state: either the browser
 * implements `document.modelContext` or it does not.
 */
export type WebMCPSource = 'native' | 'none'

/**
 * `checking` matters: the poll runs for ten seconds, so treating "not found
 * yet" as "not supported" would flash a scary alert at every visitor.
 */
export type WebMCPStatus = 'checking' | 'ready' | 'unsupported'

export interface WebMCPSupport {
  status: WebMCPStatus
  supported: boolean
  source: WebMCPSource
  /** Names of the tools currently registered, live. */
  tools: string[]
  error: Error | null
}

interface ModelContextLike extends EventTarget {
  getTools?: () => Promise<{ name: string }[]>
}

/** How long to keep looking, matching Chrome's own demos. */
const POLL_MS = 500
/**
 * Say "not supported" after a second and a half, not ten seconds.
 *
 * The old code waited twenty polls before admitting the browser had no WebMCP,
 * so an ordinary Chrome tab showed nothing at all for ten seconds — long
 * enough that anyone opening the link concluded the detection was broken.
 */
const SETTLE_TRIES = 3
/** Then keep an eye out, slowly, in case an extension installs it late. */
const SLOW_POLL_MS = 2000
const MAX_TRIES = SETTLE_TRIES + 60

function readContext(): ModelContextLike | undefined {
  if (typeof document === 'undefined') return undefined
  const doc = document as unknown as { modelContext?: ModelContextLike }
  // `navigator.modelContext` was the earlier spelling and still appears in
  // older runtimes and in most published tutorials.
  const nav = navigator as unknown as { modelContext?: ModelContextLike }
  return doc.modelContext ?? nav.modelContext
}

/**
 * Detect WebMCP and track the live tool list.
 *
 * Presence alone is not enough to check once and stop: a polyfill or a browser
 * extension can install `document.modelContext` after the page has loaded, and
 * `registerTool()` resolves asynchronously, so an immediate read of getTools()
 * can land before any tool exists. So poll until it appears, then follow the
 * `toolchange` event.
 */
export function useWebMCPSupport(): WebMCPSupport {
  const [support, setSupport] = useState<WebMCPSupport>({
    status: 'checking',
    supported: false,
    source: 'none',
    tools: [],
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    let tries = 0
    let timer: number | undefined
    let bound: ModelContextLike | undefined

    const readTools = (mc: ModelContextLike) => {
      if (!mc.getTools) return
      mc.getTools()
        .then((tools) => {
          if (cancelled) return
          setSupport((prev) => ({ ...prev, tools: tools.map((t) => t.name) }))
        })
        .catch((e: unknown) => {
          if (!cancelled) setSupport((prev) => ({ ...prev, error: e as Error }))
        })
    }

    const attach = (mc: ModelContextLike) => {
      bound = mc
      setSupport((prev) => ({
        ...prev,
        status: 'ready',
        supported: true,
        source: 'native',
      }))
      mc.addEventListener?.('toolchange', () => readTools(mc))
      readTools(mc)
      // Tool registration resolves a tick or two after mount.
      timer = window.setTimeout(() => readTools(mc), POLL_MS)
    }

    const look = () => {
      if (cancelled) return
      const mc = readContext()
      if (mc) return attach(mc)
      tries += 1
      // Report it once, early, and then carry on watching rather than giving
      // up: `attach` upgrades the state if the API turns up later.
      if (tries === SETTLE_TRIES) {
        setSupport((prev) => ({ ...prev, status: 'unsupported' }))
      }
      if (tries >= MAX_TRIES) return
      timer = window.setTimeout(look, tries < SETTLE_TRIES ? POLL_MS : SLOW_POLL_MS)
    }
    look()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (bound) bound.removeEventListener?.('toolchange', () => {})
    }
  }, [])

  return support
}
