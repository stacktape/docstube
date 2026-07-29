---
'docstube': patch
---

Far more claims now verify, and unbindable subjects no longer cost a retry.

- A claim whose visible prose does not name the code symbol its evidence points at (documenting
  `docstube generate` while the implementation is called `runGenerateCommand`) no longer fails the
  page. The kernel drops the evidence proposal and the claim ships honestly `unchecked` with a
  journaled note — it refuses to vouch, not to publish. Pages stop burning writer retries on
  correct documentation that spells a public name.
- Value claims are verified even when the writer had no symbol hash to cite. Anchoring now reads
  the value path out of the claim's own assertion (`configFileNames.config is docstube.yml`),
  resolves it against the run's fingerprint snapshot, and subscribes the real cited value instead
  of falling back to a whole-file dependency — so these claims become genuinely checked, or
  contradicted when the docs are wrong. The writer's own valid proposal still wins, and an
  unresolvable or non-literal assertion keeps the conservative fallback.
