import { z } from 'zod';
import { claimMarkerIdSchema, writerClaimLedgerSchema } from '@docstube/contracts';
import type { ToolDescriptor, WriterClaimLedger } from '@docstube/contracts';
import type { ToolImplementation } from './tools.ts';

// The writer submission tool (ARCHITECTURE §4.1/§8.1): the write-page task delivers MDX plus the
// writer claim ledger in ONE submit_page call. Validation runs in-session and returns PRECISE
// repair errors instead of hard failure — the model fixes the listed problems and calls
// submit_page again. A task with output type 'mdx-ledger' completes successfully only through an
// accepted call: the harness reads the accepted artifact back via the tool's taskResult provider.

export type ClaimMarker = {
  markerId: string;
  // MDX offset of the opening tag — the anchor the kernel maps to the owning block.
  offset: number;
  // Raw MDX between the opening and closing tag.
  innerMdx: string;
};

export type MarkerScan = {
  markers: ClaimMarker[];
  errors: string[];
};

const OPEN_OR_CLOSE_TAG = /<Claim\b([^>]*?)(\/?)>|<\/Claim\s*>/g;

const markerIdOf = (attrs: string): string | undefined => {
  const match = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
  return match?.[1] ?? match?.[2];
};

// Deterministic scan for inline <Claim id="…">…</Claim> markers. Regex + a one-slot stack instead
// of a full MDX parse: the marker grammar is deliberately flat (no nesting, no self-closing), so
// malformed markers get exact, repairable messages rather than parser noise.
export const scanClaimMarkers = (mdx: string): MarkerScan => {
  const markers: ClaimMarker[] = [];
  const errors: string[] = [];
  let open: { markerId: string; offset: number; contentStart: number } | undefined;
  for (const match of mdx.matchAll(OPEN_OR_CLOSE_TAG)) {
    const [full, attrs, selfClosing] = match;
    if (full.startsWith('</')) {
      if (open === undefined) {
        errors.push(`stray </Claim> at offset ${match.index} — no matching <Claim id="…"> opening tag`);
        continue;
      }
      markers.push({
        markerId: open.markerId,
        offset: open.offset,
        innerMdx: mdx.slice(open.contentStart, match.index)
      });
      open = undefined;
      continue;
    }
    if (selfClosing === '/') {
      errors.push(
        `self-closing <Claim/> at offset ${match.index} — a marker must wrap the asserted prose: <Claim id="…">text</Claim>`
      );
      continue;
    }
    const markerId = markerIdOf(attrs ?? '');
    if (markerId === undefined) {
      errors.push(`<Claim> at offset ${match.index} has no id attribute — write <Claim id="…">`);
      continue;
    }
    if (!claimMarkerIdSchema.safeParse(markerId).success) {
      errors.push(`<Claim id="${markerId}"> is not a valid marker id — use letters, digits, "_" or "-"`);
      continue;
    }
    if (open !== undefined) {
      errors.push(
        `<Claim id="${markerId}"> at offset ${match.index} opens inside <Claim id="${open.markerId}"> — markers must not nest`
      );
      continue;
    }
    open = { markerId, offset: match.index, contentStart: match.index + full.length };
  }
  if (open !== undefined) {
    errors.push(`<Claim id="${open.markerId}"> is never closed — add </Claim> after the asserted prose`);
  }
  return { markers, errors };
};

const submitPageArgsSchema = z.object({
  mdx: z.string().min(1, 'mdx must be the complete non-empty page source'),
  ledger: z.unknown()
});

export const submitPageDescriptor: ToolDescriptor = {
  name: 'submit_page',
  description:
    'Submit the finished page: the complete MDX (with inline <Claim id="…">…</Claim> markers) plus the claim ' +
    'ledger. The submission is validated; on errors, fix exactly what is listed and call submit_page again with the ' +
    'full corrected page. The task result is your last accepted submission.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      mdx: {
        type: 'string',
        description: 'The complete page MDX, including frontmatter and every inline <Claim id="…"> marker.'
      },
      ledger: {
        type: 'object',
        description:
          'The writer claim ledger: { schemaVersion: 1, claims: [{ markerId, class, predicate, proposedEvidence, ' +
          'proposedSubscriptions }] } — one entry per <Claim> marker in the MDX.',
        properties: {
          schemaVersion: { type: 'integer', const: 1 },
          claims: { type: 'array', items: { type: 'object' } }
        },
        required: ['schemaVersion', 'claims']
      }
    },
    required: ['mdx', 'ledger']
  }
};

// Kernel-owned claim fields the writer must never emit; named explicitly so the repair error says
// what happened instead of a generic "unrecognized key".
const KERNEL_OWNED_FIELDS = new Set([
  'claimId',
  'anchor',
  'scope',
  'evidence',
  'correctness',
  'disposition',
  'decidingEvidenceId',
  'subscriptions'
]);

const ledgerIssueMessage = (issue: z.core.$ZodIssue): string => {
  const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
  if (issue.code === 'unrecognized_keys') {
    const kernelKeys = issue.keys.filter((key) => KERNEL_OWNED_FIELDS.has(key));
    if (kernelKeys.length > 0) {
      return (
        `ledger ${path}: field(s) ${kernelKeys.map((key) => `"${key}"`).join(', ')} are kernel-owned and must not ` +
        'appear in writer output — emit only markerId, class, predicate, proposedEvidence, proposedSubscriptions'
      );
    }
  }
  return `ledger ${path}: ${issue.message}`;
};

export type AcceptedSubmission = { mdx: string; ledger: WriterClaimLedger };

// Every problem in one pass, phrased as an instruction the model can act on directly.
export const validateSubmission = (args: unknown): { accepted: AcceptedSubmission | undefined; errors: string[] } => {
  const shape = submitPageArgsSchema.safeParse(args ?? {});
  if (!shape.success) {
    return {
      accepted: undefined,
      errors: shape.error.issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    };
  }
  const errors: string[] = [];
  const ledgerParse = writerClaimLedgerSchema.safeParse(shape.data.ledger);
  if (!ledgerParse.success) {
    errors.push(...ledgerParse.error.issues.map(ledgerIssueMessage));
  }
  const scan = scanClaimMarkers(shape.data.mdx);
  errors.push(...scan.errors);

  const markerCounts = new Map<string, number>();
  for (const marker of scan.markers) {
    markerCounts.set(marker.markerId, (markerCounts.get(marker.markerId) ?? 0) + 1);
  }
  for (const [markerId, count] of markerCounts) {
    if (count > 1) {
      errors.push(
        `marker "${markerId}" appears ${count} times in the MDX — every marker id is unique; renumber the duplicates`
      );
    }
  }
  for (const marker of scan.markers) {
    if (marker.innerMdx.trim() === '') {
      errors.push(`marker "${marker.markerId}" wraps no prose — the marker must wrap the asserted sentence text`);
    }
  }
  if (ledgerParse.success) {
    const ledgerIds = new Set(ledgerParse.data.claims.map((claim) => claim.markerId));
    for (const claim of ledgerParse.data.claims) {
      if (!markerCounts.has(claim.markerId)) {
        errors.push(
          `ledger claim "${claim.markerId}" has no <Claim id="${claim.markerId}"> marker in the MDX — wrap the ` +
            'asserted prose with the marker or remove the ledger entry'
        );
      }
    }
    for (const markerId of markerCounts.keys()) {
      if (!ledgerIds.has(markerId)) {
        errors.push(
          `marker "${markerId}" has no ledger entry — add a claim with markerId "${markerId}" or remove the marker`
        );
      }
    }
  }
  if (errors.length > 0 || !ledgerParse.success) {
    return { accepted: undefined, errors };
  }
  return { accepted: { mdx: shape.data.mdx, ledger: ledgerParse.data }, errors: [] };
};

export type SubmitPageTool = {
  tool: ToolImplementation;
  accepted: () => AcceptedSubmission | undefined;
};

export const createSubmitPageTool = (): SubmitPageTool => {
  let accepted: AcceptedSubmission | undefined;
  return {
    tool: {
      descriptor: submitPageDescriptor,
      handler: async (args) => {
        const outcome = validateSubmission(args);
        if (outcome.accepted === undefined) {
          return {
            accepted: false,
            errors: outcome.errors,
            note: 'Submission rejected. Fix every listed error and call submit_page again with the complete corrected page and ledger.'
          };
        }
        // Last accepted submission wins — a re-call intentionally replaces the artifact.
        accepted = outcome.accepted;
        return {
          accepted: true,
          note: 'Page accepted. You are done — do not call submit_page again unless you need to replace the submission.'
        };
      },
      taskResult: () => (accepted === undefined ? undefined : { type: 'mdx-ledger', ...accepted })
    },
    accepted: () => accepted
  };
};
