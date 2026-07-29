---
"docstube": patch
---

Shell code fences now opt IN to snippet execution instead of opting out. Execution evidence is only meaningful for a self-contained sample: a `js`/`ts` snippet in documentation usually is one, so those still run by default and still opt out with `no-exec`. A `bash`/`sh` block usually is not — it is a command the reader runs in their own environment, depending on prior steps, network, or repo state the verifier does not have — so it is no longer executed unless its fence meta carries `exec`, and a non-executed fence produces no finding and claims no execution evidence. An `exec`-marked shell fence runs exactly as before, and its failure is a real finding. Non-executed shell fences are still linted by the `shellcheck` verifier. The writer prompt now states the rule, including never marking a command that invokes docstube itself.
