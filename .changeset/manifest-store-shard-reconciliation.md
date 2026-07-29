---
'docstube': patch
---

The manifest store now keeps the recorded index and the shard files on disk in agreement, in both
directions. Recording an index RECONCILES the committed shard tree against it: every file under
`.docstube/manifest/pages/<locale>/` that the index does not reference is removed and reported by
name in the run journal, so a crashed or re-planned run leaves no orphan behind and a superseded
serialization (a `pg_*.yml` sitting beside the current `pg_*.json` shards, or a root `manifest.yml`
next to `manifest.json`) cleans itself up on the next successful run. The prune is scoped strictly
to files the store itself owns — a page-id-shaped name in a shard directory — so nothing else under
`.docstube/` and no file a human put there is ever touched, and frozen `versions/<label>/` snapshots
stay untouched as the immutable history they are. Reading the manifest now REFUSES an index that
claims pages whose source-locale shard is missing or unparseable, naming every such page and the
remedy (`docstube generate`), because publishing or reasoning from a half-present manifest is
exactly the recorded-state-disagrees-with-reality failure docstube exists to prevent. Absence of a
manifest is still an ordinary first run, and `generate`/`maintain` — the reconcilers that repair
this state — still read a broken index so they can fix it, and no longer carry an index entry whose
shard is gone.
