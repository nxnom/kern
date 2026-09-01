import { useEffect, useState } from 'react'

export type WebMCPSource = 'native' | 'polyfill' | 'none'

export interface WebMCPSupport {
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
const MAX_TRIES = 20

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
      const native = Boolean(
        (window as unknown as { __KERN_NATIVE_WEBMCP__?: boolean }).__KERN_NATIVE_WEBMCP__,
      )
      setSupport((prev) => ({
        ...prev,
        supported: true,
        source: native ? 'native' : 'polyfill',
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
      if (++tries >= MAX_TRIES) return
      timer = window.setTimeout(look, POLL_MS)
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
