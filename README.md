# Kern

**A kerning workbench a browser agent can actually operate.**

Kerning is not about making the distance between letters equal. It is about
making the *negative space* between them look equal. `AV` and `HI` can measure
the same gap and look nothing alike, because the eye reads trapped white, not
geometry. That is why automatic kerners are mediocre and why type designers
still do this by hand.

A typeface has hundreds of pairs that need it. Thomas Phinney documented
kerning one weight of one typeface: 632 adjustments, about a week of work. Kern
hands that job to an agent that can see, keeps a human in the loop for every
value, and exports a real font at the end.

**Live:** https://kern.nxnom.workers.dev
**Demo video:** https://youtu.be/SGANj6p570o

Built for [The WebMCP Challenge](https://webmcp.devpost.com/).

## Try it

Open **https://kern.nxnom.workers.dev/** in **the ChatGPT app's browser with GPT 5.6 or newer**, or in
**Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled, then say:

> Survey the kerning of the loaded font and fix what needs it, using this page’s WebMCP tools.

The page carries a copy button for this prompt to make it easy to paste into the agent. 

Without WebMCP the page still works by hand, and says so rather than failing
silently.

## What you will see

- **A grid of pairs**, each with the trapped white space tinted, so you can see
  the shape the eye is actually judging. It opens on **Essential** — the pairs
  every face needs, 51 in the bundled sample — and you can widen it to
  **Standard** or **Everything**, which is generated from the loaded font's own
  coverage rather than a fixed list.
- **A live indicator** naming the pair or batch the agent is looking at, with
  the tile lit and scrolled into view.
- **Hover any changed tile** to see what it looked like before.
- **An attempt trail** per pair: every value tried, with rejected ones struck
  through, and a bar showing where the value sits in the plausible range for
  that pair's shape class.
- **A specimen line the agent writes itself**, shown before and after, with
  every gap that moved underlined.
- **A timestamped log** of every tool call.
- **Download** a real `.ttf` with GPOS kerning, or a `.fea` feature file.

The bundled sample is **EB Garamond**, which ships with **zero** kerning for
these pairs — so there is genuine work to do rather than values to nudge.


## The tools

Eight, registered on `document.modelContext`. The four read tools are marked
`readOnlyHint`; all eight carry `untrustedContentHint`, because every answer
repeats the font's family name and that comes from a file you supplied.

| Tool | Does |
|---|---|
| `list_pairs` | Text-only inventory: value, status, shape class, attempts. Cheap planning. |
| `survey_pairs` | 36 pairs to screen, or 12 large enough to judge, on one labelled sheet. |
| `preview_pair` | One pair at several candidate values, side by side. **Changes nothing.** |
| `preview_pairs` | Several pairs at several values — one sheet, one call. |
| `publish_specimen` | Sets a line of real words as the proof, shipped against kerned. |
| `set_kern` | Applies values to many pairs. |
| `revert` | Puts pairs back to what the font shipped. |
| `export_font` | Writes the kerned `.ttf`, with real GPOS and `kern` tables. |

Six of the eight answer with a picture. `export_font` runs only when you ask
for the file — the tool description tells the agent not to call it to round off
a run.

### The tool surface changes with state

No font, no tools: they register only once a font is in memory, and loading a
different one unregisters and re-registers them. That goes through
`AbortController` and fires `toolchange`.

## Notes

[NOTES.md](./NOTES.md) covers the decisions that are not obvious from the code:
why the tools return pictures *and* numbers, how the optical measurement works,
why the export writes a GPOS table by hand, and two things that turned out to be
true about WebMCP rather than about this app.

## Running it

```bash
pnpm install
pnpm dev
```

Deploying to Cloudflare Workers:

```bash
pnpm login      # once, opens the browser
pnpm deploy     # check, build, ship
```

`pnpm deploy` runs `pnpm check` first — typecheck, lint, and the export
round-trip test — and stops if any of them fail. `pnpm deploy:preview` uploads
a version without promoting it to the live URL.

| script | does |
|---|---|
| `pnpm dev` | local dev server |
| `pnpm check` | typecheck, lint, verify the font export |
| `pnpm verify:export` | round-trip a kerned font and diff it against the source |
| `pnpm icon` | rebuild `public/icon.svg` from the sample font's K |
| `pnpm deploy` | check, build, deploy |

## Stack

Vite, React 19, TypeScript. `opentype.js` for font parsing. No backend, no API
keys, no third-party requests — the only fetch is the bundled sample font from
the same origin, and fonts you load yourself never leave the browser.

Tools are registered directly against `document.modelContext.registerTool()` in
`src/kern/useWebMCPTool.ts` — one `AbortController` per registration, aborted on
unmount or when a tool's `enabled` goes false, which is what fires `toolchange`.

There is no MCP library and no polyfill. An early version used one; it was
removed so the specification call is the only thing between this app and the
browser. Where `document.modelContext` does not exist, the page says so and
stays usable by hand.

## Licence

MIT — see `LICENSE`. The bundled sample font is EB Garamond under the SIL Open
Font License; see `public/fonts/OFL.txt`.
