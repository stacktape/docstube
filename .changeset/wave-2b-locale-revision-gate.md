---
'docstube': patch
---

i18n trust hardening (wave 2b close): translation hygiene now requires the exact source marker
SEQUENCE (a swapped or relocated `<Claim>` id fails the translation instead of attaching canonical
marks to the wrong prose) and an identical heading inventory; locale routes serve their translated
MDX only while the locale shard's recorded canonical revision matches the current source page —
after a source-only change (e.g. `docstube refine`, or a crashed retranslation) the route serves
the fresh source content with a not-yet-translated notice and a staleness warning; locale section
chips now reference the translated document's own heading anchors instead of the source anchors.
