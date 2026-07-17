# Generated-docs preview theme specification

## 0. Scope and source chain

Primary source:

- [`apps/web/src/components/GeneratedDocs.astro`](C:/Projects/docstube/apps/web/src/components/GeneratedDocs.astro)

Style dependencies:

- [`apps/web/src/layouts/Base.astro`](C:/Projects/docstube/apps/web/src/layouts/Base.astro) imports the global stylesheet and preloads fonts.
- [`apps/web/src/styles/global.css`](C:/Projects/docstube/apps/web/src/styles/global.css) imports Tailwind and the font declarations; it defines the marketing palette, typography, shadows, radii, backgrounds, and shared utility classes.
- [`apps/web/src/styles/fonts.css`](C:/Projects/docstube/apps/web/src/styles/fonts.css) declares all self-hosted font faces.
- [`apps/web/public/fonts`](C:/Projects/docstube/apps/web/public/fonts) contains the font files.
- [`apps/web/src/components/Header.astro`](C:/Projects/docstube/apps/web/src/components/Header.astro) and [`apps/web/src/components/Footer.astro`](C:/Projects/docstube/apps/web/src/components/Footer.astro) consume the same global tokens but are not imported into the generated-docs preview.
- [`apps/web/package.json`](C:/Projects/docstube/apps/web/package.json) uses Tailwind CSS `4.3.1`. There is no separate Tailwind configuration file; configuration is CSS-first through `@theme`.

Important scope distinction:

1. The outer marketing section and feature-gallery cards use global marketing tokens.
2. The interactive docs-site mockup has its own `--dp-*` light/dark token island.
3. The gallery below the mockup is illustrative. It presents candidate documentation components, but most of its styling is not theme-aware and is not wired to `--dp-*`.

---

# 1. Design tokens

## 1.1 Font families

| Role | Family stack | Intended use |
|---|---|---|
| Display | `'Outfit', ui-sans-serif, system-ui, sans-serif` | Page and section headings, card headings, brand-forward labels |
| Body | `'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif` | Body copy, navigation, controls |
| Monospace | `'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace` | Code, breadcrumbs, navigation section labels, tabs, shortcuts, technical metadata |

Global browser features:

```css
font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
-webkit-font-smoothing: antialiased;
text-rendering: optimizeLegibility;
```

All faces are normal style, WOFF2, `font-display: swap`, with separate Latin and Latin Extended files.

### Outfit files

Weights `400`, `500`, `600`, `700`, `800`:

```text
/fonts/outfit-{weight}-latin.woff2
/fonts/outfit-{weight}-latin-ext.woff2
```

### Inter files

Weights `400`, `500`, `600`, `700`:

```text
/fonts/inter-{weight}-latin.woff2
/fonts/inter-{weight}-latin-ext.woff2
```

### JetBrains Mono files

Weights `400`, `500`, `600`, `700`:

```text
/fonts/jetbrains-mono-{weight}-latin.woff2
/fonts/jetbrains-mono-{weight}-latin-ext.woff2
```

`Base.astro` preloads:

```text
/fonts/outfit-700-latin.woff2
/fonts/inter-400-latin.woff2
```

A documentation theme should additionally consider preloading JetBrains Mono 400 if above-the-fold code is common.

---

## 1.2 Global marketing colors

Defined in `apps/web/src/styles/global.css`.

### Brand teal scale

| Token | Value |
|---|---|
| `brand-50` | `#ecfbf9` |
| `brand-100` | `#d2f4f0` |
| `brand-200` | `#a7e8e1` |
| `brand-300` | `#70d0ca` |
| `brand-400` | `#36b1b0` |
| `brand-500` | `#0097a1` |
| `brand-600` | `#0a818b` |
| `brand-700` | `#0a6670` |
| `brand-800` | `#0c4f57` |
| `brand-900` | `#0b3e44` |
| `brand-950` | `#062a2e` |

The palette is derived from the logo ring (`#7ED0BE → #36A6A4 → #0A7B85`) and wordmark accent (`#0097A1`).

### Text and neutral colors

| Token | Value | Role |
|---|---|---|
| `ink` | `#0e2b2d` | Headings and strongest text |
| `ink-soft` | `#33484a` | Primary body text |
| `muted` | `#5d7173` | Secondary copy and navigation |
| `faint` | `#8497988a` | Very low-emphasis content |

### Surfaces

| Token | Value |
|---|---|
| `paper` | `#ffffff` |
| `canvas` | `#f5faf9` |
| `line` | `#e0ece9` |
| `line-strong` | `#cfe1dd` |
| `night` | `#0b1716` |
| `night-soft` | `#102322` |

### Semantic colors

| Token | Value | Role |
|---|---|---|
| `pass` | `#15a06b` | Successful verification/check |
| `flag` | `#c2790b` | Warning, flag, or string-like syntax accent |
| `danger` | `#d6584f` | Error/destructive condition |

### One-off colors in `GeneratedDocs.astro`

| Value | Use |
|---|---|
| `#1f3a36` | Dark-theme placeholder/content bars |
| `#06201f` | Dark inline-code sample background |
| `#6d4ee6` | Agent/MCP accent and light-theme function syntax |
| `#ece6fd` | MCP badge background |
| `#ffffff` / `#fff` | White text and cursor outline |
| `rgba(54,177,176,0.18)` | Glow behind the docs mockup |
| `rgba(10,129,139,0.05)` | Global grid lines |
| `rgba(10,129,139,0.12)` | Global dot background |
| `rgba(13,50,48,0.08)` | Light code-block shadow |
| `rgba(0,0,0,0.08)` | Diagram-node shadow |

---

## 1.3 Docs-preview light/dark colors

These are local to `[data-doc-preview]`.

### Light

| Token | Value | Role |
|---|---|---|
| `--dp-bg` | `#ffffff` | Main docs surface, active tab/pill |
| `--dp-card` | `#f5faf9` | Search field, diagram cards |
| `--dp-text` | `#0e2b2d` | Primary text |
| `--dp-muted` | `#5d7173` | Secondary text and icons |
| `--dp-border` | `#e0ece9` | Pane dividers, outlines, dot grid |
| `--dp-accent` | `#0a818b` | Active navigation, links, diagram edges |
| `--dp-active` | `#ecfbf9` | Active navigation row |
| `--dp-inline` | `rgba(10, 129, 139, 0.1)` | Inline code/icon background |
| `--dp-codebg` | `#f1f5f4` | Code-block background |
| `--dp-codetext` | `#33484a` | Default code text |
| `--dp-kw` | `#0a7b85` | Syntax keywords |
| `--dp-str` | `#b5610b` | Syntax strings |
| `--dp-fn` | `#7a5cf0` | Syntax functions |
| `--dp-var` | `#0e2b2d` | Syntax variables/types |

### Dark

| Token | Value | Role |
|---|---|---|
| `--dp-bg` | `#161c1c` | Main docs surface |
| `--dp-card` | `#222828` | Secondary surfaces |
| `--dp-text` | `rgba(255, 255, 255, 0.9)` | Primary text |
| `--dp-muted` | `#8c9594` | Secondary text |
| `--dp-border` | `#2f3434` | Dividers and outlines |
| `--dp-accent` | `#36bebe` | Active/accent color |
| `--dp-active` | `#2b3231` | Active navigation row |
| `--dp-inline` | `rgba(54, 190, 190, 0.14)` | Inline code/icon background |
| `--dp-codebg` | `#1b2221` | Code-block background |
| `--dp-codetext` | `#cfeae6` | Default code text |
| `--dp-kw` | `#569cd6` | Syntax keywords |
| `--dp-str` | `#ce9178` | Syntax strings |
| `--dp-fn` | `#dcdcaa` | Syntax functions |
| `--dp-var` | `#9cdcfe` | Syntax variables/types |

The dark theme is charcoal-green, not neutral black. Preserve that teal-tinted character.

---

## 1.4 Typography roles

### Global/base

| Role | Size | Weight | Line height | Other |
|---|---:|---:|---:|---|
| Body default | `16px` | `400` | `1.6` | Inter |
| Global headings | inherited | varies | `1.07` | Outfit, `-0.02em`, balanced wrapping |
| Eyebrow | `12px` | `600` | normal | Mono, uppercase, `0.08em` tracking |
| Chip | `12.5px` | `400` | normal | Mono |

### Docs mockup

| Role | Size | Weight | Line height |
|---|---:|---:|---:|
| Page title | `26px` | `600` | global heading `1.07` |
| Breadcrumb | `11px` | `400` | normal |
| Intro/body copy | `13.5px` | `400` | Tailwind `leading-relaxed` = `1.625` |
| Inline code | `11.5px` | `400` | inherited |
| Sidebar navigation | `12.5px` | `400`; active `500` | default |
| Sidebar group labels | `10px` | `600` | default; uppercase, `0.06em` |
| TOC navigation | `12px` | active `500` | default |
| TOC label | `10px` | `600` | uppercase, `0.06em` |
| Search/Ask AI | `11px` | Ask AI `600` | default |
| Theme buttons | `10px` | `600` | default |
| Code tabs | `11.5px` | `600` | default |
| Code | `12px` | `400` | `1.85` |
| Diagram node label | `11px` | `500` | default |
| Diagram edge label | `8.5px` | `400` | default |
| Diagram caption | `9.5px` | `400` | default |

### Marketing wrapper/gallery

| Role | Size |
|---|---:|
| Main section heading | `30px` mobile; `42px` at `sm` |
| Main section lead | `16px`, relaxed |
| Gallery heading | `24px`, weight `600` |
| Gallery lead | `14.5px`, relaxed |
| Gallery card heading | `15px`, weight `600` |
| Gallery card copy | `12.5px`, relaxed |
| Miniature UI copy | `7px–11.5px` |

The `7px–10px` sizes are infographic-only. They should not be carried into a production documentation UI at full scale.

---

## 1.5 Spacing and layout scale

Tailwind’s standard 4px-based spacing scale is used, plus a few arbitrary values.

Common production-worthy values:

| Use | Value |
|---|---:|
| Very tight gap/padding | `2px` |
| Control rail padding | `3px` |
| Small gap | `4px`, `6px`, `8px` |
| Nav row vertical padding | `6px` |
| Search/control vertical padding | `7px` |
| Nav row horizontal padding | `10px` |
| Chrome padding | `10px 16px` |
| Sidebar padding | `12px` |
| TOC padding | `16px` |
| Article padding | `24px`; `28px` at `sm` |
| Code content padding | `12px 16px 16px` |
| Diagram content padding | `28px 20px` |
| Section horizontal padding | `20px`; `32px` at `sm` |
| Section vertical padding | `80px`; `96px` at `sm` |

Layout dimensions:

```text
Marketing max width:       max-w-6xl = 72rem / 1152px
Preview max width:         max-w-5xl = 64rem / 1024px
Section copy max width:    max-w-2xl = 42rem / 672px

Desktop docs grid:
  left sidebar:            222px
  content:                 1fr
  right TOC:               188px

Search field:              210px
Diagram node:              104px
TOC row height:            30px
TOC rail height:           150px
```

Responsive behavior currently defined:

- Search and Ask AI are hidden below `sm`.
- Sidebar and TOC are hidden below `lg`.
- Article remains, with `24px` padding and `28px` from `sm`.
- No replacement mobile navigation or mobile TOC exists.

---

## 1.6 Radii

| Token/class | Value | Use |
|---|---:|---|
| Global `--radius-xl` | `16px` | Available theme token |
| `rounded-2xl` | `16px` | Outer docs frame |
| `.surface` / `.surface-tint` | `14px` | Marketing cards |
| `rounded-xl` | `12px` | Code blocks, diagrams, inner cards |
| `rounded-lg` | `8px` | Search, controls, icon tiles |
| Arbitrary control rail | `9px` | Theme switch outer rail |
| Arbitrary nav/control | `7px` | Nav rows, active pill |
| Code-tab pill | `6px` | Animated tab selection |
| `rounded-md` | `6px` | Small callouts and rows |
| `rounded` | `4px` | Inline code, small badges |
| `rounded-full` | `9999px` | Dots, status circles, chips |

The recognizable radius hierarchy is: `16 outer → 12 content blocks → 8 controls → 4 inline elements`.

---

## 1.7 Shadows

Global tokens:

```css
--shadow-soft:
  0 1px 2px rgba(13, 50, 48, 0.04),
  0 6px 20px -8px rgba(13, 50, 48, 0.12);

--shadow-lift:
  0 2px 4px rgba(13, 50, 48, 0.05),
  0 18px 40px -16px rgba(13, 50, 48, 0.22);

--shadow-brand:
  0 8px 24px -10px rgba(10, 129, 139, 0.55);
```

Docs code block:

```css
0 1px 3px rgba(13, 50, 48, 0.08),
0 0 0 1px color-mix(in srgb, var(--dp-text) 7%, transparent)
```

Diagram nodes:

```css
0 1px 3px rgba(0, 0, 0, 0.08)
```

Marketing terminal, available globally but not used by the live docs frame:

```css
0 30px 60px -24px rgba(6, 30, 28, 0.5),
inset 0 1px 0 rgba(255, 255, 255, 0.04)
```

---

## 1.8 Motion

| Interaction | Timing |
|---|---|
| Theme/code selection pill | `left/width 0.28s cubic-bezier(0.34,1.56,0.64,1)` |
| Pill vertical/height change | `0.25s ease` |
| Navigation hover | `background-color 0.15s ease` |
| Accordion panel | `grid-template-rows 0.22s ease` |
| Accordion chevron | `transform 0.22s ease` |
| Marketing card lift | `220ms` spring transform, `220ms` border, `220ms` shadow |

Reduced-motion support globally forces animations and transitions to `0.001ms`, one iteration.

---

# 2. Component visual structure

## 2.1 Outer presentation

The section sits on a pale teal canvas with a `22px × 22px` radial dot grid:

```css
background-color: #f5faf9;
background-image: radial-gradient(rgba(10,129,139,0.12) 1px, transparent 1px);
background-size: 22px 22px;
```

Above the docs frame is:

- Mono uppercase teal eyebrow.
- Large Outfit headline.
- Muted Inter explanation.
- A teal radial glow behind the upper frame:
  `radial-gradient(55% 100% at 50% 0%, rgba(54,177,176,0.18), transparent 70%)`.

The frame itself is a rounded, outlined, elevated “application window,” which makes the documentation look like a finished product rather than rendered prose.

## 2.2 Top chrome

Three-column grid: `1fr auto 1fr`.

Left:

- Three `10px` neutral circles representing window controls.

Center, from `sm` upward:

- Search field with icon, placeholder, and `⌘K` keycap.
- “Ask AI” control with sparkle icon.
- Search uses the secondary card surface and border.
- Ask AI uses `13%` accent mixed into transparency.

Right:

- Light/dark segmented control.
- `3px` rail padding, `9px` outer radius.
- Animated selection pill uses `--dp-bg`, `--shadow-soft`, and `7px` radius.
- Labels and icons are mono, `10px`, semibold.

## 2.3 Three-pane documentation body

Desktop:

```text
222px sidebar | fluid content | 188px TOC
```

Pane boundaries are single-pixel `--dp-border`.

### Sidebar

- Group headings: icon + uppercase mono label.
- Navigation rows: `12.5px`, `6px 10px` padding, `7px` radius.
- Hover background: `7%` of `--dp-text` mixed with transparent.
- Active parent:
  - `--dp-active` fill.
  - Strong `--dp-text`.
  - `3px × 14px` accent bar at the left.
  - Medium font weight.
- Nested rows:
  - `15px` left offset.
  - `1px` vertical border in `--dp-border`.
  - Additional `10px` inner left padding.
- Accordion uses a rotating chevron and a `0fr → 1fr` grid transition.

### Main content

- `24px` padding, `28px` at `sm`.
- Vertical block spacing: `20px`.
- Breadcrumb is mono and muted.
- Title is Outfit `26px/600`.
- Intro is `13.5px`, relaxed.
- Inline code is mono `11.5px`, accent text over `--dp-inline`.

### Right TOC

- Label is uppercase mono.
- Each item is a fixed `30px` row.
- Top-level items use `18px` left padding.
- Nested items use `30px`.
- Active item is medium weight and primary text.
- The defining element is a custom bent SVG rail:
  - Base stroke: `--dp-border`, `1.5px`.
  - Active segment: `--dp-accent`, `2.5px`.
  - The rail bends horizontally for nested headings rather than using a generic straight border.

This bent TOC rail is one of the strongest portable identity elements.

---

## 2.4 Code blocks and highlighting

The live block is a theme-aware, tabbed code surface.

Container:

- `12px` radius.
- Background `--dp-codebg`.
- Text `--dp-codetext`.
- Subtle shadow plus a 1px text-relative outline.
- No separate header bar; tabs float inside the same code surface.

Tabs:

- Positioned in a low-contrast rail made from `7%` of `--dp-text`.
- Animated selection pill uses the page background.
- Mono `11.5px/600`.
- Copy icon aligned right.
- Two manually switched panels: TypeScript and Python.

Code:

```text
font: JetBrains Mono
size: 12px
line-height: 1.85
padding: 12px 16px 16px
```

Highlighting is manually authored with semantic span classes:

```text
.k = keyword
.s = string
.f = function
.v = variable/type
```

There is no highlighter configured or invoked by this component. Shiki and Prism appear transitively elsewhere in the lockfile, but `apps/web` does not directly configure them for this preview. A production theme must map its highlighter token output onto the four documented color roles, then add missing roles such as comments, numbers, operators, properties, punctuation, and diff colors.

The gallery’s “type-checked code” card is separate:

- White block on pale canvas.
- `example.ts` filename header.
- Green `tsc passed` badge.
- Small manually colored code.
- This is the clearest visual precedent for attaching verifier results to a code sample.

---

## 2.5 Verification and provenance styling

Defined or demonstrated:

- `pass: #15a06b`.
- `flag: #c2790b`.
- `danger: #d6584f`.
- A pass chip uses:
  - `pass` text.
  - `rgba(pass, 0.12)` equivalent background via `bg-pass/12`.
  - Mono `8.5px/600`.
  - Small check icon.
  - `4px` radius and `6px × 2px` padding.
- Diagram caption: mono `9.5px`, muted, separated by a top border, with copy such as “rendered & syntax-checked.”
- Gallery prose consistently names verification: “type-checked,” “syntax-checked,” and “verified API surface.”

Not defined:

- No production-sized “proven” badge.
- No “scored” or “out-of-domain” visual.
- No source citation/provenance chip.
- No defect count badge.
- No verification date badge.
- No guarantee downgrade treatment.

Recommendation: retain the compact mono status grammar but promote it to reusable tokens:

```css
--status-proven: #15a06b;
--status-scored: #0a818b;
--status-flagged: #c2790b;
--status-danger: #d6584f;

--status-proven-bg: color-mix(in srgb, var(--status-proven) 12%, transparent);
--status-scored-bg: color-mix(in srgb, var(--status-scored) 12%, transparent);
--status-flagged-bg: color-mix(in srgb, var(--status-flagged) 12%, transparent);
--status-danger-bg: color-mix(in srgb, var(--status-danger) 12%, transparent);
```

“Proven” should use green, while teal should remain the navigation/link/brand accent. This avoids confusing “selected” with “verified.”

---

## 2.6 Diagrams

The diagram treatment includes:

- Theme-aware dotted canvas:
  `radial-gradient(var(--dp-border) 1px, transparent 1px)`,
  `14px × 14px`.
- Rounded cards with borders and restrained shadows.
- Teal icon tiles.
- Teal directional edges with arrowheads.
- Central/active service distinguished by:
  - `1.5px` accent border.
  - Background mixing `9%` accent into the card surface.
  - Solid accent icon tile with white icon.
- Mono edge labels and node names.
- Caption bar containing source filename and verification state.

This resembles a compiler-generated artifact, not a decorative illustration.

---

## 2.7 Callouts, tabs, and steps

Only the gallery defines these.

### Informational callout

- `6px` radius.
- `1px solid brand-200`.
- `brand-50` at `70%` opacity.
- `8px × 6px` padding.
- Teal outlined info icon.
- `9px`, snug line height, `ink-soft` text.

### Tabs

- Bottom border across tab row.
- Active tab appears as a small white raised chip with `shadow-soft`.
- Active text is `brand-700`, semibold.
- Inactive labels are muted.
- This differs from the live code tabs, which use an animated segmented-control pill.

Use the animated pill for mutually exclusive code variants; use the underlined/raised row for larger content tabs.

### Steps

- Active circle: solid `brand-500`, white mono bold numeral.
- Future circle: `brand-100`, `brand-700` numeral.
- Connecting rule: `line`.
- Preview size is `14px`; production should scale this to at least `24–28px`.

No warning, danger, success, or out-of-domain callout variants are specified.

---

## 2.8 Tables and API reference

No general prose table is defined.

The API-reference gallery card provides a miniature table grammar:

- `12px` radius outer container.
- `canvas` background and `line` border.
- Signature header on `paper`, separated by a bottom border.
- Rows use a two-column `1fr auto` grid.
- `6px × 12px` row padding.
- Rows separated by `1px line`.
- Mono `9.5px`.
- Parameter names muted.
- Types use `brand-600`.
- Function name uses `brand-700`.

For production, scale to at least `13–14px`, keep types mono/teal, and use the same alternating `paper`/`canvas` surface relationship.

---

## 2.9 Links and glossary terms

Global anchors inherit color and remove underlines.

Within the live preview:

- Navigation and TOC links are distinguished through position, hover fill, and color.
- There is no styled inline prose hyperlink.

Gallery glossary term:

- `brand-50` background.
- `brand-700` text.
- `4px` radius.
- Dotted `brand-400` underline.
- `2px` underline offset.
- Dark tooltip:
  - `night` background.
  - `paper` text.
  - `8px` radius.
  - `line` border.
  - `shadow-lift`.
  - Term highlighted in `brand-300`.

Recommendation: regular prose links should use `--dp-accent`, a subtle underline, and stronger underline on hover. Reserve the dotted underline and tinted background for glossary definitions.

---

# 3. Recognizable visual identity

A full theme should retain these elements:

1. **Teal-tinted rather than neutral surfaces.**  
   Canvas, borders, ink, shadows, and dark mode all lean green/teal. Replacing them with generic slate/gray would erase the identity.

2. **Outfit + Inter + JetBrains Mono hierarchy.**  
   Outfit supplies rounded confidence, Inter keeps content readable, and JetBrains Mono creates the “compiler/proof” voice.

3. **Compiler-like technical metadata.**  
   Breadcrumbs, group labels, filenames, captions, verifier badges, shortcuts, and diagram labels consistently use mono type.

4. **Verification attached directly to artifacts.**  
   “tsc passed” lives on the code block; “rendered & syntax-checked” lives on the diagram. Proof is contextual rather than relegated to a dashboard.

5. **Bent active TOC rail.**  
   The rail visually encodes heading depth and active position. It is much more distinctive than a conventional straight vertical rule.

6. **Pale dotted technical canvases.**  
   Dot grids behind the section and diagrams suggest graph paper and generated system models without becoming visually noisy.

7. **Soft, compact application chrome.**  
   Rounded framed docs site, centered search, Ask AI, segmented theme toggle, fine borders, and teal shadows make it feel like a finished tool.

8. **Active sidebar marker combination.**  
   Pale teal row + strong text + narrow solid teal bar. Keep all three; any one alone is generic.

9. **Light-by-default with charcoal-green dark mode.**  
   Dark mode uses `#161c1c`, `#222828`, and cyan-teal accents rather than black/blue defaults.

10. **Restrained elevation.**  
    Borders define most structure; shadows are soft and teal-tinted. Avoid heavy cards around every prose section.

---

# 4. Gaps and coherent extensions

## 4.1 Token architecture

The current `--dp-*` set is too small for a full theme. Extend it semantically while keeping existing values as aliases:

```css
--docs-bg: var(--dp-bg);
--docs-surface: var(--dp-card);
--docs-surface-raised: var(--dp-bg);
--docs-text: var(--dp-text);
--docs-text-muted: var(--dp-muted);
--docs-border: var(--dp-border);
--docs-accent: var(--dp-accent);
--docs-selection: var(--dp-active);
--docs-code-bg: var(--dp-codebg);
--docs-inline-code-bg: var(--dp-inline);
```

Add:

```css
--docs-header-height;
--docs-sidebar-width;
--docs-toc-width;
--docs-content-max-width;
--docs-content-gutter;

--docs-surface-hover;
--docs-surface-pressed;
--docs-border-strong;
--docs-focus-ring;
--docs-overlay;
--docs-backdrop;

--docs-link;
--docs-link-hover;
--docs-heading-anchor;
```

Use one source of truth for light and dark tokens rather than mixing theme-local variables with global marketing colors inside documentation components.

## 4.2 Sidebar

The preview defines desktop appearance but lacks:

- Logo/project identity.
- Version selector.
- Locale selector.
- Section tabs for sectioned IA.
- Page status/guarantee markers.
- Sidebar footer.
- Scroll shadows.
- Current-page descendant state.
- Deep nesting beyond one level.
- Collapsed desktop mode.

Extension:

- Keep `222px` as the compact baseline; production likely needs `240–272px`.
- Preserve `7px` row radius, active fill/bar, mono section labels, and nested gutter rule.
- Add `--nav-indent-step`, suggested `14–16px`.
- Use compact guarantee dots or icons only where meaningful; do not turn every row green.

## 4.3 TOC

Missing:

- Arbitrary nesting.
- Scroll-spy behavior.
- Overflow handling for long pages.
- Heading anchor interactions.
- “Back to top.”
- Page feedback/status footer.

Extension:

- Generate the bent rail programmatically from heading depth.
- Keep `30px` minimum row rhythm.
- Use accent only for the active rail segment; ancestors stay muted.
- On narrow layouts, convert TOC to an expandable “On this page” control.

## 4.4 Search

The preview defines only a closed input.

Missing:

- Dialog/palette.
- Search result hierarchy.
- Keyboard selection.
- Empty/loading/error states.
- Recent searches.
- Pagefind result excerpts and matches.
- Mobile search trigger.

Extension:

- Reuse `--docs-surface`, `--docs-border`, `12px` radius, mono shortcut keycaps, and pale teal active rows.
- Selected results should mirror active sidebar styling.
- Match highlights should use `--dp-inline` and `--dp-accent`.

## 4.5 Mobile navigation

Currently both sidebar and TOC disappear below `lg`.

Required:

- Header with menu button, project identity, search, and theme toggle.
- Drawer or sheet for navigation.
- Expandable mobile TOC.
- Body scroll locking and focus trapping.
- Safe-area padding.
- Mobile code-tab overflow.
- Responsive diagrams and tables.

Recommendation:

- Use a full-height drawer from the left.
- Preserve sidebar styling inside the drawer.
- Use `--docs-overlay: rgba(6, 30, 28, 0.35)` in light mode and a stronger dark equivalent.
- Keep theme/search controls in a sticky mobile header.

## 4.6 Content typography

Missing:

- H1–H6 scale.
- Long-form paragraph measure.
- Lists, nested lists, blockquotes, horizontal rules.
- Definition lists.
- Footnotes.
- Images and captions.
- Heading anchors.
- Previous/next page navigation.

Suggested full-scale roles:

| Role | Suggested size/line height |
|---|---|
| Page H1 | `36px/1.1` desktop; `30px/1.12` mobile |
| H2 | `26px/1.2` |
| H3 | `21px/1.25` |
| H4 | `17px/1.3` |
| Body | `16px/1.7` |
| Small/meta | `13px/1.5` |
| Code | `13.5px/1.75` |
| Content width | `680–760px` |

Keep Outfit for headings and Inter for prose. The preview’s `13.5px` body size is suitable only because the entire docs site is a reduced marketing mockup.

## 4.7 Code system

Missing:

- Actual highlighter integration and complete syntax palette.
- Language/filename header rules.
- Line numbers.
- Line highlighting.
- Added/removed diff lines.
- Error annotations.
- Long-line scrolling.
- Code wrapping preference.
- Copy success state.
- Verified/runtime/compile badges at production scale.
- Code groups with more than two tabs.

Recommendation:

- Use Shiki for generated MDX and emit CSS variables.
- Base the light and dark themes on the existing `kw/str/fn/var` colors.
- Keep the unified code surface with inset tab rail.
- Attach verifier status in the top-right control area.
- Add:
  - Comment: muted.
  - Number/constant: purple-adjacent.
  - Operator/punctuation: codetext.
  - Inserted: pass.
  - Deleted/error: danger.
  - Warning: flag.

## 4.8 Callouts and guarantee states

Required variants:

- Info.
- Tip.
- Warning.
- Danger.
- Proven.
- Scored.
- Out-of-domain/open question.

Keep the gallery callout construction: tinted background, colored border, small outlined icon, rounded rectangle. Use mono uppercase labels only when the guarantee state is important; normal explanatory callouts should remain prose-first.

## 4.9 Tables/API surfaces

Missing:

- General tables.
- Responsive overflow.
- Sticky headers.
- Row hover/focus.
- Dense vs prose modes.
- API method badges.
- Required/deprecated/default indicators.
- Schema nesting.
- Copyable values.

Recommendation:

- Use `paper` headers over `canvas` bodies, fine line separators, mono technical cells, and teal type annotations.
- Avoid zebra striping; it conflicts with the restrained surface language.
- On mobile, horizontally scroll API tables instead of collapsing semantic columns.

## 4.10 Accessibility states

Missing or incomplete:

- Explicit contrast validation for all `color-mix()` combinations.
- `aria-expanded` on accordion controls.
- Visible copy confirmation.
- Current-page/current-section semantics.
- Search dialog focus behavior.
- Accessible text for proof icons.
- Persistent theme preference.
- System-theme mode.
- High-contrast mode.

The global `:focus-visible` rule is a good baseline:

```css
outline: 2px solid #0097a1;
outline-offset: 2px;
border-radius: 4px;
```

Move this into the docs token scope and change the dark theme focus color if required for contrast.

---

# 5. Portability map

## Copyable nearly verbatim

### Fonts

- [`apps/web/src/styles/fonts.css`](C:/Projects/docstube/apps/web/src/styles/fonts.css)
- [`apps/web/public/fonts`](C:/Projects/docstube/apps/web/public/fonts)

These are self-contained. Preserve paths or rewrite URLs during vendoring. The theme’s privacy/self-hosting posture aligns with the generated-site requirements.

### Core palette and typography declarations

From [`apps/web/src/styles/global.css`](C:/Projects/docstube/apps/web/src/styles/global.css):

- Font-family tokens.
- Brand scale.
- Ink, neutral, surface, and semantic colors.
- Shadow tokens.
- `--radius-xl`.
- `--ease-spring`.
- Base font rendering.
- Selection styling.
- Focus-visible styling.
- Reduced-motion rule.
- Scrollbar styling.

These can be copied with minimal renaming.

### Docs-preview token blocks

From the `<style>` section of [`GeneratedDocs.astro`](C:/Projects/docstube/apps/web/src/components/GeneratedDocs.astro):

- `[data-doc-preview]` light tokens.
- `.is-dark` overrides.
- `.dp-code` syntax mappings.
- Dot-grid rule.
- Nav/TOC hover behavior.
- Animated rail behavior.
- Accordion transitions.

These are the most direct starting point for the generated theme.

### Portable visual patterns

- Active sidebar row and nested gutter.
- Bent TOC rail concept.
- Tabbed code surface.
- Theme toggle rail.
- Diagram nodes/edges/caption.
- Verification chip treatment.
- Glossary dotted underline and tooltip.
- API-reference row grammar.

They should be extracted into real components rather than copied as one monolithic Astro file.

## Copyable with adaptation

### `Base.astro`

Useful:

- Global stylesheet import.
- Font preloads.
- Standard metadata.
- Self-hosted font rationale.

Entangled:

- Marketing title/description defaults.
- `Waitlist` import.
- Marketing favicon and generator label.
- docstube.dev canonical handling.

A docs layout needs project-derived metadata, version/locale canonicals, search assets, generated-site scripts, and no waitlist component.

### Header/Footer

- [`Header.astro`](C:/Projects/docstube/apps/web/src/components/Header.astro)
- [`Footer.astro`](C:/Projects/docstube/apps/web/src/components/Footer.astro)

Useful:

- Sticky translucent canvas header:
  `border-line/80 bg-canvas/80 backdrop-blur-xl`.
- `68px` header-height precedent.
- Compact rounded nav interactions.
- Font and button treatment.
- Footer hierarchy and mono generated-by signature.

Entangled:

- Marketing navigation data.
- GitHub repository CTA.
- Waitlist CTA.
- Variant switcher.
- Marketing footer columns.
- Marketing-specific max width.

A docs header should preserve the surface treatment but replace content with logo/project, version/locale, search, Ask AI, repository link, and mobile navigation.

### Global shared utilities

`.surface`, `.hover-lift`, `.chip`, `.terminal`, `.grid-bg`, and `.dot-bg` are portable, but they are marketing-oriented. Documentation should use `.hover-lift` sparingly; prose, nav, and reference rows should not all behave like marketing cards.

## Strongly entangled with the marketing site

### Entire `GeneratedDocs.astro` as a single component

The markup is a scale-model infographic embedded in a landing page:

- Text sizes are intentionally reduced.
- Sidebar and TOC are static.
- Links have no destinations.
- Search and Ask AI are non-functional.
- Code highlighting is manually marked up.
- Diagram is hand-built SVG/HTML, not D2 output.
- Theme state is local and not persisted.
- Gallery components are demonstrations, not reusable MDX implementations.
- Responsive behavior hides navigation without replacement.

Copy its token island and component motifs, not the full file wholesale.

### Marketing shell classes

The section’s:

- `dot-bg`.
- Large centered headline.
- Radial glow.
- Feature card grid.
- `surface hover-lift` cards.

These frame and advertise the docs design; they are not part of the actual docs theme.

---

# Implementation baseline

The most faithful full-theme implementation would:

1. Promote `--dp-*` into a complete semantic light/dark documentation token set.
2. Retain Outfit/Inter/JetBrains Mono and all self-hosted files.
3. Build the desktop shell around `222px / fluid / 188px`, allowing slightly wider production rails.
4. Preserve the pale teal surfaces, fine borders, active sidebar bar, bent TOC rail, dotted diagram canvases, and contextual verification badges.
5. Scale the mockup typography to production reading sizes.
6. Replace manual syntax spans with Shiki mapped to the existing syntax colors.
7. Build real mobile navigation, search, guarantee states, citations, tables, and accessibility behavior without changing the established visual grammar.

No files were modified.
