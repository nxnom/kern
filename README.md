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

Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/).

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

## Why it returns pictures *and* numbers

Before writing any of this, the premise was tested: show a vision model three
versions of a pair — too tight, correct, too loose — and see if it can tell.
`kern-test/index.html` is that test; open it and try.

The result was specific. **It reads the direction of a spacing error reliably
and the magnitude poorly.** On `To` it described the mechanism perfectly — *"the
o sits partly under the wide top bar of the T"* — then picked a value roughly
twice as tight as correct.

So every render comes back with measurements attached, and `set_kern` refuses
values outside the plausible range for the pair's shape class:

> Rejected: -240 is outside the typical range for overhang-round pairs
> (-77 to -21 font units). Revise, or repeat with `force: true`.

Rejections are **per pair**, so one bad value cannot block a batch of six. The
guard rail corrects a measured bias, not an imagined one, and the range bar in
the UI shows rejected values sitting visibly outside the band.

## Optical measurement

`measureOpticalGap` walks each scanline across the cap band, finds the rightmost
ink on the left and the leftmost on the right, and sums the gaps. That total is
the area of trapped white — the quantity the eye is actually judging. Pairs of
the same shape class should land near each other; the outliers are the work.

The contact sheet measures every cell from a single `getImageData` call rather
than one per pair.

## Export: GPOS, not just `kern`

The first version wrote a legacy `kern` table. A round-trip test read back
**zero for every pair.**

`getKerningValue` consults GPOS first and only falls back to `kern` when GPOS
has no kerning — and so do HarfBuzz, browsers and macOS. Nearly every modern
font ships GPOS, so a `kern`-only export downloads a file that opens fine and
silently ignores every value.

Kern writes a real **GPOS** table — LookupType 2 PairPos Format 1, ValueFormat
`0x0004`, sorted Coverage and PairSets — plus the legacy `kern` table for older
consumers. Verify it yourself:

```bash
pnpm tsx scripts/verify-export.ts
```

```
AV: wrote -80, read back -80 OK
To: wrote -95, read back -95 OK
original family: EB Garamond | exported: EB Garamond
numGlyphs      : 3247 -> 3247 OK
glyph A outline: 1328 chars -> 1328 IDENTICAL
```

One documented limitation: the GPOS table is **replaced, not merged**, so other
positioning features are dropped. That is why the `.fea` export exists — Adobe
feature syntax is what a type designer feeds to fontmake or AFDKO in a real
build. It is the less impressive button and the more useful one.

`opentype.js` cannot help here: its writer emits neither `kern` nor `GPOS`, so
`toArrayBuffer()` would discard the work. Both tables are built by hand in
`src/kern/gpos.ts` and `src/kern/export.ts`, and the sfnt directory is rebuilt
around them with correct checksums.

## Naming beats documentation

Two findings worth more than the code.

**A tool surface competes with browser control, and loses by default.** Asked to
*"survey the kerning on this page"*, the agent reached for screenshots and DOM
inspection — reasonably, since kerning a web page really is a CSS job. The word
*page* was the trap.

Naming the object rather than the surface helped — *"the kerning of the loaded
font"* rather than *"the kerning on this page"*, since the latter invites the
agent to think about the page's own CSS.

**But the fix that actually worked was accidental.** The status banner that reports
`Native WebMCP · 6 tools registered` is plain text on the page, so an agent
already in browser-control mode *reads it*, discovers there is a tool surface,
and switches to it mid-task. A visible statement of capability turned out to be
better discovery than anything in the tool metadata.

That is worth saying plainly, because it is a property of the standard rather
than of this app: a page can register a perfect tool surface and still be
ignored in favour of screenshots. Tool discovery is solved; tool *preference*
is not — and until it is, telling the human reader also tells the agent.

Even so, the suggested prompt names WebMCP. Without it the agent still opens in
browser-control mode, reads the banner, announces *"the workbench exposes
font-specific kerning tools, so I'm switching"* and then does the right thing —
but it wastes a turn getting there, and a judge watching a three-minute video
should not have to sit through the detour.

**Models weight names far above descriptions.** A read-only tool called
`render_pair` was called dozens of times and never followed by a write, because
the name reads like doing the work. A description saying `PREVIEW ONLY` did not
help. Renaming it `preview_pair` did. `render_specimen` had the same problem
against `set_specimen`; they are now one tool, `publish_specimen`.

## Detection

Neither MCP-B nor `usewebmcp` exports a support check — `useWebMCP` returns
per-tool *execution* state, and `useWebMCPContext` is for exposing app context.
So `src/kern/useWebMCPSupport.ts` follows what Chrome's own demos do: check
`document.modelContext`, fall back to the legacy `navigator.modelContext`, and
**poll every 500ms for up to 20 tries** — because a polyfill or extension can
install the API after the page has loaded.

It also reports **native versus polyfill**, which neither library offers. An
inline script in `index.html` samples `'modelContext' in document` before the
bundle runs; once `@mcp-b/global` has executed you can no longer tell.

The tool list shown in the UI is **what this page registered**, not what
`getTools()` returns. They answer different questions, and a polyfilled runtime
can report an empty list while the registrations are fine.

## Running it

```bash
pnpm install
pnpm dev
```

```bash
pnpm build
pnpm dlx wrangler deploy    # Cloudflare Workers, see wrangler.toml
```

## Stack

Vite, React 19, TypeScript. [`@mcp-b/global`](https://mcp-b.ai/) for the runtime,
which defers to Chrome's native implementation when present and polyfills
otherwise; `usewebmcp` for the registration hook. `opentype.js` for parsing.
No backend, no API keys, no network calls at runtime.

## Licence

MIT — see `LICENSE`. The bundled sample font is EB Garamond under the SIL Open
Font License; see `public/fonts/OFL.txt`.
