## Stacktape theme

### Fidelity gaps

- **DEFECT — all visible keyboard focus is globally removed.** The spec describes keyboard-operable navigation and focus-driven copy controls (§3.5, lines 504–510; §5.7), but the reset explicitly sets both `*:focus` and `*:focus-visible` to `outline:none` with no general replacement. This makes links, nav rows, tabs, and controls visually unfocusable. [spec](C:/Projects/docstube/knowledge/design/theme-spec-stacktape.md:504), [CSS](C:/Projects/docstube/packages/theme/src/themes/stacktape/site/styles/global.css:400)

- **DEFECT — native tables are not responsive.** The desktop geometry allows a 905px content box (§2.1, lines 266–280), but real tables can exceed it. `.mdx-content table` uses `width:100%` and `overflow:hidden`; there is no scroll wrapper, so wide API/config tables clip rather than scroll. [spec](C:/Projects/docstube/knowledge/design/theme-spec-stacktape.md:266), [CSS](C:/Projects/docstube/packages/theme/src/themes/stacktape/site/styles/global.css:638)

- **DEFECT — reduced motion still animates.** The spec records a reduced-motion transition of 150ms (§2.7), but navigation expansion, chevrons, TOC snake, hover fades, and the mobile `grow-down` animation are not covered by a comprehensive reduced-motion rule. The only override shown targets view transitions. [spec](C:/Projects/docstube/knowledge/design/theme-spec-stacktape.md:377), [CSS](C:/Projects/docstube/packages/theme/src/themes/stacktape/site/styles/global.css:436), [Sidebar](C:/Projects/docstube/packages/theme/src/themes/stacktape/site/components/Sidebar.tsx:78)

- **DEFECT — mobile navigation semantics are incomplete.** Group headers are keyboard-operable but use `role="button"` without `aria-expanded` or `aria-controls`; collapsed descendant links remain focusable because only the container gets `aria-hidden`. That conflicts with the spec’s explicit collapsed-state semantics (§3.5). [spec](C:/Projects/docstube/knowledge/design/theme-spec-stacktape.md:504), [Sidebar](C:/Projects/docstube/packages/theme/src/themes/stacktape/site/components/Sidebar.tsx:133)

- **DEFECT — code-focus behavior differs materially.** The spec’s focused-code behavior collapses unfocused runs; the implementation merely dims them to `opacity:.4` and reveals them on hover. The adaptation is documented in CSS, but the result is not behaviorally equivalent and can leave very long examples visually dominant. [CSS](C:/Projects/docstube/packages/theme/src/themes/stacktape/site/styles/global.css:747)

- **DOCUMENTED ADAPTATION — flat navigation.** The kernel supplies flat groups rather than the source’s deep frontmatter tree. Consequently, the measured curved hierarchy guide becomes a straight 1px rail, all groups default open, and source-specific default-open paths cannot be reproduced. This is explicitly recorded and should not block fidelity acceptance. [Sidebar](C:/Projects/docstube/packages/theme/src/themes/stacktape/site/components/Sidebar.tsx:3), [CSS](C:/Projects/docstube/packages/theme/src/themes/stacktape/site/styles/global.css:1304)

- **DOCUMENTED ADAPTATION — Algolia to Pagefind.** The implementation deliberately skins the kernel Pagefind UI to match the original Algolia surface. The visual dimensions remain close to the specified `300×38px`; provider-specific behavior naturally differs. [spec](C:/Projects/docstube/knowledge/design/theme-spec-stacktape.md:523), [CSS](C:/Projects/docstube/packages/theme/src/themes/stacktape/site/styles/global.css:1562)

- **DOCUMENTED ADAPTATION — Astro 6/Tailwind integration.** The source spec describes Astro 7; the implementation pins against Astro 6.4.6 and uses the PostCSS Tailwind plugin because the Vite plugin breaks under Rolldown. The reason is clearly recorded. [spec](C:/Projects/docstube/knowledge/design/theme-spec-stacktape.md:5), [manifest](C:/Projects/docstube/packages/theme/src/themes/stacktape/theme.ts:13), [integration](C:/Projects/docstube/packages/theme/src/themes/stacktape/site/integrations.mjs:1)

- **DOCUMENTED ADAPTATION — Twoslash omitted.** The source stack includes Twoslash, while the manifest includes only Shiki transformers. Highlight/focus markers are preserved, but type-query annotations and Twoslash diagnostics are absent. That is an accepted architectural simplification, not accidental CSS drift. [spec](C:/Projects/docstube/knowledge/design/theme-spec-stacktape.md:5), [manifest](C:/Projects/docstube/packages/theme/src/themes/stacktape/theme.ts:27)

- **Faithful areas:** core palette, dark-only posture, Geist families and weights, 54/295/305px shell, typography, heading spacing, sidebar storage keys, 26px TOC rows, curved rail constants, code shell geometry, and contextual proof styling closely match the exact spec. The TOC implementation preserves all six documented geometry constants. [spec](C:/Projects/docstube/knowledge/design/theme-spec-stacktape.md:573), [TOC](C:/Projects/docstube/packages/theme/src/themes/stacktape/site/components/TableOfContents.tsx:10)

### Quality risks

- Highest risk is keyboard accessibility: focus is invisible globally.
- A 320–795px mobile view replaces the article with in-flow navigation, but it does not lock focus or restore focus to the hamburger when closed.
- Long header titles use `white-space:nowrap`; combined with search/version/locale controls, intermediate widths can squeeze or overflow before the 795px breakpoint. [CSS](C:/Projects/docstube/packages/theme/src/themes/stacktape/site/styles/global.css:1189)
- Deep navigation is structurally unsupported by the flat kernel shape; long labels are safely ellipsized, but users cannot inspect the full label without a tooltip.
- The hidden TOC scrollbar makes very long TOCs discoverability-poor, although scrolling itself works.
- Body contrast is sound: `rgba(255,255,255,.87)` on `#161c1c` is comfortably AA; `#8c8c8c` is about **5.13:1**, `#a0a0a0` about **6.60:1**, and the weakest ordinary caption token `#848484` about **4.61:1**. These pass AA for normal text, narrowly in the last case.
- Self-hosted fonts are an operational improvement over the source’s Google Fonts dependency and include `font-display:swap`; fallback behavior is acceptable.

### Verdict

**Ship-with-fixes.**

Ranked blockers:

1. Restore a visible global `:focus-visible` treatment.
2. Make native tables horizontally scrollable.
3. Add `aria-expanded`/`aria-controls`, remove collapsed links from the tab order, and restore focus on drawer close.
4. Apply reduced-motion handling to navigation, TOC, tabs, and code-focus transitions.
5. Revisit the dimmed-code adaptation or document it at the manifest/conformance level.

---

## docstube theme

### Fidelity gaps

- **DEFECT — title and article geometry miss the production recommendations.** The spec’s production scale recommends H1 `36px/1.1`, H2 `26px`, and article padding `24px`/`28px` (§4.6); implementation uses H1 `34px`, H2 `25px`, and desktop main padding `32px 40px 64px`. These are small but concrete deviations. [spec](C:/Projects/docstube/knowledge/design/theme-spec-docstube.md:785), [CSS](C:/Projects/docstube/packages/theme/src/themes/docstube/site/styles/global.css:343)

- **DEFECT — code geometry differs from the exact block grammar.** The spec calls for `12px`, `1.85`, and `12px 16px 16px` (§2.4); emitted fences and components use `13.5px/1.75`, with `14px 16px 16px` or `10px 16px 16px`. Production scaling is justified, but the differing line-height and top padding are not recorded as an adaptation. [spec](C:/Projects/docstube/knowledge/design/theme-spec-docstube.md:463), [CSS](C:/Projects/docstube/packages/theme/src/themes/docstube/site/styles/global.css:520), [CSS](C:/Projects/docstube/packages/theme/src/themes/docstube/site/styles/global.css:609)

- **DEFECT — sidebar typography drifts upward.** Exact mock values are 12.5px nav and 10px group labels (§1.4/§2.3); implementation uses 13.5px and 11px. Production widening is documented, but this typography change is not. [spec](C:/Projects/docstube/knowledge/design/theme-spec-docstube.md:216), [CSS](C:/Projects/docstube/packages/theme/src/themes/docstube/site/styles/global.css:279)

- **DEFECT — TOC supports only H2/H3.** The spec extension requires arbitrary nesting (§4.3), but the layout queries only `h2[id], h3[id]`. H4+ sections disappear entirely. [spec](C:/Projects/docstube/knowledge/design/theme-spec-docstube.md:760), [layout](C:/Projects/docstube/packages/theme/src/themes/docstube/site/layouts/DocLayout.astro:369)

- **DEFECT — tabs are mouse-only.** Buttons have tab roles and `aria-selected`, but no `tablist`, `aria-controls`, roving tabindex, or Arrow/Home/End keyboard behavior. The generic `Tabs` rail does not even switch associated content in the layout script. [layout](C:/Projects/docstube/packages/theme/src/themes/docstube/site/layouts/DocLayout.astro:249)

- **DEFECT — modal focus management is incomplete.** Search focuses its input and closes with Escape, but it has no focus trap, no restoration to the opener, and background content is not inert. Those are explicitly required by the accessibility/mobile extensions. [spec](C:/Projects/docstube/knowledge/design/theme-spec-docstube.md:804), [layout](C:/Projects/docstube/packages/theme/src/themes/docstube/site/layouts/DocLayout.astro:311)

- **DEFECT — status colors fail AA when used as small text on white.** `proven #15a06b` is approximately **3.35:1**, `flagged #c2790b` **3.48:1**, and `danger #d6584f` **3.91:1** against white. The badges are 11px/600, so all three fail the 4.5:1 normal-text threshold. `scored/accent #0a818b` passes narrowly at **4.64:1**. [spec](C:/Projects/docstube/knowledge/design/theme-spec-docstube.md:513), [CSS](C:/Projects/docstube/packages/theme/src/themes/docstube/site/styles/global.css:26)

- **DOCUMENTED ADAPTATION — Vitesse Light approximation.** Dark Plus reproduces the specified dark syntax roles; Vitesse Light is explicitly described as the closest built-in approximation to the custom light palette. Execution is coherent, with code backgrounds overridden to theme surfaces. [manifest](C:/Projects/docstube/packages/theme/src/themes/docstube/theme.ts:14)

- **DOCUMENTED ADAPTATION — production-scaled shell.** The original 222/fluid/188px mock is intentionally promoted to 248/fluid/216px with a 760px measure, consistent with the spec’s recommendation to widen production rails. [spec](C:/Projects/docstube/knowledge/design/theme-spec-docstube.md:738), [CSS](C:/Projects/docstube/packages/theme/src/themes/docstube/site/styles/global.css:42)

- **Faithful areas:** exact light/dark surfaces, three font families, self-hosting, theme persistence, teal identity, active sidebar fill/bar combination, bent 1.5/2.5px TOC rail, code-group pill treatment, mobile drawer, wide-table scrolling, visible focus, reduced-motion override, and contextual guarantee/source primitives are all present. [CSS](C:/Projects/docstube/packages/theme/src/themes/docstube/site/styles/global.css:8), [layout](C:/Projects/docstube/packages/theme/src/themes/docstube/site/layouts/DocLayout.astro:369)

- **Emitted-site fidelity:** the checked-in [global.css](C:/Projects/docstube/docs-site/src/styles/global.css:1) and [DocLayout.astro](C:/Projects/docstube/docs-site/src/layouts/DocLayout.astro:1) are byte-equivalent to the theme sources reviewed, so the live source carries the same strengths and defects; there is no separate emitted drift.

### Quality risks

- Long titles wrap safely in the article, but the header brand is nowrap and the right-side controls have no wrapping. Version + locale + theme controls can collide at intermediate widths before the mobile breakpoint.
- The mobile drawer locks body scrolling but does not trap focus, close on Escape, or return focus to its trigger.
- Search has the same focus-containment issue and may allow keyboard users to tab into obscured page content.
- CodeGroup tab buttons are created client-side, causing a short unlabeled/empty chrome state before hydration; without JS, all code panels remain visible and there are no tab controls.
- Copy success is visual only: the icon and color change, but there is no live-region announcement.
- TOC appears only with at least two headings, leaving a one-heading page without an “On this page” affordance; defensible, but inconsistent.
- Wide native tables are handled correctly with horizontal scrolling. Code blocks also scroll rather than force page width.
- Light body contrast passes comfortably: `#33484a` on white is about **9.69:1**, muted `#5d7173` about **5.15:1**, and accent `#0a818b` about **4.64:1**. Dark muted `#8c9594` on `#161c1c` is about **5.62:1** and dark accent about **7.61:1**.
- Fonts are complete for declared weights and use swap, but only Latin/Latin Extended subsets are present; locales needing Cyrillic, Greek, Arabic, or CJK will fall back per glyph and visibly mix typefaces.

### Verdict

**Ship-with-fixes.**

Ranked fixes:

1. Darken light-theme proven/flag/danger status text to AA-compliant variants while retaining the specified colors for borders/icons/background accents.
2. Implement proper search-modal and mobile-drawer focus trapping/restoration.
3. Make Tabs and CodeGroup fully keyboard-accessible.
4. Generalize the bent TOC to H2–H6/arbitrary depth.
5. Resolve intermediate-width header collisions.
6. Either align code/title/sidebar values exactly or explicitly record their production-scale adaptations in the manifest/conformance contract.
