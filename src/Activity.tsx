import { CopyPrompt } from './CopyPrompt'

const PROMPT =
  'Survey the kerning of the loaded font and fix what needs it, using this page’s WebMCP tools.'

export interface Activity {
  tool: string
  at: number
}

/**
 * What the agent is doing, in the agent's own terms.
 *
 * There is no disconnect event to listen for, so "working" is simply "a tool
 * was called recently". After a quiet spell the strip stops narrating and
 * reports what was actually achieved, which is the more useful thing to read
 * once the work has stopped.
 */
function phrase(tool: string, keys: string[]): string {
  const one = keys[0]
  switch (tool) {
    case 'list_pairs':
      return 'Reading the pair list'
    case 'survey_pairs':
      return keys.length > 1 ? `Surveying ${keys.length} pairs` : 'Surveying the font'
    case 'preview_pair':
      return one ? `Looking closely at ${one}` : 'Looking closely at one pair'
    case 'set_kern':
      return keys.length > 1 ? `Applying ${keys.length} values` : 'Applying a value'
    case 'publish_specimen':
      return 'Writing a specimen'
    default:
      return 'Working'
  }
}

export function ActivityStrip({
  activity,
  activeKeys,
  note,
  changed,
  total,
  calls,
  everCalled,
}: {
  activity: Activity | null
  activeKeys: string[]
  note?: string
  changed: number
  total: number
  calls: number
  /** Once an agent has called anything, the prompt has served its purpose. */
  everCalled: boolean
}) {
  if (activity) {
    return (
      <span className="idle">
        <span className="dot" />
        {phrase(activity.tool, activeKeys)}
        {note && <span className="reason"> · {note}</span>}
      </span>
    )
  }

  // Quiet, but there is work on the page: say where things stand. A restored
  // session has changes with no calls behind them, which is a different
  // sentence — the work happened, just not in this visit.
  if (changed > 0) {
    return (
      <span className="idle">
        <span className="muted">
          {calls > 0 ? (
            <>
              Agent is idle. <b>{changed}</b> of {total} pairs kerned over {calls} tool
              call{calls === 1 ? '' : 's'} — export the font, or ask for more.
            </>
          ) : (
            <>
              <b>{changed}</b> of {total} pairs were kerned in an earlier session.
              Export the font, or ask the agent to carry on.
            </>
          )}
        </span>
      </span>
    )
  }

  // The agent has been here but applied nothing: say so rather than handing
  // back a prompt that has already been used.
  if (everCalled) {
    return (
      <span className="idle">
        <span className="muted">
          Agent is idle after {calls} tool call{calls === 1 ? '' : 's'}. Nothing has
          been applied yet.
        </span>
      </span>
    )
  }

  return (
    <span className="idle">
      <span className="muted">Idle. Ask your agent:</span>
      <CopyPrompt text={PROMPT} />
    </span>
  )
}
