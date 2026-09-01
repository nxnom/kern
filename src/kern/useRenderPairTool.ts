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
        'Omit to inspect the pair at its current value before changing anything.',
    },
    force: {
      type: 'boolean',
      description:
        'Accept a value outside the typical range for this pair class. Use only ' +
        'when the render clearly justifies it.',
    },
  },
  required: ['left', 'right'],
} as const

export interface ToolEvent {
  left: string
  right: string
  kern: number
  opticalArea: number
  minGap: number
  collides: boolean
  rejected?: string
}

export interface RenderPairToolOptions {
  loaded: LoadedFont | null
  onEvent: (event: ToolEvent) => void
}

/**
 * Kern's single tool.
 *
 * It returns the rendered pair as an image *and* the optical measurements,
 * because a vision model judges the direction of a spacing error well and its
 * magnitude badly. It refuses values outside the plausible range for the
 * pair's shape class, which corrects a measured tendency to over-tighten.
 */
export function useRenderPairTool({ loaded, onEvent }: RenderPairToolOptions) {
  return useWebMCP(
    {
      name: 'render_pair',
      description:
        'Render a two-character pair at a given kerning value and return the image ' +
        'plus optical spacing measurements. Look at the image to judge direction ' +
        '(too tight or too loose); use opticalArea and minGap to choose the ' +
        'magnitude. Call repeatedly on the same pair to converge, then move on. ' +
        'Aim for an opticalArea close to the pair’s neighbours so the line has an ' +
        'even rhythm.',
      inputSchema: INPUT_SCHEMA,
      enabled: loaded !== null,
      execute: async ({ left, right, kern, force }) => {
        if (!loaded) throw new Error('No font loaded yet. Ask the user to load one.')
        if ([...left].length !== 1 || [...right].length !== 1) {
          throw new Error('left and right must each be exactly one character.')
        }

        const current = existingKern(loaded, left, right)
        const value = kern ?? current
        const range = typicalRange(left, right, loaded.unitsPerEm)

        if (!force && (value < range.min || value > range.max)) {
          const rejected =
            `Rejected: ${value} is outside the typical range for ` +
            `${range.pairClass} pairs (${range.min} to ${range.max} font units). ` +
            `Revise, or repeat with force: true if the render justifies it.`
          onEvent({ left, right, kern: value, opticalArea: 0, minGap: 0, collides: false, rejected })
          return { content: [{ type: 'text' as const, text: rejected }], isError: true }
        }

        const { render, metrics } = renderPair(loaded, left, right, value)
        onEvent({
          left,
          right,
          kern: value,
          opticalArea: metrics.opticalArea,
          minGap: metrics.minGap,
          collides: metrics.collides,
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
    },
    [loaded, onEvent],
  )
}
