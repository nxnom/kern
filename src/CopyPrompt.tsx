import { useState } from 'react'

/** The prompt that reliably routes to the tools, one click away. */
export function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="copy-prompt">
      <code>{text}</code>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}
