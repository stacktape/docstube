import type { Root } from 'mdast';
import type { MdxJsxAttribute, MdxJsxExpressionAttribute } from 'mdast-util-mdx-jsx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { z } from 'zod';
import { bindCitedValue, canonicalMdxSource, claimMarkerIdSchema, writerClaimLedgerSchema } from '@docstube/contracts';
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
  // AST-derived RENDERED text content of the marker (impl-07 finding 1): text and inline-code
  // values, link/image labels — never link URLs, JSX attributes, or {…} expressions. Value
  // binding proves the asserted scalar against THIS, so a value hidden in an href cannot bind.
  visibleText: string;
  // PURE-MARKER FLAG (wave 2b close final — the render-laundering class): true only when the
  // marker's AST content consists EXCLUSIVELY of `text` and `inlineCode` nodes — the only node
  // kinds whose rendered output provably equals their scanned text — AND the marker has NO JSX
  // ANCESTOR. Anything else inside (images, links, footnote references, emphasis/strong, html,
  // breaks — any node kind, known or not) makes the marker non-pure, and so does sitting anywhere
  // inside a component (<Badge label="…"><Claim>…</Claim></Badge>): the component's renderer owns
  // whether/how the Claim slot renders, so the kernel cannot prove rendered ≡ scanned. Legal MDX,
  // repair-free — but the claim can NEVER be canonically checkable. Fail-closed by structure, no
  // enumeration.
  pureText: boolean;
};

// Typed scan errors: the kernel (anchor-ledger) classifies placement errors as repair-eligible and
// grammar errors post-acceptance as kernel invariant breaches; validateSubmission renders every
// code as a repair instruction for the model.
export type MarkerScanErrorCode =
  | 'mdx-parse-error'
  | 'marker-flow'
  | 'marker-in-heading'
  | 'marker-in-expression'
  | 'marker-expression'
  | 'marker-jsx'
  | 'marker-missing-id'
  | 'marker-invalid-id'
  | 'marker-attribute'
  | 'marker-duplicate-attribute'
  | 'marker-empty'
  | 'marker-nested'
  | 'page-script';

export type MarkerScanError = { code: MarkerScanErrorCode; message: string; markerId?: string };

export type MarkerScan = {
  markers: ClaimMarker[];
  errors: MarkerScanError[];
};

// Same plugin set as the kernel's extraction parser (core extract-entities.ts) so marker positions
// agree byte-for-byte with block source ranges.
const markerProcessor = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkFrontmatter, ['yaml']);

// Script/style TAG match for raw-html and expression sources (wave 2b close): the tag name must
// END at whitespace, '/', or '>' — a custom element like <style-guide> is legal MDX, never a
// page-script hit. Computed construction (e.g. createElement('script')) is pathological-input
// territory: deliberate self-forging is out of scope per ARCHITECTURE §4.4.
const scriptStyleTagPattern = /<\s*\/?\s*(?:script|style)(?=[\s/>])/iu;

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
  alt?: unknown;
  children?: unknown[];
  attributes?: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};

// Rendered text content of an inline subtree: what the reader actually SEES. Link and image
// destinations, JSX attributes, and MDX expressions contribute nothing; inline code and image alt
// text are visible and contribute their value.
const visibleTextOf = (node: ScanNode): string => {
  if (node.type === 'text' || node.type === 'inlineCode') {
    return typeof node.value === 'string' ? node.value : '';
  }
  if (node.type === 'image' || node.type === 'imageReference') {
    return typeof node.alt === 'string' ? node.alt : '';
  }
  if (node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression' || node.type === 'html') {
    return '';
  }
  if (node.type === 'break') {
    return ' ';
  }
  return ((node.children ?? []) as ScanNode[]).map(visibleTextOf).join('');
};

// A marker containing ANY MDX expression node is invalid (wave 2b close final): {'never '}
// renders text the reader sees but the kernel's visible-text extraction cannot — the exact
// laundering channel the exact canonical visible match exists to close.
const containsMdxExpression = (node: ScanNode): boolean =>
  node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression'
    ? true
    : ((node.children ?? []) as ScanNode[]).some(containsMdxExpression);

// A marker containing ANY JSX element is invalid outright (wave 2b close final): a component
// renders arbitrary content — <Badge label="greet does not exist.">greet exists.</Badge> can
// render its prop text, the opposite of its scanned children — so no scan of the children can
// vouch for what the reader sees. Same treatment as MDX expressions: repair error in-session,
// kernel-invariant breach post-acceptance.
// Nested <Claim> elements are excluded ONLY because they carry their own precise error
// ('marker-nested', reported by the visitor) — they are still rejected, just with the right code.
const containsJsxElement = (node: ScanNode): boolean =>
  (node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement') && node.name !== 'Claim'
    ? true
    : ((node.children ?? []) as ScanNode[]).some(containsJsxElement);

// The only node kinds whose rendered output provably equals their scanned text. Both are leaves,
// so checking the marker's direct children fully determines subtree purity; every other kind —
// including kinds that do not exist yet — fails closed into pureText: false.
const isPureTextNode = (node: ScanNode): boolean => node.type === 'text' || node.type === 'inlineCode';

// AST-based scan for inline <Claim id="…">…</Claim> markers. Only an mdxJsxTextElement in
// translatable content is a marker: literal <Claim> text inside fenced/inline code is plain text
// (a docs example never counts), flow-level Claim elements and markers inside headings or JSX
// expressions are precise repair errors — formatting must never change claim or block semantics.
export const scanClaimMarkers = (mdx: string): MarkerScan => {
  const markers: ClaimMarker[] = [];
  const errors: MarkerScanError[] = [];
  // CANONICAL SOURCE, NOT RAW BYTES (wave 2b close): remark only recognizes a frontmatter block
  // that starts at offset 0, so a page whose `---` is preceded by a blank line or a BOM parsed as a
  // thematic break plus a setext heading — a SYNTHETIC section made of the `title:` text that
  // emission then strips as frontmatter. Every offset below (marker offsets, inner-MDX slices) is
  // taken against the shared canonical source, which is exactly the text emission splits.
  const source = canonicalMdxSource(mdx);
  let tree: Root;
  try {
    tree = markerProcessor.parse(source) as Root;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push({
      code: 'mdx-parse-error',
      message: `the MDX does not parse: ${detail} — fix the syntax (unclosed or stray tags are the usual cause) and resubmit the complete page`
    });
    return { markers, errors };
  }

  const collectClaim = (node: ScanNode, context: { inHeading: boolean; inClaim: boolean; inJsx: boolean }): void => {
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
    // DUPLICATE ATTRIBUTES (wave 2b close — Sol's two-id probe): JSX parsing accepts repeated
    // attribute names, but the scanner reads the FIRST value while JSX rendering uses the LAST —
    // <Claim id="a" id="b"> would attach the trust mark for claim "a" to the element rendered as
    // "b". Any repeated attribute name is rejected before id resolution, so a marker's identity
    // is never ambiguous. Post-acceptance this classifies as a kernel invariant breach, exactly
    // like the other non-repairable scan codes.
    const attributeNames = (node.attributes ?? []).flatMap((attribute) =>
      attribute.type === 'mdxJsxAttribute' ? [attribute.name] : []
    );
    const duplicatedNames = [
      ...new Set(attributeNames.filter((name, index) => attributeNames.indexOf(name) !== index))
    ];
    if (duplicatedNames.length > 0) {
      errors.push({
        code: 'marker-duplicate-attribute',
        message:
          `<Claim> at offset ${offset} repeats the attribute${duplicatedNames.length === 1 ? '' : 's'} ` +
          `${duplicatedNames.map((name) => `"${name}"`).join(', ')} — duplicate attributes make the marker's ` +
          'rendered identity ambiguous (the renderer uses the last value, the scanner must not guess); write ' +
          'exactly one id attribute and resubmit'
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
    // ATTRIBUTE WHITELIST (wave 2b close final — Sol's set:text probe): a marker may carry ONLY
    // the id attribute. Astro renderer directives (set:text, set:html) REPLACE the rendered
    // children with attribute text the kernel never scanned — <Claim id="g1" set:text="greet does
    // not exist.">greet exists.</Claim> renders the opposite of its checked assertion. Whitelist,
    // not blacklist: any unknown attribute (including {...spreads}) is rejected outright.
    const extraAttributes = (node.attributes ?? []).filter(
      (attribute) => !(attribute.type === 'mdxJsxAttribute' && attribute.name === 'id')
    );
    if (extraAttributes.length > 0) {
      const names = extraAttributes
        .map((attribute) => (attribute.type === 'mdxJsxAttribute' ? `"${attribute.name}"` : 'a {…} spread'))
        .join(', ');
      errors.push({
        code: 'marker-attribute',
        markerId,
        message:
          `marker "${markerId}" carries ${names} — <Claim> accepts only the id attribute; renderer ` +
          'directives or props could replace the rendered prose with text the kernel never checked; remove ' +
          'every attribute except id and resubmit'
      });
      return;
    }
    const children = (node.children ?? []) as ScanNode[];
    if (children.some(containsMdxExpression)) {
      errors.push({
        code: 'marker-expression',
        markerId,
        message:
          `marker "${markerId}" contains an MDX expression ({…}) — expressions render text the kernel cannot ` +
          'see, so the visible assertion and the checked assertion could differ; write the prose literally ' +
          'inside the marker and resubmit'
      });
      return;
    }
    if (children.some(containsJsxElement)) {
      errors.push({
        code: 'marker-jsx',
        markerId,
        message:
          `marker "${markerId}" contains a JSX element — a component renders arbitrary content (its props, not ` +
          'its children), so the visible assertion and the checked assertion could differ; write the asserted ' +
          'prose literally inside the marker, move the component outside it, and resubmit'
      });
      return;
    }
    const contentStart = children[0]?.position?.start?.offset;
    const contentEnd = children[children.length - 1]?.position?.end?.offset;
    const innerMdx =
      contentStart === undefined || contentEnd === undefined ? '' : source.slice(contentStart, contentEnd);
    if (innerMdx.trim() === '') {
      errors.push({
        code: 'marker-empty',
        markerId,
        message: `marker "${markerId}" wraps no prose — a marker must wrap the asserted sentence text: <Claim id="${markerId}">text</Claim>, never be empty or self-closing`
      });
    }
    markers.push({
      markerId,
      offset,
      innerMdx,
      visibleText: children.map(visibleTextOf).join(''),
      // NO-JSX-ANCESTOR (wave 2b close final, Sol's ancestor-component laundering): a marker
      // inside ANY JSX element is never pure — the ancestor component decides what actually
      // renders, so the scanned text cannot vouch for what the reader sees.
      pureText: !context.inJsx && children.every(isPureTextNode)
    });
  };

  const visit = (node: ScanNode, context: { inHeading: boolean; inClaim: boolean; inJsx: boolean }): void => {
    // Code fences, inline code, and frontmatter are literal text: a <Claim> written there is a
    // documentation example, never a marker — and a <script> shown there is example code, never
    // an element (the returns below keep the page-script check off literal text too).
    if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'yaml') {
      return;
    }
    // RAW SCRIPT/STYLE PROHIBITION ('page-script', wave 2b close): a sibling <script> can rewrite
    // verified claim text after rendering and a <style> can hide or replace it visually — the
    // theme owns page behavior and styling. Case-insensitive, element and raw-html forms both.
    if (
      (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
      typeof node.name === 'string' &&
      (node.name.toLowerCase() === 'script' || node.name.toLowerCase() === 'style')
    ) {
      errors.push({
        code: 'page-script',
        message:
          `the page contains a raw <${node.name}> element at offset ${node.position?.start?.offset ?? 0} — ` +
          'generated pages must not carry executable or style elements; the theme owns page behavior and ' +
          'styling. Remove the element (a code FENCE showing example markup is fine) and resubmit'
      });
      return;
    }
    if (node.type === 'html' && typeof node.value === 'string' && scriptStyleTagPattern.test(node.value)) {
      errors.push({
        code: 'page-script',
        message:
          `the page contains raw HTML with a <script>/<style> tag at offset ${node.position?.start?.offset ?? 0} — ` +
          'generated pages must not carry executable or style elements; the theme owns page behavior and ' +
          'styling. Remove the raw HTML (a code FENCE showing example markup is fine) and resubmit'
      });
      return;
    }
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
      // Expression-wrapped script/style ({<script>…</script>}) compiles and executes exactly like
      // the raw element — the {…} wrapper must not launder it past the page-script prohibition.
      // Tag match (<script, <style) on the expression source, never a word match: a string like
      // 'the script ran' stays legal prose.
      if (typeof node.value === 'string' && scriptStyleTagPattern.test(node.value)) {
        errors.push({
          code: 'page-script',
          message:
            `the page contains a JSX expression with a <script>/<style> tag at offset ${node.position?.start?.offset ?? 0} — ` +
            'generated pages must not carry executable or style elements; the theme owns page behavior and ' +
            'styling. Remove the expression (a code FENCE showing example markup is fine) and resubmit'
        });
        return;
      }
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
    } else if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      // Any non-Claim JSX element makes every descendant marker JSX-ancestored (accepted, but
      // permanently non-pure — collectClaim threads the flag). Claims inside components stay
      // legal, repair-free MDX; they just can never be canonically checkable.
      childContext = { ...context, inJsx: true };
    } else if (node.type === 'heading') {
      childContext = { ...context, inHeading: true };
    }
    for (const child of node.children ?? []) {
      visit(child as ScanNode, childContext);
    }
  };

  for (const node of tree.children) {
    visit(node as ScanNode, { inHeading: false, inClaim: false, inJsx: false });
  }
  return { markers, errors };
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
    // VALUE ASSERTION BINDING (deterministic, in-session — impl-07 finding 1): a value claim's
    // asserted citedValue must be provably present in BOTH the AST-derived VISIBLE marker text
    // (rendered prose — link URLs and attributes excluded) AND the claim's atomic predicate, with
    // one unambiguous numeric candidate and no explicit negation. Either-side occurrence let a
    // writer wrap wrong prose while smuggling the correct value through the ledger; the shared
    // contracts helper enforces the identical rule here and in claim verification.
    const markerById = new Map(scan.markers.map((marker) => [marker.markerId, marker]));
    for (const claim of ledgerParse.data.claims) {
      const marker = markerById.get(claim.markerId);
      if (marker === undefined) {
        continue; // already reported as a missing marker above
      }
      for (const subscription of claim.proposedSubscriptions) {
        if (subscription.kind !== 'cited-value') {
          continue;
        }
        const binding = bindCitedValue(subscription.citedValue, {
          markerText: marker.visibleText,
          predicate: claim.predicate
        });
        for (const issue of binding.issues) {
          errors.push(
            `claim "${claim.markerId}" (cited-value "${subscription.valueName}"): ${issue.message}. ` +
              'Fix the wrapped prose (or the citedValue/predicate, if the prose is right) so they agree, and resubmit'
          );
        }
      }
    }
    // NOTE: the covers= fence-meta grammar (behavior execution coverage) was REMOVED with the
    // wave 2b scope correction — behavior claims stay honestly unchecked until the v1.x predicate
    // verifiers (trust-model-v2 decision 3); snippet execution proves code EXAMPLES run.
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
