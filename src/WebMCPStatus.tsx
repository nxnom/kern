import { useState } from 'react'
import type { WebMCPSupport } from './kern/useWebMCPSupport'

/**
 * What the browser can and cannot do, said plainly.
 *
 * A judge who opens this in the wrong browser sees an app that silently does
 * nothing, and concludes it is broken. Chrome's own demos have this problem.
 */
export function WebMCPStatus({
  support,
  registered,
}: {
  support: WebMCPSupport
  /** What this page registered — the answer we can actually vouch for. */
  registered: string[]
}) {
  const [copied, setCopied] = useState(false)

  // Nothing to say while it is working: the tools tab carries the detail, and
  // a green banner on every load is a claim nobody needs repeated.
  if (support.status === 'checking') return null
  if (support.status === 'ready' && registered.length > 0) return null

  if (support.status === 'unsupported') {
    return (
      <div className="status error" role="alert">
        <h2>WebMCP is not available in this browser</h2>
        <p>
          Kern hands its tools to an AI agent through <code>document.modelContext</code>,
          which this browser does not provide. Everything below still works by hand —
          load a font, click a pair, drag the value — but no agent can drive it.
        </p>
        <div className="fixes">
          <div>
            <h3>ChatGPT app</h3>
            <p>
              Open this URL in the app’s built-in browser, and pick <b>GPT 5.6</b> or
              newer. Older models have no WebMCP tools and will fall back to clicking
              around the page.
            </p>
          </div>
          <div>
            <h3>Google Chrome 149+</h3>
            <ol>
              <li>
                Go to <code>chrome://flags/#enable-webmcp-testing</code>
              </li>
              <li>Set it to <b>Enabled</b>, then <b>Relaunch</b></li>
              <li>
                Check <code>chrome://version</code> if the flag is missing — below 149
                it does not exist
              </li>
            </ol>
          </div>
        </div>
        <button
          className="verify"
          onClick={() => {
            void navigator.clipboard?.writeText('document.modelContext')
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }}
        >
          {copied ? 'Copied' : 'Copy the console check'}
        </button>
        <span className="muted">
          Paste it in DevTools. An object means it works; <code>undefined</code> means
          the flag did not take.
        </span>
      </div>
    )
  }

  if (registered.length === 0) {
    return (
      <div className="status warn" role="alert">
        <b>No tools registered yet.</b>{' '}
        <span className="muted">
          {support.error ? support.error.message : 'Waiting for a font to load.'}
        </span>
      </div>
    )
  }

  // The polyfill installs the API but cannot conjure an agent to call it, so
  // say plainly that this browser can host the tools and not use them.
  if (support.source === 'polyfill') {
    return (
      <details className="status warn">
        <summary>
          <b>WebMCP polyfill active</b>
          <span className="muted">
            {registered.length} tools registered · no agent can reach them in this
            browser
          </span>
        </summary>
        <p>
          This browser has no built-in WebMCP, so <code>@mcp-b/global</code> installed
          the API and Kern registered its tools against it. That is enough to inspect
          them, but nothing here can call them. Open this URL in the ChatGPT app’s
          browser, or Chrome 149+ with the flag enabled.
        </p>
        <ToolList names={registered} />
      </details>
    )
  }

  return null
}

function ToolList({ names }: { names: string[] }) {
  return (
    <ul>
      {names.map((t) => (
        <li key={t}><code>{t}</code></li>
      ))}
    </ul>
  )
}
