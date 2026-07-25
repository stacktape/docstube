---
"docstube": patch
---

Wave 2b close. STATIC LITERAL PROPS CANNOT REACH A PROTOTYPE. An object key named `__proto__` does
not add a member — it replaces the decoded object's prototype, so `Object.entries()` skipped it, the
recursive markup/event-handler/kernel-namespace scan never saw the strings underneath, and shard
serialization dropped them: `<Tabs tabs={[{"__proto__": {label: "<img>", value: "npm"}}]} />` passed
submission and the component's props schema while carrying content nothing had checked. The decoder
now refuses the keys `__proto__`, `constructor` and `prototype` outright with an error naming the
exact member (`tabs[0].__proto__`), refuses those same names as PROP names, and builds every decoded
object with a null prototype so no assignment can reach a prototype chain at all. The kernel's
extractor applies the identical rule, so extraction of foreign MDX can never persist a prop the
submission gate would have rejected.

HEAD-MOVEMENT WARNINGS SAY WHAT WAS OBSERVED at both ends of the run. The warning took a single
"started dirty" boolean, which produced contradictions: a run that started clean and ended dirty
still claimed the mid-run commit "left the tree clean", and a run whose start state was UNKNOWN —
`git status` never ran — was relabeled "ALREADY dirty" as soon as HEAD became readable, sending an
operator to look for a diff nobody had observed. The warning now takes the start tri-state and the
end state and words each combination for what git actually reported. Trust behavior is unchanged:
HEAD movement marks the run either way.
