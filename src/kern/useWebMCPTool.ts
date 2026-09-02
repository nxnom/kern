import { useEffect } from 'react'

/**
 * Register a tool on `document.modelContext`, the WebMCP API itself.
 *
 * MCP-B's `usewebmcp` hook does this too, and does it well — but it hides the
 * one call this whole project is about. Registering directly keeps the spec's
 * API visible in the source, and makes the lifecycle explicit: an
 * AbortController per registration, aborted on unmount or when `enabled` goes
 * false, which is what fires `toolchange` for the agent.
 *
 * There is no polyfill behind this. `document.modelContext` is either provided
 * by the browser or it is not, and when it is not the page stays a manual
 * kerning workbench rather than pretending an agent could reach it.
 */
export interface ToolResult {
  content: (
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  )[]
  isError?: boolean
}

export interface WebMCPToolOptions<TInput> {
  name: string
  description: string
  inputSchema?: object
  /**
   * The two hints WebMCP defines. MCP's server-side set is larger —
   * `idempotentHint`, `openWorldHint`, `destructiveHint` — but the browser API
   * carries only these, so the rest would be silently dropped.
   */
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
  /** When false the tool is not registered, and is unregistered if it was. */
  enabled?: boolean
  execute: (input: TInput) => Promise<ToolResult> | ToolResult
}

interface ModelContext {
  registerTool: (
    tool: {
      name: string
      description: string
      inputSchema?: object
      annotations?: object
      execute: (input: unknown) => unknown
    },
    options?: { signal?: AbortSignal },
  ) => Promise<void>
}

function modelContext(): ModelContext | undefined {
  if (typeof document === 'undefined') return undefined
  const doc = document as unknown as { modelContext?: ModelContext }
  // `navigator.modelContext` was the earlier spelling; some runtimes still use it.
  const nav = navigator as unknown as { modelContext?: ModelContext }
  return doc.modelContext ?? nav.modelContext
}

export function useWebMCPTool<TInput = Record<string, unknown>>(
  options: WebMCPToolOptions<TInput>,
  deps: unknown[] = [],
) {
  const { name, description, inputSchema, annotations, enabled = true, execute } = options

  useEffect(() => {
    if (!enabled) return
    const context = modelContext()
    if (!context) return

    const controller = new AbortController()
    void context
      .registerTool(
        {
          name,
          description,
          inputSchema,
          annotations,
          execute: (input) => execute(input as TInput),
        },
        { signal: controller.signal },
      )
      .catch((error: unknown) => {
        console.warn(`Kern: could not register "${name}"`, error)
      })

    // Aborting unregisters the tool and fires `toolchange`.
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, enabled, ...deps])
}
