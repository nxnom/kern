import { useWebMCP } from 'usewebmcp'
import type { LoadedFont } from './font'
import { existingKern, renderPair } from './font'
import { typicalRange } from './pairs'

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    left: { type: 'string', description: 'Left character of the pair, e.g. "A"' },
    right: { type: 'string', description: 'Right character of the pair, e.g. "V"' },
    kern: {
      type: 'number',
      description:
        'Kerning adjustment in font units. Negative pulls the pair together. ' +
        'Omit to see the pair at the font’s current value.',
    },
    force: {
      type: 'boolean',
      description:
        'Set true to accept a value outside the typical range for this pair class.',
    },
  },
  required: ['left', 'right'],
} as const

export interface ToolCall {
  at: number
  left: string
  right: string
  kern: number
  opticalArea: number
  minGap: number
  rejected?: string
}

export interface RenderPairToolOptions {
  loaded: LoadedFont | null
  /** Show the result on screen, so the human sees what the agent sees. */
  onRender: (
    left: string,
    right: string,
    kern: number,
    dataUrl: string,
  ) => void
  onCall: (call: ToolCall) => void
}

/**
 * The single tool Kern exposes.
 *
 * It returns the rendered pair as an image *and* the optical measurements,
 * because a vision model judges the direction of a spacing error well and its
 * magnitude badly. It refuses values outside the plausible range for the
 * pair's shape class, which corrects a measured tendency to over-tighten.
 */
export function useRenderPairTool({
  loaded,
  onRender,
  onCall,
}: RenderPairToolOptions) {
  return useWebMCP({
    name: 'render_pair',
    description:
      'Render a two-character pair at a given kerning value and return the image ' +
      'plus optical spacing measurements. Judge the image for direction (too tight ' +
      'or too loose) and use the measurements to choose the magnitude. Call repeatedly ' +
      'to converge on even spacing.',
    inputSchema: INPUT_SCHEMA,
    enabled: loaded !== null,
    execute: async ({ left, right, kern, force }) => {
      if (!loaded) throw new Error('No font is loaded yet. Ask the user to load one.')
      if ([...left].length !== 1 || [...right].length !== 1) {
        throw new Error('left and right must each be exactly one character.')
      }

      const current = existingKern(loaded, left, right)
      const value = kern ?? current
      const range = typicalRange(left, right, loaded.unitsPerEm)

      if (!force && (value < range.min || value > range.max)) {
        const msg =
          `Rejected: ${value} is outside the typical range for ` +
          `${range.pairClass} pairs (${range.min} to ${range.max} font units). ` +
          `Revise, or repeat with force: true if you are confident.`
        onCall({ at: Date.now(), left, right, kern: value, opticalArea: 0, minGap: 0, rejected: msg })
        return { content: [{ type: 'text' as const, text: msg }], isError: true }
      }

      const { render, metrics } = renderPair(loaded, left, right, value)
      onRender(left, right, value, render.dataUrl)
      onCall({
        at: Date.now(),
        left,
        right,
        kern: value,
        opticalArea: metrics.opticalArea,
        minGap: metrics.minGap,
      })

      return {
        content: [
          { type: 'image' as const, data: render.base64, mimeType: 'image/png' },
          {
            type: 'text' as const,
            text: [
              `pair: ${left}${right}`,
              `kern: ${value} font units (em = ${loaded.unitsPerEm})`,
              `font's own value: ${current}`,
              `optical white area: ${metrics.opticalArea}`,
              `narrowest gap: ${metrics.minGap}`,
              metrics.collides ? 'WARNING: the outlines collide.' : '',
              `typical range for ${range.pairClass}: ${range.min} to ${range.max}`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      }
    },
  }, [loaded])
}
