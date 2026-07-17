# Stacktape documentation theme specification

Source audited: `docs/src/**`, `docs/astro.config.mjs`, `docs/config.ts`, `docs/package.json`, public/assets, and the MDX content/component registry.

The implementation is an Astro 7 static documentation site with React 19 islands, Tailwind CSS 4, Shiki 4, Twoslash, and Algolia DocSearch 3.

A fundamental constraint: **the site is dark-only**. There is no light token set, `.dark` selector, color-scheme switch, theme toggle, or stored theme preference.

---

## 1. Design tokens

### 1.1 Core color tokens

These are registered in `docs/src/styles/global.css` under Tailwind 4’s `@theme`.

| Token | Exact value | Typical use |
|---|---:|---|
| `--color-brand` | `rgb(54 190 190)` / `#36BEBE` | Main accent, page-title border |
| `--color-primary` | `rgb(17 105 105)` / `#116969` | Selected/search states |
| `--color-primary-lighter` | `rgb(34 166 166)` / `#22A6A6` | Link hover |
| `--color-secondary` | `rgb(34 87 122)` / `#22577A` | Secondary actions |
| `--color-bg` | `rgb(28 33 33)` / `#1C2121` | Header, tooltip surface |
| `--color-page` | `rgb(22 28 28)` / `#161C1C` | Page background |
| `--color-element` | `rgb(34 40 40)` / `#222828` | Cards, code blocks, result hits |
| `--color-modal` | `rgb(30 35 35)` / `#1E2323` | Modal surface |
| `--color-darker` | `rgb(22 27 27)` / `#161B1B` | Dark inset/key surface |
| `--color-input` | `rgb(20 26 26)` / `#141A1A` | Search/input surfaces |
| `--color-input-hover` | `rgb(25 31 31)` / `#191F1F` | Input hover |
| `--color-hover` | `rgb(35 40 40)` / `#232828` | Generic hover surface |
| `--color-border` | `rgb(8 13 13)` / `#080D0D` | Strong/dark border |
| `--color-border-light` | `rgb(47 52 52)` / `#2F3434` | Sidebar/TOC rails |
| `--color-fc-primary` | `rgba(255,255,255,0.87)` | Main text |
| `--color-fc-secondary` | `rgba(10,187,181,1)` / `#0ABBB5` | Teal text |
| `--color-fc-light` | `rgb(140 140 140)` / `#8C8C8C` | Muted text/scrollbar |
| `--color-fc-lighter` | `rgb(160 160 160)` / `#A0A0A0` | Navigation/secondary text |
| `--color-fc-ternary` | `#848484` | Captions |
| `--color-fc-headline` | `#CECECE` | Headline text |
| `--color-light-gray` | `#A6A5A5` | List markers/subgroup labels |
| `--color-gray` | `#9A9A9A` | General gray |
| `--color-dark-grey` | `#2D2D2D` | Scrollbar hover |
| `--color-error` | `#EB6161` | Error states |
| `--color-success` | `rgb(24 153 144)` / `#189990` | Success/tip |
| `--color-aws-compute` | `rgb(237 113 0)` / `#ED7100` | AWS compute icons |
| `--color-aws-database` | `#4D73F4` | AWS database icons |
| `--color-aws-integration` | `#F64683` | AWS integration icons |
| `--color-aws-security` | `#F34446` | AWS security icons |
| `--color-aws-storage` | `#5CA034` | AWS storage icons |
| `--color-aws-network` | `#8E58EB` | AWS network icons |

Additional exact colors in `variables.ts`:

| Role | Value |
|---|---:|
| Navigation hover text | `rgba(255,255,255,0.75)` |
| Disabled primary | `rgb(21,114,120)` |
| Primary button border | `#40958E` |
| Secondary button border | `rgb(69,151,203)` |
| Highlighted legacy code line | `rgb(53,59,69)` |
| Sidebar list hover | `rgb(45,50,50)` |
| Dark gray hover | `rgb(27,32,32)` |
| VS Code blue | `#569CD6` |
| VS Code lighter blue | `rgb(102 160 208)` |
| VS Code orange | `#CE9178` |
| VS Code light gray | `#D4D4D4` |
| VS Code number green | `#B5CEA8` |
| VS Code comment green | `#608B4E` |
| VS Code background | `#1E1E1E` |
| Orange | `#ED8B00` |
| Orange-light | `#FBE9D0` |
| Green | `#00965E` |
| Green-light | `#D0EBE1` |
| Blue | `#0066CC` |
| White | `#FFFFFF` |
| Black | `#000000` |

No OKLCH values are used by the authored theme.

### 1.2 Background texture

`body` uses `#161C1C` plus two fixed repeating grid gradients:

```css
background-image:
  repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(54,190,190,0.02) 3px,
    rgba(54,190,190,0.02) 5px
  ),
  repeating-linear-gradient(
    90deg,
    transparent,
    transparent 2px,
    rgba(54,190,190,0.02) 3px,
    rgba(54,190,190,0.02) 5px
  );
background-attachment: fixed;
background-repeat: repeat;
```

### 1.3 Fonts

| Role | Stack |
|---|---|
| Sans | `Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| Mono | `"Geist Mono", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |

Weights loaded and used: `400`, `500`, `600`, `700`. A few landing components request nonstandard numeric weights such as `650`, `720`, and `750`; browsers interpolate them if a variable font is delivered, otherwise synthesize/map them.

There are **no local WOFF, WOFF2, TTF, or OTF assets** in the project. Both families load from:

```html
https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&display=swap
```

The source stub is `docs/src/styles/fonts.ts`; font loading is in `docs/src/layouts/DocsLayout.astro`.

### 1.4 Typography

Root browser font size is not overridden, so `1rem = 16px`.

| Role | Desktop | Small-screen behavior |
|---|---|---|
| Global prose/body | `0.925rem` = `14.8px`; weight `500`; line-height `1.9` | At `≤750px`: `0.85rem` = `13.6px` |
| Page title | `26px`, weight `500`, line-height `1.5` | At `≤795px`: `24px` |
| MDX `h1` | `28px`, weight `700`, line-height `1.4` | At `≤795px`: `25px` |
| MDX `h2` | `24.5px`, weight `700`, line-height `1.4` | At `≤795px`: `20px` |
| MDX `h3` | `20px`, weight `600`, line-height `1.4` | unchanged |
| MDX `h4` | `16px`, weight `500`, line-height `1.4`, underlined | unchanged |
| MDX paragraph | `0.925rem`; inherited line-height `1.9` | global `≤750px` base may reduce native size, but `.mdx-content p` explicitly remains `0.925rem` |
| Sidebar group | `12px`, `600`, `1.3`, `0.6px` letter-spacing, uppercase |
| Sidebar subgroup | `12px`, `600`, `1.4`, `0.5px`, uppercase |
| Sidebar leaf | `13.5px`, `400`, `1.4`, `0.02em` |
| TOC label/items | `12.5px`; label line-height `1`; item `1.2` |
| Code block wrapper | `13.5px`, line-height `1.5` |
| Highlighted code line | inherited `13.5px`; line-height `1.75`; minimum height `1.75em` |
| Code tabs | `12.5px`, `600`, line-height `1.2` |
| Inline code | `0.875em` of surrounding text |
| Image caption | `13px`, italic, line-height `1.5` |
| Blockquote caption | `14px`, centered, `#9B9999` |
| Search trigger text | `0.9rem` |
| Search result title | `0.925rem` |
| Search result path | `0.85rem` |

Heading spacing:

| Element | Top | Bottom |
|---|---:|---:|
| MDX `h1` | `72px` (`52px` at `≤795px`) | `23px` |
| MDX `h2` | `60px` (`42px` at `≤795px`) | `20px` |
| MDX `h3` | `40px` | `20px` |
| MDX `h4` | `17px` | `10px` |
| Paragraph | `10px` | `10px` |

`h1` and `h2` use `text-shadow: 2px 2px #161B1B`. MDX `h1` is teal `#0BA29D`.

### 1.5 Spacing system

The implementation does not enforce a bespoke named spacing scale. It uses:

1. Tailwind’s standard spacing scale, especially `2`, `3`, `4`, `5`, `6`, `8`, and `10`.
2. Many exact arbitrary pixel values.

The theme-critical recurring values are:

- Micro gaps/padding: `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `10`, `11`, `12`, `13`, `14`, `15`, `16`, `18`, `20px`.
- Section/component spacing: `22`, `24`, `25`, `26`, `28`, `30`, `35`, `40`, `42`, `44`, `45`, `52`, `54`, `55`, `60`, `72px`.
- Main content desktop padding: `30px 30px 0 45px`.
- Main content `≤720px`: `25px 17.5px 0 20px`.
- Code block outer margins: `25px 0 30px`.
- Callout margins/padding: `30px 0`; `16px 18px`.
- Tables: standard table `20px 0 16px`; comparison table `25px 0 30px`.
- Sidebar row horizontal outer margin: `8px`; each nesting depth adds `12px`.
- Sidebar row padding: `7px 12px 7px 10px`.

For a faithful port, preserve the arbitrary values instead of normalizing them onto a new spacing scale.

### 1.6 Radii

| Element | Radius |
|---|---:|
| General card/box/code shell | `8px` |
| Sidebar rows/groups | `7px` |
| Code/search tab container | `8px` |
| Code/search tab active pill | `6px` |
| Search trigger | `8px` |
| Search keycap | `5px` |
| Search form | `8px` |
| Search hit | outer `4px`; container `7px` |
| Search footer | `0 0 4.5px 4.5px` |
| DocSearch search bar | `4.5px` |
| Tooltip | `6px` |
| Inline code | `4px` |
| Badge | `4px` |
| Callout | `8px` |
| Highlight wrapper | `6px` |
| CTA section | `16px` |
| Circular markers | `50%` or `999px` |

### 1.7 Borders and shadows

General `.stp-box`:

```css
background: #222828;
border: none;
border-radius: 8px;
box-shadow:
  0 2px 8px rgba(0,0,0,0.75),
  0 0 0 1px rgba(255,255,255,0.10),
  inset 0 1px 0 rgba(255,255,255,0.20);
backdrop-filter: blur(10px);
```

Active sidebar pill/code-tab pill:

```css
background: linear-gradient(135deg, rgb(60,64,64), rgb(44,47,47));
box-shadow:
  0 4px 12px rgba(0,0,0,0.45),
  0 0 0 1px rgba(190,190,190,0.16),
  inset 0 1px 0 rgba(255,255,255,0.10);
```

Header:

```css
box-shadow:
  0 2px 8px rgba(0,0,0,0.55),
  0 1px 0 rgba(255,255,255,0.04),
  inset 0 -1px 0 rgba(255,255,255,0.04);
backdrop-filter: blur(10px);
```

Hover sidebar pill:

```css
background: rgba(255,255,255,0.06);
box-shadow:
  0 6px 14px rgba(0,0,0,0.35),
  inset 0 1px 0 rgba(255,255,255,0.05);
```

---

## 2. Layout system

### 2.1 Desktop grid

```text
fixed header: 54px high
└── centered page wrapper, max-width 1580px
    ├── sidebar: 295px fixed
    ├── main: flexible; maximum effective width 980px at full wrapper width
    └── TOC: 305px fixed
```

Calculation at the maximum viewport:

```text
1580px - 295px sidebar - 305px TOC = 980px main allocation
```

The main column itself has:

```css
width: 100%;
padding: 30px 30px 0 45px;
overflow-x: hidden;
```

Therefore its maximum content box width is:

```text
980px - 45px - 30px = 905px
```

There is no separate `max-width` on the article.

Page wrapper:

```css
margin: 54px auto 0;
display: flex;
justify-content: center;
width: 100%;
max-width: 1580px;
```

### 2.2 Header

- Fixed at `top: 0; left: 0; right: 0`.
- Height `54px`.
- `z-index: 50`.
- Horizontal padding `20px`; `15px` at `≤795px`.
- Surface `#1C2121`.
- Maximum inner width `1580px`, centered.

### 2.3 Sidebar

Desktop sidebar:

```css
position: sticky;
top: 54px;
width: 295px;
min-width: 295px;
height: calc(100vh - 54px);
overflow-x: hidden;
```

Its inner scroller:

```css
width: 100%;
padding-top: 20px;
overflow-y: auto;
border-right: 1px solid #2F3434;
-webkit-overflow-scrolling: touch;
```

The sidebar scroll position is persisted in `sessionStorage` under:

```text
_stp-sidebar-scroll-pos
```

It is captured before Astro view-transition swaps and restored immediately and again after `300ms`.

### 2.4 TOC

Desktop TOC:

```css
position: sticky;
top: 54px;
right: 0;
width: 305px;
min-width: 305px;
height: calc(100vh - 54px);
overflow-y: auto;
padding: 15px 10px 0 15px;
background: transparent;
scrollbar-width: none;
```

It is completely hidden at `≤1200px`.

### 2.5 Responsive breakpoints

| Breakpoint | Behavior |
|---:|---|
| `≤1200px` | Right-side TOC disappears. Main expands into that space. |
| `≤1000px` | Landing feature grids reduce from configured columns to two. |
| `≤870px` | Gallery two-column fallback; testimonials/pricing collapse to one column. |
| `≤795px` | Desktop header contents and desktop sidebar disappear; mobile logo/actions and hamburger appear. MDX `h1`/`h2`, page title adjust. |
| `≤750px` | Global body/nav/control typography reduces from `0.925rem` to `0.85rem`; search trigger becomes full-width in mobile drawer. |
| `≤720px` | Main padding becomes `25px 17.5px 0 20px`; footer rearranges. |
| `≤650px` | Card grids become block/one-column; mobile sign-up button becomes full-width within its allocation. |
| `≤500px` | MDX links may wrap; code block gets `3.5px` top adjustment; compact previous/next padding. |
| Minimum document width | `320px` |

### 2.6 Sticky and scroll behavior

- Header: fixed.
- Sidebar and TOC: independently sticky beneath the header.
- Main page: normal document scroll.
- `html` uses `scroll-behavior: smooth`.
- Heading navigation has `scroll-padding-top: 70px`.
- Browser scroll anchoring remains enabled.
- Global scrollbars are `8px`, thin, muted gray thumb, transparent/inherited track.
- TOC scrollbar is visually hidden.
- Mobile drawer does not overlay the article: when open, `html[data-mobile-nav-open] #main-content` becomes `display:none`.

### 2.7 Page transitions

The main column uses Astro view transitions:

- Old/new main transition duration: `200ms`, ease-out.
- Fade only.
- Reduced-motion duration: `150ms`.
- While loading, a `12px` spinner appears at `top:20px; right:20px`.

Header, desktop sidebar, and mobile navigation islands persist across route transitions.

---

## 3. Navigation

### 3.1 Group order

Exact configured order:

1. Introduction/root page, rendered without a group heading
2. Getting Started
3. Configuration
4. Resources
5. Packaging
6. Deploying & Lifecycle
7. Observability
8. Managing Costs
9. Guardrails
10. CI/CD & GitOps
11. Local Development
12. Using with AI
13. Stacktape Console
14. CLI Reference

Groups are produced dynamically from page paths and frontmatter order.

Default-open groups:

- Getting Started
- Resources

Default-open nested path:

- `/resources/compute`

The active page’s ancestor branch also opens automatically unless a persisted user override says otherwise.

### 3.2 Group headings

```css
margin: 1px 8px 3px;
padding: 8px 12px;
min-height: 32px;
border-radius: 7px;
font-size: 12px;
font-weight: 600;
line-height: 1.3;
letter-spacing: 0.6px;
text-transform: uppercase;
color: #A0A0A0;
display: flex;
align-items: center;
gap: 8px;
```

Contents:

- `16px` React icon.
- Flexible title.
- `14px` right chevron, opacity `0.5`.
- Chevron rotates from `0deg` to `90deg`.

### 3.3 Navigation rows

```css
min-height: 32px;
padding: 7px 12px 7px 10px;
border-radius: 7px;
gap: 8px;
```

Horizontal positioning:

```text
right margin = 8px
left margin = 8px + depth × 12px
vertical margin = 1px
```

Leaf label:

```css
font-size: 13.5px;
font-weight: 400;
line-height: 1.4;
letter-spacing: 0.02em;
color: rgba(255,255,255,0.87);
white-space: nowrap;
text-overflow: ellipsis;
overflow: hidden;
```

Virtual subgroup:

```css
font-size: 12px;
font-weight: 600;
line-height: 1.4;
letter-spacing: 0.5px;
text-transform: uppercase;
color: #A6A5A5;
```

### 3.4 Active and hover states

Active rows use the raised gray gradient pill described in §1.7.

Active hover changes the shadow to:

```css
0 5px 14px rgba(0,0,0,0.49),
0 0 0 1px rgba(220,220,220,0.17),
inset 0 1px 0 rgba(255,255,255,0.11)
```

Inactive hover uses `rgba(255,255,255,0.06)` and the `0 6px 14px` shadow.

### 3.5 Expand/collapse

- Entire group/subgroup row is clickable.
- Subgroups also support Enter and Space.
- Animation uses CSS grid from `grid-template-rows: 0fr` to `1fr`.
- Duration/easing: `220ms ease`.
- Collapsed descendants remain in DOM under `aria-hidden="true"`.
- User expansion overrides persist in `localStorage`:

```text
stacktape-docs-nav-state-v1
```

- The hierarchy guide is a dynamically measured SVG curve:
  - `1px` stroke.
  - Stroke `#2F3434`.
  - Recomputed using `ResizeObserver` during expansion.
  - Group child container starts at `margin-left:10px`.

### 3.6 Header navigation

Desktop, left to right:

- Full Stacktape logo, rendered width `205px`.
- Right cluster with `10px` gaps:
  - Algolia search trigger, `300×38px`.
  - “Sign up” primary button, `150×35px`.
  - GitHub secondary button, `210×38px`.

Mobile at `≤795px`:

- Compact Stacktape logo, `52×52px`.
- Right cluster, `15px` gap:
  - Sign-up action.
  - `27px` hamburger in an icon button.

### 3.7 Mobile navigation

Opening the hamburger renders, in normal layout flow:

1. Divider with horizontal margins `26px`.
2. Full-width search trigger.
3. Divider.
4. Sidebar tree in mobile mode.

Mobile sidebar changes:

- Width `100%`.
- Position `relative`.
- Height `auto`.
- No right border.
- Horizontal padding `12px`.
- `grow-down` animation: `125ms ease-in-out`, `scaleY(0→1)`.
- The main content is hidden while open.

---

## 4. Table of contents

### 4.1 Construction

Astro supplies all rendered headings. The component filters out level 1:

```ts
rawToc.filter(item => (item.level || 1) > 1)
```

Thus it displays `h2`, `h3`, `h4`, etc., but not the page title or content `h1`.

### 4.2 Geometry

Exact constants:

```text
row height:             26px
indent per heading level: 12px
path x offset:           8px
curve transition zone:   8px
gap path→text:           14px
active snake length:     18px
```

Each item’s x-position:

```text
itemX = 8px + (item.level - minimumDisplayedLevel) × 12px
text padding-left = itemX + 14px
```

The rail is a dynamically generated SVG path:

- Muted rail: `#2F3434`, `1px`.
- Active segment: `rgba(255,255,255,0.87)`, `2px`, round caps.
- Active segment uses `stroke-dasharray: 18 99999`.
- Motion: `stroke-dashoffset 320ms cubic-bezier(0.4,0,0.2,1)`.
- Level changes use sampled cubic Bézier curves.

### 4.3 Styling

Header:

```css
margin-left: 10px;
padding: 7px 24px 7px 5px;
gap: 10px;
font-size: 12.5px;
line-height: 1;
```

It includes a `15px` AlignRight icon and “Contents”.

Items:

```css
height: 26px;
font-size: 12.5px;
line-height: 1.2;
padding-right: 12px;
white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;
```

Inactive:

```css
font-weight: 400;
color: #A0A0A0;
```

Active:

```css
font-weight: 500;
color: rgba(255,255,255,0.87);
```

### 4.4 Active-section algorithm

- At page scroll `<100px`, first TOC heading is active.
- Initial scan selects the last heading whose top is `<75px`.
- `IntersectionObserver`:
  - `rootMargin: -75px 0% -80% 0%`
  - `threshold: 0`
- If multiple headings intersect, the topmost wins.
- If none intersects, the most recent heading above `75px` wins.

---

## 5. Code blocks

### 5.1 Highlighting stack

Astro compile-time syntax highlighting is disabled:

```js
markdown.syntaxHighlight = false
```

Code blocks are transformed from Markdown AST nodes into hydrated `<CodeBlock>` islands by:

- `src/utils/remark-code-to-component.ts`
- `src/components/mdx-islands/CodeBlock.astro`
- `src/components/Mdx/DocsCodeBlock.tsx`
- `src/components/Mdx/CodeBlockNew.tsx`

The island hydrates with `client:visible`.

### 5.2 Shiki configuration

Exact theme:

```text
catppuccin-mocha
```

Preloaded languages:

```text
typescript
tsx
javascript
jsx
json
jsonc
yaml
bash
shell
dockerfile
toml
python
sql
```

Aliases normalized:

```text
yml → yaml
shell, sh → bash
ts → typescript
js → javascript
```

Unknown languages fall back to `text`.

### 5.3 Transformers

Potential transformer order:

1. Twoslash transformer, when IntelliSense is enabled and language supports it.
2. Custom YAML hover transformer from `computeYamlHovers`.

Twoslash setup:

- `@shikijs/twoslash` `createTransformerFactory`.
- `rendererRich()`.
- `twoslash-cdn`.
- Compiler libs: `esnext`, `dom`.
- `noErrorValidation: true`.
- Stacktape declaration files:
  - `index.d.ts`
  - `types.d.ts`
  - `plain.d.ts`
  - `cloudformation.d.ts`
- Production declarations source: `https://cdn.jsdelivr.net/npm/stacktape@latest`.
- Development source: `/stacktape`.
- Cache prefix: `stacktape-docs-twoslash:` in `localStorage`.

If decorated rendering fails, the block retries with plain Shiki and no transformers. If Shiki itself fails, it shows unhighlighted code and “Syntax highlighting unavailable”.

### 5.4 Block shell

Outer wrapper:

```css
margin-top: 25px;
margin-bottom: 30px;
width: 100%;
font-size: 13.5px;
line-height: 1.5;
overflow: visible;
```

Shell:

```css
position: relative;
overflow-x: auto;
overflow-y: hidden;
padding: 16px 0 14px;
background: #222828;
border: none;
border-radius: 8px;
box-shadow:
  0 2px 8px rgba(0,0,0,0.75),
  0 0 0 1px rgba(255,255,255,0.10),
  inset 0 1px 0 rgba(255,255,255,0.20);
backdrop-filter: blur(10px);
```

At `≤500px`, a tabbed block adds `3.5px` top margin to the shell.

There is no title bar for fenced code. There is no standalone language badge. When multiple variants exist, the tab strip serves as the identifying label.

### 5.5 Code lines

```css
display: block;
width: 100%;
padding: 0 18px;
line-height: 1.75;
min-height: 1.75em;
white-space: pre;
font-family: "Geist Mono", ...;
font-variant-ligatures: none;
font-feature-settings: "liga" 0, "calt" 0;
```

The Shiki `<pre>` is forced transparent:

```css
background: transparent !important;
margin: 0;
padding: 0;
min-width: 100%;
overflow: visible;
```

### 5.6 Highlighted and focused lines

Markers supported in `#` or `//` comments:

```text
[!code focus]
[!code focus:N]
[!code focus-start]
[!code focus-end]
[!code highlight]
[!code highlight:N]
[!code highlight-start]
[!code highlight-end]
```

Markers are stripped before display/copy.

Focus behavior collapses nonfocused runs to a single `...` placeholder. Placeholder style:

```css
color: #8C8C8C;
opacity: 0.75;
```

Highlighted line:

```css
background: linear-gradient(
  90deg,
  rgba(137,180,250,0.18) 0%,
  rgba(137,180,250,0.08) 55%,
  rgba(0,0,0,0) 100%
);
border-left: 2px solid rgba(137,180,250,0.8);
```

There are **no visible line numbers**.

### 5.7 Copy button

- Absolutely positioned `right:14px`.
- `z-index:20`.
- Initially opacity `0`; block hover sets opacity `1`.
- Top:
  - `7px` for blocks with ≤2 lines.
  - `14px` otherwise.
- Uses `18px` copy/check icons.
- Feedback lasts `1000ms`.
- Transition: `all 250ms ease, opacity 0.2s ease-in-out`.
- Copies processed source with presentation markers removed.
- Clipboard API with textarea fallback.

### 5.8 Code tabs

Tabs appear only when there is more than one code variant.

Container:

```css
display: inline-flex;
gap: 3px;
padding: 3px;
margin-bottom: 8px;
background: rgba(0,0,0,0.25);
border-radius: 8px;
box-shadow:
  inset 0 1px 3px rgba(0,0,0,0.3),
  0 1px 0 rgba(255,255,255,0.05);
backdrop-filter: blur(10px);
```

Button:

```css
font-size: 12.5px;
line-height: 1.2;
font-weight: 600;
padding: 7px 10px;
border-radius: 6px;
color: rgba(190,190,190,0.8);
```

Active pill uses the active sidebar gradient/shadow. The measured pill slides with:

```css
left 350ms cubic-bezier(0.34,1.56,0.64,1),
width 350ms cubic-bezier(0.34,1.56,0.64,1)
```

Code content fades in on tab change:

```css
180ms ease-out;
opacity: 0→1;
transform: translateY(4px)→translateY(0);
```

Platform-specific tabs select Windows, Linux, macOS ARM, or macOS by default. The label `stacktape.ts` is displayed as `TypeScript`.

### 5.9 Inline code

```css
font-family: "Geist Mono", ...;
font-size: 0.875em;
color: #36BEBE;
background: rgba(54,190,190,0.13);
padding: 0 5px;
border-radius: 4px;
display: inline-block;
vertical-align: baseline;
max-width: 100%;
word-break: break-all;
white-space: normal;
font-variant-ligatures: none;
```

Inside `<pre>`, all inline-code background, padding, radius, and border are removed.

### 5.10 Scrollbars

Global/code scrollbar target:

```css
scrollbar-width: thin;
scrollbar-color: #8C8C8C transparent;
```

WebKit:

- Width/height `8px`.
- Track inherits background, `10px` radius.
- Thumb `#8C8C8C`, `10px` radius, `2px` transparent border clipped to padding.
- Hover thumb `#2D2D2D`.

Note: `.stp-pretty-scrollbar`’s WebKit selectors contain a descendant space, while the global `html/body` scrollbar rules guarantee the code shell still receives the site-wide appearance.

### 5.11 Twoslash popups

Primary popup tokens:

```css
--twoslash-border-color: rgba(147,153,178,0.24);
--twoslash-underline-color: #89B4FA;
--twoslash-popup-bg: rgba(30,30,46,0.96);
--twoslash-popup-color: #CDD6F4;
--twoslash-popup-shadow: 0 18px 48px rgba(0,0,0,0.45);
--twoslash-docs-color: #A6ADC8;
--twoslash-link-color: #89B4FA;
--twoslash-error-color: #F38BA8;
--twoslash-warn-color: #F9E2AF;
--twoslash-tag-color: #89DCEB;
```

Popup:

```css
position: fixed;
z-index: 9999;
min-width: 280px;
max-width: min(600px, calc(100vw - 40px));
border: 1px solid rgba(147,153,178,0.24);
border-radius: 6px;
font-size: 13px;
line-height: 1.5;
```

It is portaled to `<body>`, clamped to `10px` viewport margins, placed `2px` below the token, and flipped above if required.

---

## 6. MDX component set

The complete registry is in `src/components/mdx-react-components.tsx`, plus interactive Astro wrappers registered by `[...slug].astro`.

### 6.1 Native Markdown elements

- Paragraphs, headings, lists, links, inline code, and blockquotes render as native HTML.
- Lists remove native markers.
- Unordered marker: `4×4px` `#A6A5A5` circle positioned `16px` left.
- Ordered marker: CSS counter, `14px`, `#A6A5A5`.
- Lists: `18px` vertical margins, `24px` left padding; `20px` at `≤795px`.
- List items: `10px` vertical margin, line-height `1.8`.
- Images: width `100%`, height auto, no shadow.
- Blockquotes: `margin-top:-24px; margin-bottom:35px`; centered `14px` gray text.

### 6.2 Links

`Link`:

```css
color: rgb(34,186,181);
white-space: nowrap;
font-weight: 500;
```

At `≤500px`, links may wrap. External links open in a new tab with `noopener noreferrer`. Internal paths receive trailing slashes.

### 6.3 Callouts/admonitions

Components: `Warning`, `Info`, `Tip`, `Error`.

Shared layout:

```css
margin: 30px 0;
display: flex;
align-items: center;
padding: 16px 18px;
border-left-width: 4px;
border-radius: 8px;
line-height: 1.6;
box-shadow:
  0 2px 8px rgba(0,0,0,0.15),
  inset 0 1px 0 rgba(255,255,255,0.05);
backdrop-filter: blur(8px);
```

| Type | Border | Background |
|---|---|---|
| Warning | `#ED8B00` | `rgba(237,139,0,0.12)` |
| Info | `#0066CC` | `rgba(0,102,204,0.12)` |
| Tip | `rgb(24,153,144)` | `rgba(24,153,144,0.12)` |
| Error | `#E74C3C` | `rgba(231,76,60,0.12)` |

All callout text is `rgba(255,255,255,0.87)`, weight `500`, `0.925rem`, line-height `1.9`; `0.85rem` at `≤750px`.

Although icon arguments exist in the registry, the current `Highlighter` implementation does not render the supplied icon.

### 6.4 Content tabs

Components: `Tabs`, `Tab`.

- Wrapper: `margin:20px 0 24px`.
- Tab header: bottom border `1px solid rgba(255,255,255,0.1)`; bottom margin `12px`.
- Button: `14px`, line-height `1.5`, padding `3px 16px`.
- Active: `2px` bottom border using `#116969`, primary text, weight `600`.
- Inactive: transparent bottom border, `#848484`, weight `400`.
- Only active panel displays.
- Before hydration, global CSS hides all panels after the first.

These content tabs are visually distinct from the pill-style code tabs.

### 6.5 Standard table

```css
width: 100%;
margin: 20px 0 16px;
border-spacing: 0;
border-radius: 8px;
background: #222828;
```

Header:

- Background `rgba(0,0,0,0.2)`.
- Text `14px`.
- Padding `14px 18px`.
- Bottom border `rgba(255,255,255,0.08)`.
- Weight `600`.

Cells:

- `14px`.
- Padding `12px 18px`.
- Bottom borders `rgba(255,255,255,0.05)`.
- Row hover `rgba(255,255,255,0.03)`.

The table itself is not wrapped in a horizontal overflow container; ports should add a wrapper only if preserving the same visual appearance and behavior.

### 6.6 Feature comparison table

- Horizontal-scroll wrapper.
- Margin `25px 0 30px`.
- Radius `8px`.
- Border `rgba(255,255,255,0.1)`.
- Shadow `0 2px 8px rgba(0,0,0,0.3)`.
- Table font `0.875rem`.
- Cells `10px 14px`.
- Header is sticky at top, `12px`, uppercase, `0.5px` tracking.
- Check: `#189990`, `16px`.
- Cross: `#666`, `16px`.
- Unavailable dash: `#555`.

### 6.7 Badge

Defaults:

```css
display: inline-flex;
align-items: center;
min-width: 14px;
padding: 1px 7px;
border-radius: 4px;
font-size: 0.8rem;
font-weight: 500;
line-height: 1.4;
white-space: nowrap;
border: 1px solid #161B1B;
```

Text automatically becomes `rgba(255,255,255,0.95)` for dark backgrounds or `rgba(0,0,0,0.95)` for light backgrounds.

### 6.8 Images and screenshots

`MdxImage`:

```css
width: 100%;
height: auto;
box-shadow: none !important;
```

Global images also receive `padding:10px 0`.

`ConsoleScreenshot`:

- Figure margin `30px 0`.
- Centered.
- Image full-width up to supplied `maxWidth`.
- Caption: `13px`, italic, `#848484`, margin-top `10px`.
- Missing-image placeholder:
  - Minimum height `200px`.
  - `8px` radius.
  - Dashed `1px #080D0D` border.
  - Background `rgba(255,255,255,0.025)`.
  - Padding `44px 28px`.

### 6.9 Navigation cards

Components: `DeploymentOptions`, `GettingStartedOptions`, `ResourceList`, `NavBox`, `NavBoxGrid`.

- Auto-fill grid.
- Typical minimum column width `422px`; starter projects use `382px`.
- Gap usually `10–12px`.
- Collapse to block at `≤650px`.
- Cards use `.stp-box` and interactive raised hover/active states.
- Card title `1rem`.
- Description `0.85rem`, line-height `1.4`, `#848484`.
- Right chevron `24px`.

### 6.10 Decision and structure diagrams

`DecisionTree`:

```css
margin: 24px 0;
padding: 20px;
background: #222828;
border-radius: 8px;
box-shadow:
  0 2px 8px rgba(0,0,0,0.4),
  inset 0 1px 0 rgba(255,255,255,0.05);
```

Question nodes use a `20px` circular `?` marker. Answer nodes use `→`; result nodes use `✓` and a translucent primary background.

`ProjectStructure` uses the same surface/shadow with `20px` horizontal and `16px` vertical padding.

`FlowDiagram` uses:

- `32px` numbered circles.
- `2px` vertical connector.
- Circle surface `#116969`.
- Connector `rgba(17,105,105,0.2)` as produced by the source’s appended `33` alpha hex.
- `20px` step spacing.

### 6.11 Previous/next navigation

- Margin-top `40px`, right margin `15px`.
- Two equal columns with `15px` gap.
- Cards use the shared interactive box styling.
- Direction label `13px`.
- Page title `16px`, weight `600`.
- At `≤500px`, internal padding reduces to `6–10px`.

### 6.12 Starter project components

Two variants exist:

- `StarterProjectList` / `StarterProjectListShort`: compact card grid, minimum width `382px`.
- `StarterProjectGallery`: searchable/filterable hydrated gallery.

Gallery card:

```css
padding: 16px 18px;
height: 100%;
```

Hover:

```css
transform: translateY(-3px);
box-shadow:
  0 8px 20px rgba(0,0,0,0.6),
  0 0 0 1px rgba(255,255,255,0.12),
  inset 0 1px 0 rgba(255,255,255,0.22);
```

Search input height `44px`, radius `10px`, maximum width `460px`.

### 6.13 Landing components

Registered components:

- `LandingHero`
- `CTAButton`
- `ButtonRow`
- `FeatureGrid`
- `Steps`
- `Step`
- `CTASection`
- `OpenSourceBanner`
- `Testimonials`
- `PricingColumns`
- `StatStrip`

Brand gradient:

```css
linear-gradient(120deg, #7FE8D4 0%, #36BEBE 42%, #4AA6DC 100%)
```

Landing hero heading:

- `40px`, line-height `1.12`, weight `750`.
- `32px` at `≤870px`.
- `27px` at `≤650px`.

Feature cards use `20px 20px 22px`, `42×42px` icon tiles with `11px` radius.

Steps use `34×34px` gradient number circles and `2px` connectors.

CTA section uses:

```css
padding: 36px 30px;
border-radius: 16px;
background:
  linear-gradient(135deg, rgba(54,190,190,0.1), rgba(74,166,220,0.06));
box-shadow: inset 0 0 0 1px rgba(54,190,190,0.22);
```

### 6.14 Specialized/data-driven components

Also registered:

- `CliCommandsApiReference`
- `EngineVersionsList`
- `PropDescription`
- `ReferenceableParams`
- `ApiReference`
- `Jargon`
- `NegativeMargin`
- `Divider`

These reuse the same surfaces, type stacks, colors, and borders, but are strongly tied to generated schemas or repository data. `ApiReference` uses its own narrow `5px` scrollbar with an `rgba(255,255,255,0.18)` thumb.

---

## 7. Search UI

### 7.1 Engine

Algolia DocSearch 3:

```text
appId: PFTWPISD3F
indexName: Docs crawler
```

The public search-only API key is supplied from `config.ts`.

### 7.2 Trigger

Desktop trigger:

```css
width: 300px;
height: 38px;
padding: 0 8px 0 12px;
background: #141A1A;
border: none;
border-radius: 8px;
box-shadow:
  inset 0 1px 3px rgba(0,0,0,0.3),
  0 1px 0 rgba(255,255,255,0.05),
  0 0 0 1px rgba(255,255,255,0.05);
backdrop-filter: blur(10px);
```

At `≤750px`:

```css
width: calc(100% - 40px);
margin: 20px;
```

Search icon `16×16px`. Placeholder `0.9rem`, `#A0A0A0`.

Keyboard keycaps:

- Background `#161B1B`.
- Radius `5px`.
- Padding `2px 6px`.
- Minimum width `20px`.
- Text `0.85rem`, `#A0A0A0`.

### 7.3 Overlay/modal tokens

```css
--docsearch-primary-color: rgb(34,136,132);
--docsearch-container-background: rgba(0,0,0,0.8);
--docsearch-modal-background: #1C2121;
--docsearch-modal-shadow: 0 8px 32px rgba(0,0,0,0.6);
--docsearch-hit-background: #222828;
--docsearch-footer-background: #161B1B;
```

Search form:

- `#141A1A`.
- Radius `8px`.
- Same inset search-trigger shadow.
- Bottom margin `12px`.

Results:

- Outer hit margin `2px 0`.
- Container padding `12px`.
- Radius `7px`.
- Background `#222828`.
- Shadow:

```css
0 2px 8px rgba(0,0,0,0.55),
0 0 0 1px rgba(255,255,255,0.08),
inset 0 1px 0 rgba(255,255,255,0.12)
```

Selected result:

- Outer background `#116969`.
- Inner background transparent.
- Title primary white.
- Path `#A0A0A0`.

Footer:

- Background `#161B1B`.
- Border `1px solid #080D0D`.
- Radius `0 0 4.5px 4.5px`.

The modal’s unspecialized sizing and structural behavior remain Algolia DocSearch 3 defaults from `@docsearch/css/dist/style.css`.

---

## 8. Dark mode

There is no theme mode system.

Specifically absent:

- No light-mode token values.
- No `prefers-color-scheme` color rules.
- No `.dark` class.
- No `data-theme`.
- No toggle component.
- No local/session-storage theme preference.
- No inline startup script to avoid a color flash.

The only `prefers-*` theme-adjacent behavior is `prefers-reduced-motion`.

A faithful implementation should therefore render the dark palette unconditionally. If the target generator requires light/dark tokens, define both modes to the same dark values unless intentionally extending the design.

---

## 9. Portability map

### 9.1 Nearly verbatim portable

These files are primarily presentation or self-contained UI and can be copied with path/import adjustments:

- `src/styles/global.css`
- `src/styles/fonts.ts`
- `src/styles/variables.ts`
- `src/assets/logo.svg`
- `src/assets/logo-full-dark.svg`
- `src/components/Box/Box.tsx`
- `src/components/Button/Button.tsx`
- `src/components/Button/IconButton.tsx`
- `src/components/Anchor.tsx`
- `src/components/Img.tsx`
- `src/components/Mdx/Badge.tsx`
- `src/components/Mdx/Divider.tsx`
- `src/components/Mdx/Highlighter.tsx`
- `src/components/Mdx/Image.tsx`
- `src/components/Mdx/Link.tsx`
- `src/components/Mdx/Table.tsx`
- `src/components/Mdx/Tabs.tsx`
- `src/components/Mdx/DecisionTree.tsx`
- `src/components/Mdx/FeatureComparisonTable.tsx`
- `src/components/Mdx/Landing.tsx`
- `src/components/Mdx/PreviousNext.tsx`
- `src/components/Mdx/DeploymentOptions.tsx`
- `src/components/Misc/GridList.tsx`
- `src/components/Tooltip/WithTooltip.tsx`
- `src/components/Utils/ExpandableItem.tsx`
- `src/components/mdx-islands/Tabs.astro`
- `src/components/mdx-islands/ConsoleScreenshot.astro`
- `src/components/mdx-islands/StatStrip.astro`
- `src/stores/mobile-nav.ts`

Portable with a small configuration adapter:

- `src/components/Header/Header.tsx`: replace analytics links/config and logo imports.
- `src/components/Footer/Footer.tsx`: replace metadata/status/contact values.
- `src/components/Search/DocSearch.tsx`: replace Algolia credentials.
- `src/components/TableOfContents/TableOfContents.tsx`: adapt the heading input shape.
- `src/components/Mdx/ConsoleScreenshot.tsx`: preserve asset URL semantics.

### 9.2 Portable code, but coupled to the current Markdown pipeline

These can move to another Astro project, but the destination must reproduce the same remark/MDX island wiring:

- `src/components/Mdx/CodeBlockNew.tsx`
- `src/components/Mdx/DocsCodeBlock.tsx`
- `src/components/mdx-islands/CodeBlock.astro`
- `src/utils/remark-code-to-component.ts`
- `src/utils/remark-fix-jsx-template-indent.ts`
- `src/utils/remark-docs-transforms.ts`
- `src/utils/rehype-docs-links.ts`
- `src/components/mdx-react-components.tsx`
- `src/components/mdx-islands/*.astro`
- Markdown processor configuration in `astro.config.mjs`

Code highlighting additionally depends on:

- `shiki`
- `@shikijs/twoslash`
- `twoslash-cdn`
- `typescript`
- `src/components/Mdx/yaml-hover.ts`
- `src/utils/yaml-to-typescript.ts`

The Stacktape IntelliSense portion must be replaced or disabled if the destination does not expose equivalent declaration files.

### 9.3 Entangled with navigation/content collections

These depend on the current Astro content collection shape, page frontmatter, URL conventions, or generated navigation input:

- `src/content.config.ts`
- `src/utils/docs-data.ts`
- `src/pages/[...slug].astro`
- `src/layouts/DocsLayout.astro`
- `src/components/Navigation/SidebarNavigation/navigation-data.ts`
- `src/components/Navigation/SidebarNavigation/expansion-store.ts`
- `src/components/Navigation/SidebarNavigation/guide-path.ts`
- `src/components/Navigation/SidebarNavigation/ContentTree.tsx`
- `src/components/Navigation/SidebarNavigation/ContentTreeGroup.tsx`
- `src/components/Navigation/SidebarNavigation/ContentTreeNode.tsx`
- `src/components/Navigation/SidebarNavigation/Sidebar.tsx`
- `src/components/Navigation/MobileHamburgerNavigation/MobileHamburgerNavigation.tsx`
- `config.ts`
- Global types such as `MdxPageDataForNavigation` and `TableOfContentsItem`

The visual React components can be retained, but the tree-building adapter must emit the same fields:

```ts
{
  url,
  key,
  title,
  order,
  icon,
  children
}
```

### 9.4 Entangled with generated schemas/repository data

These cannot be copied as standalone theme components without replacing their data sources:

- `src/generated/api-reference-data.ts`
- `src/components/Mdx/api-reference/**`
- `src/components/mdx-islands/ApiReference.astro`
- `src/components/Mdx/CliCommandsApiReference.tsx`
- `src/components/Mdx/EngineVersionList.tsx`
- `src/components/Mdx/PropDescription.tsx`
- `src/components/Mdx/ReferenceableParams.tsx`
- `src/components/Mdx/ResourceList.tsx`
- `src/components/Mdx/StarterProjectList.tsx`
- `src/components/Mdx/StarterProjectGallery.tsx`
- `src/components/mdx-islands/StarterProjectGallery.astro`
- `src/utils/api-reference-extractor.ts`
- `src/utils/api-reference-typescript.ts`
- `src/utils/schema-extractor.ts`
- `scripts/generate-api-reference-data.ts`
- `scripts/enhance-config-schema.ts`
- `scripts/sync-stacktape-types.ts`
- Imports from the repository-level `@generated` tree
- Content under `docs/docs/**`

### 9.5 Astro configuration sections to preserve

Portable theme/build portions of `astro.config.mjs`:

- React integration.
- MDX integration.
- Tailwind Vite plugin.
- `syntaxHighlight:false`.
- Remark plugin ordering.
- Shiki dependency prebundling.
- Trailing-slash behavior.
- Hover-prefetch behavior.

Repository-specific portions to replace:

- Copying `docs/docs/static` into `public/static`.
- `stacktapeRepoRoot` Vite filesystem allowance.
- Sitemap priorities and route exclusions.
- Stacktape generated-type paths.
- Production site URL and analytics metadata.

The most faithful migration strategy is to port `global.css`, the shared primitive components, code-block pipeline, TOC renderer, and sidebar row renderers unchanged, then implement adapters for the destination generator’s page tree, headings, content rendering, search credentials, and generated API data.
