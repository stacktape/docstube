---
'docstube': patch
---

Structured components (`Steps`, `Tabs`, `FileTree`, `ParamTable`, `ComparisonTable`, `CardGrid`)
are authorable again: component props may be static literal data, not only string literals.

- **The regression.** The literal-props-only element policy accepted string-literal and valueless
  boolean attributes and rejected every expression value as `dynamic-attribute`. Six registered
  components declare array, object, or numeric props, which JSX can only spell as an expression
  (`items={[…]}`, `columns={3}`) — so they were advertised to the writer in the prompt and in the
  `submit_page` descriptor while every authored use was rejected. The writer could only hit a
  repair loop and stop using them, quietly degrading pages.
- **The rule now.** An expression-valued prop is accepted only when the WHOLE of it is static
  literal data: strings, numbers, booleans, `null`, arrays and objects, nested freely. Anything
  else — identifiers (`undefined` included), property access, calls, template literals, JSX,
  spreads, operators (so `-1` is not authorable; write `"-1"`), comments, more than one statement —
  is still rejected as `dynamic-attribute`, with a message naming what was found. Validation walks
  the expression's real parse tree, which MDX already attaches to the document, so the kernel reads
  exactly the value the renderer will receive; an unreadable expression fails closed.
- **Every prohibition applies recursively.** Strings anywhere inside literal data face the same
  markup rule as a string prop, and object keys face the event-handler and `dt-` / `data-docstube*`
  namespace rules that guard prop names — a literal cannot smuggle markup or counterfeit proof
  chrome through a nested value.
- **Extraction decodes the same value.** Component block metadata now carries the decoded literal
  instead of raw expression text, so structured props validate against the component's registered
  props schema during verification instead of always failing it.
- The writer prompt and the `submit_page` descriptor teach the accepted shape with an example, and
  a regression guard asserts every registered component is authorable end to end.
