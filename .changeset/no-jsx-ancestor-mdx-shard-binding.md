---
'docstube': patch
---

Two fail-closed trust hardenings close wave 2b. (1) NO-JSX-ANCESTOR checkability: a `<Claim>` marker sitting anywhere inside an MDX component (e.g. `<Badge label="…"><Claim>…</Claim></Badge>`) is legal, repair-free MDX but is never canonically checkable — the component's renderer owns whether/how the claim slot renders, so no scan can prove rendered ≡ scanned; such claims ship honestly UNCHECKED, never checked. The writer prompt now teaches that checkable claims live in plain paragraphs and list items, never inside components. (2) MDX↔shard binding hash: page shards record `mdxContentHash`, the content hash of the exact persisted MDX artifact, minted at persistence; site emission verifies the MDX file it reads against the recorded hash and renders any mismatching page (post-persistence edit) or pre-hash shard in the loud UNVERIFIED state with a printed warning — stale trust state never accompanies changed prose.
