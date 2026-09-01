# Kern

**A kerning workbench a browser agent can actually operate.**

Kerning is not about making the distance between letters equal. It is about
making the *negative space* between them look equal. `AV` and `HI` can measure
the same gap and look nothing alike, because the eye reads trapped white, not
geometry. That is why automatic kerners are mediocre and why type designers
still do this by hand.

A usable font ships between 1,000 and 5,000 kerning pairs. Setting them takes
weeks. Kern hands that job to an agent that can see, keeps a human in the loop
for every value, and exports a real font at the end.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/).

## Try it

Open the live URL in **the ChatGPT app's browser with GPT 5.6 or newer**, or in
**Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled, then say:

> Survey the kerning of the loaded font and fix what needs it, using this page’s WebMCP tools.

The page carries a copy button for that line, because the wording matters — see
[Naming beats documentation](#naming-beats-documentation).

Without WebMCP the page still works by hand, and says so rather than failing
silently.

## What you will see

- **A grid of 51 pairs**, each with its trapped white painted amber. Amber is
  unfinished work.
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

Five, registered on `document.modelContext`. Reads are marked `readOnlyHint`;
exactly one tool writes.

| Tool | Does |
|---|---|
| `list_pairs` | Text-only inventory: value, status, shape class, attempts. Cheap planning. |
| `survey_pairs` | Up to 24 pairs on one labelled contact sheet, with a metrics table. |
| `preview_pair` | One pair, large, at a proposed value. **Changes nothing.** |
| `publish_specimen` | Writes the agent's chosen line to the page and returns the render. |
| `set_kern` | Applies values to many pairs. The only writer. |

**Export is not a tool.** The agent kerns; only a human ships the font.

### The tool surface changes with state

No font, no tools: the five register only once a font is in memory, and loading
a different one unregisters and re-registers them. That goes through
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
keys, no network calls at runtime.

Tools are registered directly against `document.modelContext.registerTool()` in
`src/kern/useWebMCPTool.ts` — one `AbortController` per registration, aborted on
unmount or when a tool's `enabled` goes false, which is what fires `toolchange`.
[`@mcp-b/global`](https://mcp-b.ai/) supplies `document.modelContext` in
browsers that lack it, and defers to the native implementation where Chrome
provides one.

## Licence

MIT — see `LICENSE`. The bundled sample font is EB Garamond under the SIL Open
Font License; see `public/fonts/OFL.txt`.
