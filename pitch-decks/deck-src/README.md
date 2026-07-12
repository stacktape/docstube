# docstube pitch deck — source

The deck is built the same way the previous one was: **each slide is a self-contained
HTML page, screenshotted at 2× with headless Chrome, then assembled into a `.pptx`** where
every slide is one full-bleed image. The HTML/CSS here is the editable source of truth — to
change a slide, edit its HTML and re-run the build, not the `.pptx`.

Output: [`../docstube-pitch-deck-v2.pptx`](../docstube-pitch-deck-v2.pptx) (16 slides, with
speaker notes embedded). A markdown outline lives at [`../docstube-pitch-deck.md`](../docstube-pitch-deck.md).

## Layout

```
deck-src/
  deck.css          # shared design system — brand tokens, type, cards, pills, matrix,
                    #   timeline, score bars, terminal. Ported from apps/web global.css.
  slides/
    slide-01.html   # one file per slide, 1280×720, links ../deck.css
    … slide-16.html # NOTE: file numbers do NOT match deck order — see build.mjs ORDER
  img/              # brand SVGs (logo icon + lockups), copied from apps/web/public/brand
  assets/           # generated PNGs (2560×1440) — overwritten by shoot.mjs
  shoot.mjs         # render: slides/*.html → assets/*.png  (Playwright drives system Chrome)
  build.mjs         # assemble: assets/*.png → ../docstube-pitch-deck-v2.pptx (+ speaker notes)
  package.json
```

Fonts are the vendored brand woff2 files (Outfit / Inter / JetBrains Mono) referenced by
`deck.css` from `../../apps/web/public/fonts`, so rendering is deterministic and offline.

## Rebuild

```bash
cd pitch-decks/deck-src
npm install          # playwright-core + pptxgenjs (system Chrome is used, no browser download)
npm run build        # = node shoot.mjs && node build.mjs
```

- `npm run render` — only re-screenshot the slides (after editing HTML/CSS).
- `npm run pack` — only re-assemble the `.pptx` from existing `assets/`.
- Render a single slide while iterating:
  `node shoot.mjs slides/slide-07.html assets`

## Design rules (keep the deck coherent)

- Light throughout, teal/white, generous whitespace. One dark surface only (the `.term` code block).
- One self-standing title (Outfit) at the top of each content slide; no section eyebrows (the cover is the only exception). One idea per slide; two-line titles break at a natural boundary.
- Footer on every content slide (not the cover): `docstube` · `VERIFIED, NOT GUESSED` · page number.
- No "gate" jargon anywhere; say "checks" / "pass all three checks". No em-dashes in copy or speaker notes.
- Semantic colors: pass `#15a06b`, flag `#c2790b`, danger `#d6584f`. Brand teal `#0097a1`/`#0a818b`.
- Never write "zero hallucinations" or absolute guarantees; the phrase is **"flagged, never silently wrong."**
- No invented traction/logos/revenue. Sourced figures (why-now stats, the M&A strip, pricing benchmarks) come from the research report and are labelled confirmed vs reported.

## Notes

- The deck is **16 slides**, and file numbers do NOT match deck order (slides were inserted and
  moved across rounds). The `ORDER` array in `build.mjs` is the single source of truth for
  sequence: `[1, 2, 3, 15, 5, 6, 7, 8, 4, 9, 10, 12, 16, 11, 13, 14]`. Each HTML footer carries
  its own sequential `NN / 16` page number. (e.g. `slide-15.html` = "Why now" = deck position 4.)
- Deliverables sit one level up: `../docstube-pitch-deck-v2.pptx` (deck), `../docstube-pitch-deck-v2.pdf`
  (PDF export), `../docstube-pitch-deck.md` (markdown outline). Re-export the PDF with LibreOffice:
  `soffice --headless --convert-to pdf --outdir .. ../docstube-pitch-deck-v2.pptx`.
- `node_modules/` and `assets/` are throwaway/generated; the HTML, CSS, and scripts are the source.
