import { normalizeElementPolicy } from '@docstube/agent-runtime';
import type { ElementPolicy } from '@docstube/agent-runtime';

// THE AUTHORED-ELEMENT WHITELIST, resolved in core (the kernel owns the registry) and handed to
// agent-runtime's submit_page validator when a write-page task's tool is constructed.
//
// `config.components` is the project's enabled component set, and every entry is a registered
// component — one block type each in entities/block-registry.ts, with its own props schema. It is
// exactly the list the writer prompt advertises (write-page.ts), so prompt and validator stay in
// lockstep: what the writer is told it may use is precisely what submit_page accepts. Anything
// else — raw HTML, unregistered components, fragments — is refused, and with no policy at all the
// validator falls back to <Claim> only.
//
// ONE SCHEMA, BOTH ENDS (wave 2b close final): the policy is built here and consumed by the
// validator in agent-runtime — in this process AND, as JSON, in the spawned MCP child. Both ends
// normalize through elementPolicySchema, so a config whose `components` is not the array the
// contract promises (a hand-edited docstube.yml, a plugin returning a string) degrades to
// Claim-only here exactly as it would in the child, instead of throwing or spreading a string into
// a per-character allow-list.
export const configElementPolicy = (config: { components: readonly string[] }): ElementPolicy =>
  normalizeElementPolicy({ allowedComponents: config.components }) ?? { allowedComponents: [] };
