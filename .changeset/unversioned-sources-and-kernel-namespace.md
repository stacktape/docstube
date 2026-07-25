---
'docstube': minor
---

Unversioned sources count as uncommitted, and the kernel now owns its presentation namespace.

- `git status` never reports ignored files, so a run that parsed or read an untracked or ignored
  source file used to be labeled against a commit that never contained those bytes while the tree
  reported clean. Generate, maintain, and refine now resolve trackedness over the bounded set the
  run actually consumed — parsed symbol files, whole-file fingerprint fallbacks, and the writer's
  observed reads — with a single `git ls-files` call, and set the same `dirtyWorkingTree` marker
  when any of them is unversioned. The run warning names the offending files; docstube's own
  outputs are excluded, so a normal run never self-marks.
- The local review UI threads that flag into its section and block rollups: on a dirty page no chip
  at any level shows the complete/green treatment, while every level keeps its true counts.
- `submit_page` rejects event-handler attributes (`onerror`, `onError`, and handlers embedded in an
  attribute value such as `set:html`) under the existing page-script prohibition — a handler is
  executable page behavior even with no `<script>` tag present.
- `submit_page` also rejects authored elements in docstube's own presentation namespace: the `dt-`
  class/id prefix and any `data-docstube*` attribute belong to the kernel proof components, so page
  MDX can no longer counterfeit a "complete" claims chip or other verification chrome.
