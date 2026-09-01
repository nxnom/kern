import { useState } from 'react'
import type { WebMCPSupport } from './kern/useWebMCPSupport'

/**
 * What the browser can and cannot do, said plainly.
 *
 * A judge who opens this in the wrong browser sees an app that silently does
 * nothing, and concludes it is broken. Chrome's own demos have this problem.
 */
export function WebMCPStatus({ support }: { support: WebMCPSupport }) {
  const [copied, setCopied] = useState(false)

  if (support.status === 'checking') {
    return <div className="status checking">Looking for WebMCP…</div>
  }

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

  // Supported, but nothing registered — a real failure, and a different one.
  if (support.tools.length === 0) {
    return (
      <div className="status warn" role="alert">
        <b>WebMCP is available but no tools registered.</b>{' '}
        <span className="muted">
          {support.error
            ? support.error.message
            : 'Load a font — the tools register once one is in memory.'}
        </span>
      </div>
    )
  }

  return (
    <details className="status ok">
      <summary>
        <b>{support.source === 'native' ? 'Native WebMCP' : 'WebMCP polyfill'}</b>
        <span className="muted">{support.tools.length} tools registered</span>
      </summary>
      <ul>
        {support.tools.map((t) => (
          <li key={t}><code>{t}</code></li>
        ))}
      </ul>
    </details>
  )
}
