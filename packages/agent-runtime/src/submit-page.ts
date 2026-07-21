import type { Root } from 'mdast';
import type { MdxJsxAttribute, MdxJsxExpressionAttribute } from 'mdast-util-mdx-jsx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { z } from 'zod';
import { citedValueBindsToTexts, claimMarkerIdSchema, writerClaimLedgerSchema } from '@docstube/contracts';
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

// Typed scan errors: the kernel (anchor-ledger) classifies placement errors as repair-eligible and
// grammar errors post-acceptance as kernel invariant breaches; validateSubmission renders every
// code as a repair instruction for the model.
export type MarkerScanErrorCode =
  | 'mdx-parse-error'
  | 'marker-flow'
  | 'marker-in-heading'
  | 'marker-in-expression'
  | 'marker-missing-id'
  | 'marker-invalid-id'
  | 'marker-empty'
  | 'marker-nested';

export type MarkerScanError = { code: MarkerScanErrorCode; message: string; markerId?: string };

export type MarkerScan = {
  markers: ClaimMarker[];
  errors: MarkerScanError[];
};

// Same plugin set as the kernel's extraction parser (core extract-entities.ts) so marker positions
// agree byte-for-byte with block source ranges.
const markerProcessor = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkFrontmatter, ['yaml']);

const markerIdOf = (attributes: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>): string | undefined => {
  for (const attribute of attributes) {
    if (attribute.type === 'mdxJsxAttribute' && attribute.name === 'id' && typeof attribute.value === 'string') {
      return attribute.value;
    }
  }
  return undefined;
};

type ScanNode = {
  type?: string;
  name?: string | null;
  value?: unknown;
  children?: unknown[];
  attributes?: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};

// AST-based scan for inline <Claim id="…">…</Claim> markers. Only an mdxJsxTextElement in
// translatable content is a marker: literal <Claim> text inside fenced/inline code is plain text
// (a docs example never counts), flow-level Claim elements and markers inside headings or JSX
// expressions are precise repair errors — formatting must never change claim or block semantics.
export const scanClaimMarkers = (mdx: string): MarkerScan => {
  const markers: ClaimMarker[] = [];
  const errors: MarkerScanError[] = [];
  let tree: Root;
  try {
    tree = markerProcessor.parse(mdx) as Root;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push({
      code: 'mdx-parse-error',
      message: `the MDX does not parse: ${detail} — fix the syntax (unclosed or stray tags are the usual cause) and resubmit the complete page`
    });
    return { markers, errors };
  }

  const collectClaim = (node: ScanNode, context: { inHeading: boolean; inClaim: boolean }): void => {
    const offset = node.position?.start?.offset ?? 0;
    if (context.inHeading) {
      errors.push({
        code: 'marker-in-heading',
        message: `<Claim> at offset ${offset} sits inside a heading — headings cannot carry claims; move the marker into the body prose that states the fact`
      });
      return;
    }
    if (context.inClaim) {
      errors.push({
        code: 'marker-nested',
        message: `<Claim> at offset ${offset} opens inside another <Claim> — markers must not nest; split into separate sibling markers`
      });
      return;
    }
    const markerId = markerIdOf(node.attributes ?? []);
    if (markerId === undefined) {
      errors.push({
        code: 'marker-missing-id',
        message: `<Claim> at offset ${offset} has no id attribute — write <Claim id="…">`
      });
      return;
    }
    if (!claimMarkerIdSchema.safeParse(markerId).success) {
      errors.push({
        code: 'marker-invalid-id',
        markerId,
        message: `<Claim id="${markerId}"> is not a valid marker id — use letters, digits, "_" or "-"`
      });
      return;
    }
    const children = (node.children ?? []) as ScanNode[];
    const contentStart = children[0]?.position?.start?.offset;
    const contentEnd = children[children.length - 1]?.position?.end?.offset;
    const innerMdx = contentStart === undefined || contentEnd === undefined ? '' : mdx.slice(contentStart, contentEnd);
    if (innerMdx.trim() === '') {
      errors.push({
        code: 'marker-empty',
        markerId,
        message: `marker "${markerId}" wraps no prose — a marker must wrap the asserted sentence text: <Claim id="${markerId}">text</Claim>, never be empty or self-closing`
      });
    }
    markers.push({ markerId, offset, innerMdx });
  };

  const visit = (node: ScanNode, context: { inHeading: boolean; inClaim: boolean }): void => {
    // Code fences, inline code, and frontmatter are literal text: a <Claim> written there is a
    // documentation example, never a marker.
    if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'yaml') {
      return;
    }
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
      if (typeof node.value === 'string' && node.value.includes('<Claim')) {
        errors.push({
          code: 'marker-in-expression',
          message: `a <Claim> marker sits inside a JSX expression at offset ${node.position?.start?.offset ?? 0} — markers must be plain inline MDX in the prose, never inside {…} expressions`
        });
      }
      return;
    }
    let childContext = context;
    if (node.type === 'mdxJsxFlowElement' && node.name === 'Claim') {
      errors.push({
        code: 'marker-flow',
        message: `<Claim> at offset ${node.position?.start?.offset ?? 0} is a flow (block-level) element — write the marker inline inside the sentence, with the opening tag, the wrapped prose, and </Claim> all in the paragraph text`
      });
      childContext = { ...context, inClaim: true };
    } else if (node.type === 'mdxJsxTextElement' && node.name === 'Claim') {
      collectClaim(node, context);
      childContext = { ...context, inClaim: true };
    } else if (node.type === 'heading') {
      childContext = { ...context, inHeading: true };
    }
    for (const child of node.children ?? []) {
      visit(child as ScanNode, childContext);
    }
  };

  for (const node of tree.children) {
    visit(node as ScanNode, { inHeading: false, inClaim: false });
  }
  return { markers, errors };
};

// Execution-coverage declarations on code fences (impl-06 finding 2): a fence meta token
// `covers=<markerId>(,<markerId>)*` names the behavior claims this snippet exercises. Coverage is
// EXPLICIT — a passing snippet checks exactly the claims it declared; proximity mints nothing.
const COVERS_TOKEN = /(?:^|\s)covers=([^\s]+)/gu;
const NO_EXEC_TOKEN = /(?:^|\s)no-exec(?:\s|$)/u;

export type FenceCoverage = {
  // Marker ids declared by this fence's covers= token(s).
  markerIds: string[];
  meta: string;
  noExec: boolean;
};

// Collects covers= declarations from every fenced code block, using the same parser as the marker
// scan. Returns one entry per fence that declares coverage.
export const scanFenceCoverage = (mdx: string): FenceCoverage[] => {
  let tree: Root;
  try {
    tree = markerProcessor.parse(mdx) as Root;
  } catch {
    return [];
  }
  const coverage: FenceCoverage[] = [];
  const visit = (node: ScanNode): void => {
    if (node.type === 'code') {
      const meta = typeof (node as { meta?: unknown }).meta === 'string' ? (node as { meta: string }).meta : '';
      const markerIds = [...meta.matchAll(COVERS_TOKEN)].flatMap((match) =>
        (match[1] ?? '').split(',').filter((token) => token !== '')
      );
      if (markerIds.length > 0) {
        coverage.push({ markerIds, meta, noExec: NO_EXEC_TOKEN.test(meta) });
      }
      return;
    }
    for (const child of node.children ?? []) {
      visit(child as ScanNode);
    }
  };
  for (const node of tree.children) {
    visit(node as ScanNode);
  }
  return coverage;
};

const submitPageArgsSchema = z.object({
  mdx: z.string().min(1, 'mdx must be the complete non-empty page source'),
  ledger: z.unknown()
});

// The COMPLETE writer-ledger schema rides on the tool descriptor so vendor tool calling sees every
// claim field and proposal variant instead of an opaque `{type: object}` (avoidable rejection
// loops otherwise). Generated from the contract's Zod schema — never hand-maintained.
const writerLedgerJsonSchema = (): Record<string, unknown> => {
  const schema = z.toJSONSchema(writerClaimLedgerSchema, { io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  schema.description =
    'The writer claim ledger — exactly one entry per inline <Claim id="…"> marker in the MDX. Emit ONLY ' +
    'markerId, class, predicate, proposedEvidence, proposedSubscriptions; every other claim field is kernel-owned.';
  return schema;
};

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
      ledger: writerLedgerJsonSchema()
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
  errors.push(...scan.errors.map((error) => error.message));

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
    // VALUE ASSERTION BINDING (deterministic, in-session — impl-06 finding 1): a value claim's
    // asserted citedValue must be provably present in the VISIBLE marked prose or in the claim's
    // own predicate. Without this, a writer could wrap wrong prose while smuggling the correct
    // value through the ledger and the value verifier would launder it into 'checked'. Both sides
    // normalize through the ONE shared helper, so bare vs JSON-quoted string spellings agree.
    const markerTextById = new Map(scan.markers.map((marker) => [marker.markerId, marker.innerMdx]));
    for (const claim of ledgerParse.data.claims) {
      const markerText = markerTextById.get(claim.markerId);
      if (markerText === undefined) {
        continue; // already reported as a missing marker above
      }
      for (const subscription of claim.proposedSubscriptions) {
        if (subscription.kind !== 'cited-value') {
          continue;
        }
        if (!citedValueBindsToTexts(subscription.citedValue, [markerText, claim.predicate])) {
          errors.push(
            `claim "${claim.markerId}": the asserted value ${subscription.citedValue} (cited-value ` +
              `"${subscription.valueName}") appears in NEITHER the prose the marker wraps nor the predicate — ` +
              'the visible sentence must state the exact value the ledger asserts. Fix the wrapped prose ' +
              '(or the citedValue, if the prose is right) so they agree, and resubmit'
          );
        }
      }
    }
    // EXECUTION-COVERAGE declarations (in-session covers= validation): every declared marker must
    // be a real behavior claim on an executable fence — a typo'd or misdirected covers= would
    // otherwise silently cover nothing.
    const claimByMarkerId = new Map(ledgerParse.data.claims.map((claim) => [claim.markerId, claim]));
    for (const fence of scanFenceCoverage(shape.data.mdx)) {
      if (fence.noExec) {
        errors.push(
          `a code fence declares covers=${fence.markerIds.join(',')} together with no-exec — a snippet that never ` +
            'executes can cover nothing; drop the covers= declaration or make the snippet executable'
        );
      }
      for (const markerId of fence.markerIds) {
        if (!claimMarkerIdSchema.safeParse(markerId).success) {
          errors.push(
            `code fence covers= names "${markerId}", which is not a valid marker id — use comma-separated marker ` +
              'ids with no spaces: covers=c3,c5'
          );
          continue;
        }
        const covered = claimByMarkerId.get(markerId);
        if (covered === undefined) {
          errors.push(
            `code fence covers= names "${markerId}", but no ledger claim has that markerId — declare only markers ` +
              'that exist in this page'
          );
          continue;
        }
        if (covered.class !== 'behavior') {
          errors.push(
            `code fence covers= names "${markerId}" (class "${covered.class}") — covers= declares which BEHAVIOR ` +
              'claims the snippet exercises; other classes have their own checkers'
          );
        }
      }
    }
  }
  if (errors.length > 0 || !ledgerParse.success) {
    return { accepted: undefined, errors };
  }
  return { accepted: { mdx: shape.data.mdx, ledger: ledgerParse.data }, errors: [] };
};

export type SubmitPageResponse = {
  accepted: boolean;
  errors?: string[];
  note: string;
};

// The single evaluation used by BOTH the in-process handler and the MCP-child special case
// (transports/forwarded-tools.ts): what the model sees in-session is always the real validation
// outcome, on every transport.
export const evaluateSubmitPageCall = (
  args: unknown
): { response: SubmitPageResponse; accepted: AcceptedSubmission | undefined } => {
  const outcome = validateSubmission(args);
  if (outcome.accepted === undefined) {
    return {
      accepted: undefined,
      response: {
        accepted: false,
        errors: outcome.errors,
        note: 'Submission rejected. Fix every listed error and call submit_page again with the complete corrected page and ledger.'
      }
    };
  }
  return {
    accepted: outcome.accepted,
    response: {
      accepted: true,
      note: 'Page accepted. You are done — do not call submit_page again unless you need to replace the submission.'
    }
  };
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
        const outcome = evaluateSubmitPageCall(args);
        // Last accepted submission wins — a re-call intentionally replaces the artifact.
        if (outcome.accepted !== undefined) {
          accepted = outcome.accepted;
        }
        return outcome.response;
      },
      taskResult: () => (accepted === undefined ? undefined : { type: 'mdx-ledger', ...accepted })
    },
    accepted: () => accepted
  };
};
