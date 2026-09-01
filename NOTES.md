# Engineering notes

Decisions behind [Kern](./README.md) that are not obvious from the code, and
two things learned about WebMCP itself along the way.

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

OpenType stores kerning in two places: `kern`, the table TrueType shipped in
the 1990s, and `GPOS`, the one that replaced it. The obvious move is to write
`kern` — it is far simpler. A round-trip test on that version read back **zero
for every pair.**

`getKerningValue` consults GPOS first and only falls back to `kern` when GPOS
has no kerning — and so do HarfBuzz, browsers and macOS. Nearly every modern
font ships GPOS, so a `kern`-only export downloads a file that opens fine and
silently ignores every value.

Kern writes a real **GPOS** table — LookupType 2 PairPos Format 1, ValueFormat
`0x0004`, sorted Coverage and PairSets — plus the legacy `kern` table for older
consumers. Verify it yourself with `pnpm verify:export`, which also runs on every deploy:

```
kerning round-trips through 673KB of font:
  ok    AV: -80
  ok    To: -95
  ok    r.: -120
  ok    LT: -110
  ok    f): 20

the rest of the font survives:
  ok    family name: EB Garamond
  ok    glyph count: 3247
  ok    glyph A outline: 1328 chars, unchanged
  ok    advance width A: 692
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
`Native WebMCP · 5 tools registered` is plain text on the page, so an agent
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
