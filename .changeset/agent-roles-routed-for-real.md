---
'docstube': minor
---

`agents.roles` now actually routes. It was parsed and validated but never read — configuring a
cheaper model for reviews silently did nothing. Every model task declares a role (writer,
reviewer, translator, architect, extractor) and `agents.roles.<role>` overrides that role's
`transport`, `model`, or both; an unset role inherits the top-level `agents.transport` /
`agents.model`, which inherits the transport's own default model. One override moves exactly that
role's tasks — the writer keeps running on the run default.

The old `agents.reviewModel` shortcut is REMOVED: `agents.roles.reviewer` says the same thing and
can also move the reviewer to a different provider, which is what reviewer independence actually
requires. Replace `agents.reviewModel: X` with:

```yaml
agents:
  roles:
    reviewer:
      model: X
```

Supporting changes: the CI preflight (`docstube doctor --ci`) now resolves and checks the
credential for EVERY provider a run could use, so a key that only the translator's provider needs
fails before any spend instead of mid-run; `agents.apiKeyEnv` / `agents.baseUrl` are no longer
handed to a role that switched to a different transport; run spend and the task journal events
carry the role, and the CLI prints a per-role spend breakdown plus any active role overrides.
