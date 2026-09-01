# Kern

**Kerning is not about making the distance between letters equal. It is about
making the negative space between them look equal.**

That one sentence is why this needs an AI, and why a script cannot do it.

A usable font ships between 1,000 and 5,000 kerning pairs — the per-pair spacing
corrections for combinations like `AV`, `To`, `r.` and `f)`. Type designers set
them **by eye, one pair at a time, over weeks**. Automatic kerners exist and are
mediocre, so professionals throw the output away and redo it by hand.

Kern gives that job to an agent. You load a font; the agent renders a pair, looks
at it, adjusts, and looks again — hundreds of times — while you watch and override
anything you disagree with.

## One tool

Kern exposes exactly one WebMCP tool, `render_pair`, and it returns **both a
picture and numbers**:

```js
render_pair({ left: "A", right: "V", kern: -80 })
→ image:        the rendered pair
  opticalArea:  white trapped between the outlines, in square font units
  minGap:       narrowest distance between the outlines
  typicalRange: the plausible range for this pair's shape class
```

Both, because of something measured rather than assumed. See below.

## Why it returns numbers as well as an image

Before building anything, the perceptual premise was tested: three versions of a
pair — too tight, correct, too loose — shown to a vision model. `kern-test/`
holds that test; open `kern-test/index.html` and try it yourself.

The result: **the model reads the direction of a spacing error reliably and the
magnitude poorly.** On `To` it described the mechanism perfectly — *"the o sits
partly under the wide top bar of the T"* — then chose a value roughly twice as
tight as correct.

So `render_pair` hands back measurements alongside the image, and it **refuses
values outside the plausible range** for the pair's shape class:

> Rejected: -240 is outside the typical range for overhang-round pairs
> (-77 to -21 font units). Revise, or repeat with `force: true`.

The guard rail corrects a real, reproducible bias, not an invented one.

## Running it

```bash
pnpm install
pnpm dev
```

Open in the ChatGPT app's browser, or Chrome 149+ with
`chrome://flags/#enable-webmcp-testing` enabled. Without WebMCP the page still
works by hand — there is a slider.

## Licence

MIT. The bundled sample font is EB Garamond, used under the SIL Open Font
License; see `public/fonts/OFL.txt`.
