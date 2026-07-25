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
  | 'page-script'
  | 'kernel-namespace'
  | 'raw-html-element'
  | 'unregistered-component'
  | 'dynamic-attribute'
  | 'markup-attribute'
  | 'mdx-expression'
  | 'mdx-esm';

export type MarkerScanError = { code: MarkerScanErrorCode; message: string; markerId?: string };

export type MarkerScan = {
  markers: ClaimMarker[];
  errors: MarkerScanError[];
};

// AUTHORED ELEMENTS ARE A WHITELIST (wave 2b close — the deny-list collapse): the earlier scans
// looked for spreads, raw markup, and expression attributes by REGEX over source text, so
// uppercase names (ONERROR, CLASS), a quoted '>' inside markup, {...spread} objects, and
// expression-valued attributes all walked through. A deny-list over arbitrary source cannot be
// won, so the policy is structural and fail-closed instead: an element may appear in submitted MDX
// only when the kernel's component registry knows its name, and every attribute must be a plain
// string literal so its name and value read straight off the AST. Everything the old regexes tried
// to catch is then either impossible (raw HTML, spreads, expressions) or a one-line AST name check.
//
// The registry lives in core (entities/block-registry.ts: one block type per registered
// component); core passes the enabled names in when it constructs the task's submit_page tool. NO
// POLICY MEANS CLAIM ONLY — a missing whitelist must never widen what is accepted.
//
// ONE SCHEMA, VALIDATED AT BOTH ENDS (wave 2b close final — Sol's malformed-policy probe): the
// policy is plain JSON that crosses a process boundary (the parent writes it into the MCP child's
// descriptors file), so it is UNTRUSTED input on both sides. An unvalidated parent policy either
// threw (`allowedComponents: 42` is not spreadable) or silently degraded (`allowedComponents: 'Bad'`
// spread into a character allow-list, admitting <B>, <a>, <d>), and the child normalized through
// this schema while the parent did not — the two ends could accept different pages. STRICT object:
// an unknown key means the value was not built by configElementPolicy, and a policy shape the
// kernel does not recognize must never widen what is accepted.
export const elementPolicySchema = z.strictObject({
  allowedComponents: z.array(z.string().min(1)).default([])
});
export type ElementPolicy = z.infer<typeof elementPolicySchema>;

// The single normalization every consumer runs — parent tool construction, every validation entry
// point, and the MCP child's rebuild. Anything that fails validation degrades to undefined, which
// means CLAIM-ONLY; never a throw, never a partial allow-list.
export const normalizeElementPolicy = (policy: unknown): ElementPolicy | undefined => {
  const parsed = elementPolicySchema.safeParse(policy);
  return parsed.success ? parsed.data : undefined;
};

// The inline claim marker is claim VOCABULARY, not a theme component (it is deliberately absent
// from the block registry), so it is allowed unconditionally and validated by its own far stricter
// rules below (id-only attribute whitelist, no nesting, no expressions, no JSX).
export const CLAIM_ELEMENT_NAME = 'Claim';

const allowedElementNames = (policy: unknown): Set<string> =>
  new Set([CLAIM_ELEMENT_NAME, ...(normalizeElementPolicy(policy)?.allowedComponents ?? [])]);

const renderAllowedComponents = (allowed: ReadonlySet<string>): string => {
  const names = [...allowed].filter((name) => name !== CLAIM_ELEMENT_NAME);
  return names.length === 0
    ? 'this project enables no components at all, so plain Markdown is the only option'
    : `the components you may use are ${names.map((name) => `<${name}>`).join(', ')}`;
};

// The JSX rule MDX and React both use: a name starting with a lowercase letter is an INTRINSIC
// element (raw HTML) rather than a component reference. Dashed custom elements start lowercase too.
const isIntrinsicElementName = (name: string): boolean => /^[a-z]/u.test(name);

// A raw-HTML `html` node carries a tag when it opens an element or closes one. MDX normally parses
// markup into JSX nodes, so this is defense in depth for anything remark still hands back as html.
const rawHtmlTagPattern = /<\s*\/?\s*[a-zA-Z]/u;

// Same plugin set as the kernel's extraction parser (core extract-entities.ts) so marker positions
// agree byte-for-byte with block source ranges.
const markerProcessor = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkFrontmatter, ['yaml']);

// Script/style TAG match for raw-html and expression sources (wave 2b close): the tag name must
// END at whitespace, '/', or '>' — a custom element like <style-guide> is legal MDX, never a
// page-script hit. Computed construction (e.g. createElement('script')) is pathological-input
// territory: deliberate self-forging is out of scope per ARCHITECTURE §4.4.
const scriptStyleTagPattern = /<\s*\/?\s*(?:script|style)(?=[\s/>])/iu;

// SCRIPT/STYLE INSIDE ATTRIBUTE VALUES (wave 2b close final — Sol's set:html probe): the element
// and expression scans below read tag names and expression source, but never what an attribute
// CARRIES. `<div set:html="<script>…</script>">` is an ordinary element with an ordinary string
// attribute, so it walked straight through — and its markup executes at render time, able to
// rewrite the very claim text the ledger vouches for. Attribute values are scanned with the SAME
// tag regex, in every spelling: a string literal value, an expression value ({…}), and a
// {...spread}. Returns the attribute's name (for the error message) or undefined.
const attributeValueMatching = (
  attributes: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>,
  pattern: RegExp
): string | undefined => {
  const carries = (value: unknown): boolean => typeof value === 'string' && pattern.test(value);
  for (const attribute of attributes) {
    if (attribute.type === 'mdxJsxExpressionAttribute') {
      if (carries(attribute.value)) {
        return 'a {…} spread';
      }
      continue;
    }
    const value = attribute.value;
    // A string literal value, or the expression source of `attr={…}` (mdxJsxAttributeValueExpression).
    if (carries(value) || (value !== null && typeof value === 'object' && carries(value.value))) {
      return `the "${attribute.name}" attribute`;
    }
  }
  return undefined;
};

// EVENT-HANDLER ATTRIBUTES (wave 2b close final — Sol's <img onerror> probe): a <script>/<style>
// TAG is not the only way to run code on a rendered page. `<img src="x" onerror="…">` contains no
// tag at all, and neither does a handler smuggled inside a set:html value — both execute at render
// time and can rewrite the very claim text the ledger vouches for. Reported under the SAME
// page-script code: the prohibition is identical (the theme owns page behavior), only the spelling
// of the payload differs.
//
// SHAPE, NOT ENUMERATION: `on` + an UPPERCASE letter is the JSX/React handler spelling (onError,
// onClick); `on` + three-or-more letters is the HTML content-attribute spelling (onerror, oncut,
// onbeforetoggle) — including handlers the HTML spec has not shipped yet, and including the
// SHOUTED spelling HTML also honours (ONERROR). A name where "on" merely begins a word ("once",
// "only") leaves a remainder shorter than any event type and stays legal.
//
// Defense in depth since the registered-components whitelist landed: raw HTML cannot be authored
// at all, so this now only guards a handler-shaped prop on a REGISTERED component.
const eventHandlerNamePattern = /^(?:on[A-Z]|[oO][nN][a-zA-Z]{3,})/u;

// The same handler shape spelled INSIDE an attribute value, where it is executable only as part of
// MARKUP: a tag whose attribute list carries a handler. Prose that merely mentions the word
// "onerror" carries no tag and stays legal.
//
// THE SAME SHAPE RULE, CASE-INSENSITIVELY (wave 2b close final — Sol's ONERROR-in-a-prop probe):
// this pattern used to read `on` case-SENSITIVELY, so `set:html="<img onError=…>"`, `ONERROR=` and
// `OnError=` walked past while the identical name written directly on the element was caught. HTML
// honours every spelling, so the name shape here is exactly eventHandlerNamePattern's.
const markupEventHandlerPattern = /<[a-zA-Z][^>]*?\s(?:on[A-Z]|[oO][nN][a-zA-Z]{3,})\s*=/u;

// TAG-SHAPED CONTENT IN A STRING PROP ('markup-attribute', wave 2b close final — Sol's
// tokenizer probe): the two patterns above read attribute VALUES with regexes over HTML, and a
// regex over HTML cannot be made tokenizer-safe. `<img title='>' ONERROR=alert(1)>` ends the tag
// early for any `[^>]*` while a browser keeps parsing attributes; `<img/onError=…>` needs no
// whitespace before the handler at all; and every patch invites the next spelling — the same
// deny-list collapse the element whitelist already refused to keep fighting.
//
// So shrink the surface here too: a component prop carries PLAIN TEXT. Markup belongs in Markdown
// (which the theme renders) or in a code fence (which is documentation). A string-valued attribute
// whose value contains a tag-open shape is refused outright, and there is nothing left to tokenize.
//
// THE BOUNDARY IS `<` IMMEDIATELY FOLLOWED BY AN ASCII LETTER OR `/` — precisely the two shapes
// that open or close an HTML/JSX tag. A `<` followed by anything else — a space, a digit, `=`, `!`,
// or the end of the value — is an ordinary less-than sign and stays legal: "a < b", "n < 5", "<= 3",
// "latency < 5ms". "a <b" does not, and that is the documented cost of the rule.
//
// ASSUMPTION, CHECKED AGAINST THE THEME: no registered component renders a prop VALUE as HTML.
// Every built-in prop in packages/theme/src/components.ts is a string/enum/number/array-of-strings
// rendered as escaped text, and the only `set:html` in any theme bundle is Callout.astro's
// kernel-owned icon SVG, selected by the validated `tone` enum and never by authored text. A
// component that ever rendered a prop as HTML would make this rule load-bearing rather than
// belt-and-braces — the two must be kept in lockstep.
const tagOpenShapePattern = /<[a-zA-Z/]/u;

const eventHandlerAttributeName = (
  attributes: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>
): string | undefined => {
  for (const attribute of attributes) {
    if (attribute.type === 'mdxJsxAttribute' && eventHandlerNamePattern.test(attribute.name)) {
      return attribute.name;
    }
  }
  return undefined;
};

// KERNEL-OWNED PRESENTATION NAMESPACE (wave 2b close final — Sol's counterfeit-chip probe): the
// proof primitives in packages/theme/src/proof-source.ts render the entire trust surface with
// `dt-`-prefixed classes and ids (dt-claims, dt-claims--complete, dt-claim, dt-claim-mark,
// dt-contradictions, dt-sources, dt-section-chip, dt-uncommitted, dt-search, dt-contradicted-claims
// …) and `data-docstube-*` attributes (data-docstube-claims-complete, data-docstube-claim,
// data-docstube-dirty-working-tree …). Writer MDX that authors an element in that namespace paints
// proof chrome the kernel never issued — a green "complete" chip the component's defensive
// recompute never gets a chance to correct, because the counterfeit is not the component. Same
// principle as the kernel-owned frontmatter and ledger keys: docstube owns the names, so the
// submission is rejected with a repair error naming the offending attribute.
//
// LOCKSTEP: these two prefixes and the class/attribute names the primitives emit in
// packages/theme/src/proof-source.ts must change together — a kernel class outside `dt-`, or a
// kernel data attribute outside `data-docstube`, needs an entry here in the same commit.
const KERNEL_CLASS_PREFIX = 'dt-';
const KERNEL_DATA_ATTRIBUTE_PREFIX = 'data-docstube';

// The same namespace spelled inside raw HTML or an expression's source text.
const kernelNamespaceMarkupPattern = /data-docstube|(?:class|id)\s*=\s*["'][^"']*\bdt-/iu;

const attributeStringValue = (attribute: MdxJsxAttribute): string | undefined => {
  const value = attribute.value;
  if (typeof value === 'string') {
    return value;
  }
  return value !== null && typeof value === 'object' && typeof value.value === 'string' ? value.value : undefined;
};

const kernelOwnedAttribute = (attributes: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>): string | undefined => {
  for (const attribute of attributes) {
    if (attribute.type === 'mdxJsxExpressionAttribute') {
      // A {...spread} can carry any name; its source text is all the kernel can read.
      if (typeof attribute.value === 'string' && kernelNamespaceMarkupPattern.test(attribute.value)) {
        return "a {…} spread naming docstube's presentation namespace";
      }
      continue;
    }
    if (attribute.name.toLowerCase().startsWith(KERNEL_DATA_ATTRIBUTE_PREFIX)) {
      return `the "${attribute.name}" attribute`;
    }
    // Attribute names are compared case-INSENSITIVELY: HTML honours CLASS and ID, and a component
    // prop spelled ClassName is the same channel (the earlier exact-case list missed both).
    const lowerName = attribute.name.toLowerCase();
    if (lowerName === 'class' || lowerName === 'classname' || lowerName === 'id') {
      const value = attributeStringValue(attribute);
      const owned = (value ?? '').split(/[\s'"`]+/u).find((token) => token.startsWith(KERNEL_CLASS_PREFIX));
      if (owned !== undefined) {
        return `the "${attribute.name}" attribute with the kernel-owned value "${owned}"`;
      }
    }
  }
  return undefined;
};

// STATIC JSON-LITERAL PROPS ('dynamic-attribute', wave 2b close — the structured-component
// regression): the literal-props-only rule refused EVERY expression value, but five registered
// components (Steps, Tabs, FileTree, ParamTable, ComparisonTable) declare array/object props that
// JSX can only spell as an expression — items={[…]}. They were advertised to the writer in the
// prompt AND in this tool's descriptor while every use was rejected, so the writer hit a
// guaranteed repair loop and would quietly stop using them, degrading every page that wanted a
// step list or a parameter table.
//
// The rule that restores them without reopening the dynamic-value hole: an expression value is
// accepted ONLY when the WHOLE of it is JSON data — strings, numbers, booleans, null, arrays and
// objects, nested freely. Nothing else: no identifier (`undefined` is one), no property access,
// no call, no template literal, no JSX, no spread, no operator, no comment, no second statement.
// A value that is entirely literal data reads off the AST exactly as the renderer will see it,
// which is the whole property the string-literal rule existed to preserve.
//
// OPERATORS STAY OUT, INCLUDING UNARY MINUS: `-1` parses as a UnaryExpression, not a literal, and
// admitting one operator is the first step of the deny-list collapse the element whitelist already
// refused to keep fighting. The documented cost: a negative number in a ComparisonTable cell is
// written as the string "-1".
//
// THE ESTREE ROUTE, NOT A TEXT PARSE: remark-mdx already attaches acorn's parse of every attribute
// expression at `value.data.estree`, so this walks the REAL parse tree of the exact bytes MDX will
// compile, and every node kind must be Literal / ArrayExpression / ObjectExpression or the value
// is refused. Re-parsing the source text with JSON.parse would first need JS source normalized
// into JSON (unquoted keys, single quotes, trailing commas), and any gap in that normalization is
// a value the kernel reads differently from the renderer — exactly the divergence the policy
// exists to prevent. A missing or unreadable estree fails closed.
export type StaticLiteral = string | number | boolean | null | StaticLiteral[] | { [key: string]: StaticLiteral };
export type StaticLiteralResult = { ok: true; value: StaticLiteral } | { ok: false; reason: string };

type EstreeNode = { type?: unknown; [key: string]: unknown };

const asEstreeNode = (node: unknown): EstreeNode | undefined =>
  node !== null && typeof node === 'object' ? (node as EstreeNode) : undefined;

// Names the writer will recognize for the thing it actually wrote.
const describeExpressionNode = (type: unknown): string => {
  switch (type) {
    case 'Identifier':
      return 'a name (an identifier such as a variable, or `undefined`)';
    case 'MemberExpression':
      return 'a property access';
    case 'CallExpression':
    case 'NewExpression':
      return 'a function call';
    case 'TemplateLiteral':
    case 'TaggedTemplateExpression':
      return 'a template literal';
    case 'JSXElement':
    case 'JSXFragment':
      return 'JSX';
    case 'SpreadElement':
      return 'a spread (...)';
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return 'a function';
    case 'UnaryExpression':
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'ConditionalExpression':
    case 'AssignmentExpression':
    case 'SequenceExpression':
    case 'UpdateExpression':
      return 'an operator expression';
    case 'AwaitExpression':
    case 'YieldExpression':
      return 'a suspended expression';
    default:
      return typeof type === 'string' ? `a ${type}` : 'an unreadable expression';
  }
};

// PROTOTYPE-MUTATING KEYS ARE NOT PROP NAMES (wave 2b close — the pathological-input finding).
// `value.__proto__ = {…}` does not add a member: it REPLACES the decoded object's prototype, so
// `Object.entries()` never yields it, the recursive markup/handler/kernel-namespace scan never sees
// the strings underneath, and shard serialization drops them — `<Tabs tabs={[{"__proto__": {label:
// "<img>", value: "npm"}}]} />` used to pass submission AND the Tabs schema with the smuggled
// markup invisible to both. `constructor` and `prototype` are the same class of reach-through.
// Rejected OUTRIGHT (they are never legitimate component prop names) rather than skipped, so the
// writer is told what happened instead of silently losing data; the decoded objects additionally
// carry a NULL PROTOTYPE, so no assignment in this decoder can reach a prototype chain at all.
const prototypeMutatingKeys = new Set(['__proto__', 'constructor', 'prototype']);

// Shared with the kernel's extractor so both ends of the contract refuse the SAME names.
export const isPrototypeMutatingName = (name: string): boolean => prototypeMutatingKeys.has(name);

const literalFromEstree = (node: unknown, path: string): StaticLiteralResult => {
  const estree = asEstreeNode(node);
  if (estree === undefined) {
    return { ok: false, reason: 'an unreadable expression' };
  }
  if (estree.type === 'Literal') {
    // A regex or bigint literal is a Literal node whose VALUE is not JSON data; both carry their
    // own marker property, and both are refused by the value check below anyway.
    if ('regex' in estree || 'bigint' in estree) {
      return { ok: false, reason: 'a regular-expression or bigint literal' };
    }
    const value = estree.value;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      return { ok: true, value };
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: 'a non-finite number' };
    }
    return { ok: false, reason: 'a literal that is not JSON data' };
  }
  if (estree.type === 'ArrayExpression') {
    const elements = Array.isArray(estree.elements) ? estree.elements : [];
    const values: StaticLiteral[] = [];
    for (const element of elements) {
      // A hole ([1, , 2]) is a null element — not a value the kernel can read.
      if (element === null || element === undefined) {
        return { ok: false, reason: 'an array hole ([1, , 2])' };
      }
      const item = literalFromEstree(element, `${path}[${values.length}]`);
      if (!item.ok) {
        return item;
      }
      values.push(item.value);
    }
    return { ok: true, value: values };
  }
  if (estree.type === 'ObjectExpression') {
    const properties = Array.isArray(estree.properties) ? estree.properties : [];
    const value = Object.create(null) as Record<string, StaticLiteral>;
    for (const rawProperty of properties) {
      const property = asEstreeNode(rawProperty);
      if (property === undefined) {
        return { ok: false, reason: 'an unreadable object member' };
      }
      if (property.type !== 'Property' || property.kind !== 'init' || property.method === true) {
        return {
          ok: false,
          reason: describeExpressionNode(property.type === 'Property' ? 'FunctionExpression' : property.type)
        };
      }
      if (property.computed === true) {
        return { ok: false, reason: 'a computed object key ({[k]: v})' };
      }
      const key = asEstreeNode(property.key);
      const name =
        key?.type === 'Identifier' && typeof key.name === 'string'
          ? key.name
          : key?.type === 'Literal' && (typeof key.value === 'string' || typeof key.value === 'number')
            ? String(key.value)
            : undefined;
      if (name === undefined) {
        return { ok: false, reason: 'an object key that is not a plain name' };
      }
      if (prototypeMutatingKeys.has(name)) {
        return {
          ok: false,
          reason:
            `the prototype-mutating object key "${name}" at ${path}.${name} — writing it would replace the ` +
            "decoded value's prototype instead of adding a prop, hiding whatever it carries from every content " +
            'rule and from the manifest'
        };
      }
      const item = literalFromEstree(property.value, `${path}.${name}`);
      if (!item.ok) {
        return item;
      }
      value[name] = item.value;
    }
    return { ok: true, value };
  }
  return { ok: false, reason: describeExpressionNode(estree.type) };
};

// Reads an mdxJsxAttributeValueExpression (prop={…}) as static JSON data, or says why it is not.
// `path` names the prop the value belongs to so a refusal can point at the exact member — the
// caller passes the attribute name (both the submission gate and the kernel's extractor do).
export const readStaticJsonLiteral = (attributeValue: unknown, path = 'the prop'): StaticLiteralResult => {
  const node = asEstreeNode(attributeValue);
  const program = asEstreeNode(asEstreeNode(node?.data)?.estree);
  if (program === undefined || program.type !== 'Program') {
    return { ok: false, reason: 'an expression the kernel could not parse' };
  }
  // A comment can carry no runtime effect, but "no comments" is one fewer thing to reason about
  // and costs a writer nothing — documentation props do not need annotations.
  if (Array.isArray(program.comments) && program.comments.length > 0) {
    return { ok: false, reason: 'a comment' };
  }
  const body = Array.isArray(program.body) ? program.body : [];
  if (body.length !== 1) {
    return { ok: false, reason: body.length === 0 ? 'no value at all' : 'more than one statement' };
  }
  const statement = asEstreeNode(body[0]);
  if (statement?.type !== 'ExpressionStatement') {
    return { ok: false, reason: 'a statement rather than a value' };
  }
  return literalFromEstree(statement.expression, path);
};

// EVERY PROHIBITION APPLIES TO THE RESULT, RECURSIVELY: a literal must not smuggle in a nested
// string what a plain string prop could never carry. Strings anywhere in the structure face the
// same tag-shape rule as a string attribute value, and object KEYS are prop names one level down,
// so they face the handler-name and kernel-namespace rules that guard attribute names.
type LiteralContentIssue = { code: MarkerScanErrorCode; detail: string };

const literalContentIssues = (value: StaticLiteral, path: string): LiteralContentIssue[] => {
  if (typeof value === 'string') {
    return tagOpenShapePattern.test(value)
      ? [
          {
            code: 'markup-attribute',
            detail:
              `the literal value at ${path} contains markup (a "<" immediately followed by a letter or "/") — ` +
              'component props carry PLAIN TEXT, in nested literal data exactly as in a string prop'
          }
        ]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => literalContentIssues(item, `${path}[${index}]`));
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  const issues: LiteralContentIssue[] = [];
  for (const [key, member] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    if (eventHandlerNamePattern.test(key)) {
      issues.push({
        code: 'page-script',
        detail:
          `the literal key ${keyPath} is an event-handler name — a handler is executable page behavior wherever ` +
          'it is spelled, and the theme owns page behavior'
      });
    }
    if (key.toLowerCase().startsWith(KERNEL_DATA_ATTRIBUTE_PREFIX)) {
      issues.push({
        code: 'kernel-namespace',
        detail: `the literal key ${keyPath} is in docstube's own "${KERNEL_DATA_ATTRIBUTE_PREFIX}*" namespace`
      });
    }
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'class' || lowerKey === 'classname' || lowerKey === 'id') {
      const owned =
        typeof member === 'string'
          ? member.split(/[\s'"`]+/u).find((token) => token.startsWith(KERNEL_CLASS_PREFIX))
          : undefined;
      if (owned !== undefined) {
        issues.push({
          code: 'kernel-namespace',
          detail: `the literal key ${keyPath} carries the kernel-owned value "${owned}"`
        });
      }
    }
    if (tagOpenShapePattern.test(key)) {
      issues.push({
        code: 'markup-attribute',
        detail: `the literal key ${keyPath} contains markup (a "<" immediately followed by a letter or "/")`
      });
    }
    issues.push(...literalContentIssues(member, keyPath));
  }
  return issues;
};

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
export const scanClaimMarkers = (mdx: string, policy?: ElementPolicy): MarkerScan => {
  const markers: ClaimMarker[] = [];
  const errors: MarkerScanError[] = [];
  const allowed = allowedElementNames(policy);
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
    // NO IMPORTS OR EXPORTS IN A PAGE BODY ('mdx-esm', wave 2b close final — Sol's ESM probe): the
    // element whitelist walks ELEMENTS and the expression refusal walks {…} nodes, but MDX has a
    // THIRD executable node kind. `import`/`export` statements parse into one opaque `mdxjsEsm`
    // node, so neither gate ever saw them — and
    // `export default function Evil(){ return <script>…</script> }` is compiled by MDX into the
    // page's OWN rendered wrapper, executing markup the kernel never checked while producing no
    // element and no expression node to refuse.
    //
    // Same shrink-the-surface move as the whitelist and the expression rule: generated
    // documentation never needs an import or an export — the theme owns components and the kernel
    // injects the layout, the proof components and the frontmatter — so the whole node kind is
    // refused and there is nothing left to deny-list inside it.
    if (node.type === 'mdxjsEsm') {
      errors.push({
        code: 'mdx-esm',
        message:
          `the page contains an import/export statement at offset ${node.position?.start?.offset ?? 0} — generated ` +
          'pages carry NO ESM statements: an import pulls in code the kernel never checked, and an export (an ' +
          "`export default function …` most of all) is compiled into the page's own rendered wrapper, so it can " +
          'emit elements, scripts and text that were never part of the submission. The theme owns components and ' +
          'the site build provides the layout. Remove the statement (a code FENCE showing example imports is ' +
          'documentation and stays fine) and resubmit'
      });
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
    if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name !== CLAIM_ELEMENT_NAME) {
      const attributes = node.attributes ?? [];
      const elementName = node.name ?? 'element';
      const offset = node.position?.start?.offset ?? 0;
      // Same prohibition, applied to what the element's attributes carry — the element itself is
      // innocuous, its attribute value is the executable payload. Reported under the SAME
      // page-script code; the visit continues so one pass still lists every other problem.
      const carrier = attributeValueMatching(attributes, scriptStyleTagPattern);
      if (carrier !== undefined) {
        errors.push({
          code: 'page-script',
          message:
            `the page has ${carrier} of <${elementName}> carrying a <script>/<style> tag at offset ` +
            `${offset} — generated pages must not carry executable or style elements, ` +
            'in markup OR in attribute values; the theme owns page behavior and styling. Remove the markup from ' +
            'the attribute (a code FENCE showing example markup is fine) and resubmit'
        });
      }
      const handlerName = eventHandlerAttributeName(attributes);
      if (handlerName !== undefined) {
        errors.push({
          code: 'page-script',
          message:
            `<${elementName}> at offset ${offset} carries the "${handlerName}" event-handler attribute — an event ` +
            'handler is executable page behavior with no <script> tag in sight, and it can rewrite the very claim ' +
            'text the ledger vouches for; the theme owns page behavior. Remove the handler (a code FENCE showing ' +
            'example markup is fine) and resubmit'
        });
      }
      const handlerCarrier = attributeValueMatching(attributes, markupEventHandlerPattern);
      if (handlerCarrier !== undefined) {
        errors.push({
          code: 'page-script',
          message:
            `the page has ${handlerCarrier} of <${elementName}> carrying markup with an event handler at offset ` +
            `${offset} — a handler inside an attribute VALUE (set:html and friends) executes exactly like one ` +
            'written on the element; the theme owns page behavior. Remove the markup from the attribute (a code ' +
            'FENCE showing example markup is fine) and resubmit'
        });
      }
      const kernelName = kernelOwnedAttribute(attributes);
      if (kernelName !== undefined) {
        errors.push({
          code: 'kernel-namespace',
          message:
            `<${elementName}> at offset ${offset} carries ${kernelName} — the "${KERNEL_CLASS_PREFIX}" class/id ` +
            `prefix and every "${KERNEL_DATA_ATTRIBUTE_PREFIX}*" attribute are docstube's OWN presentation ` +
            'namespace: the kernel proof components render the claim chips, contradiction warnings and source ' +
            'footer with exactly those names, so an authored element using them would counterfeit verification ' +
            'chrome the kernel never issued. Rename it to your own class/attribute and resubmit'
        });
      }
      // REGISTERED COMPONENTS ONLY — the fail-closed structural rule that replaces the old
      // source-text scans. An authored element must be a component the kernel's registry knows.
      // Raw HTML is refused outright: the theme owns presentation, and an authored <div>/<span>/
      // <img> can restyle, hide, or overwrite verified prose whatever its attributes say.
      if (node.name === null || node.name === undefined) {
        errors.push({
          code: 'unregistered-component',
          message:
            `the page contains a JSX fragment (<>…</>) at offset ${offset} — only registered components may ` +
            `appear as elements in a generated page (${renderAllowedComponents(allowed)}). Remove the fragment and ` +
            'resubmit'
        });
      } else if (isIntrinsicElementName(node.name)) {
        errors.push({
          code: 'raw-html-element',
          message:
            `the page authors the raw HTML element <${node.name}> at offset ${offset} — generated pages carry NO ` +
            'raw HTML: the theme owns presentation, and an authored element can restyle, hide, or overwrite the ' +
            'very prose the ledger vouches for. Use ordinary Markdown, or a registered component ' +
            `(${renderAllowedComponents(allowed)}), and resubmit (a code FENCE showing example markup is fine)`
        });
      } else if (!allowed.has(node.name)) {
        errors.push({
          code: 'unregistered-component',
          message:
            `<${node.name}> at offset ${offset} is not a registered component — a generated page may only use ` +
            `components the theme actually renders (${renderAllowedComponents(allowed)}). Replace it with plain ` +
            'Markdown or a registered component and resubmit'
        });
      }
      // STATICALLY ANALYZABLE ATTRIBUTES. With spreads and computed expression values refused,
      // every attribute name and value reads straight off the AST — which is exactly why no regex
      // over source text is needed to see what an element carries.
      for (const attribute of attributes) {
        if (attribute.type === 'mdxJsxExpressionAttribute') {
          errors.push({
            code: 'dynamic-attribute',
            message:
              `<${elementName}> at offset ${offset} carries a {…} spread attribute — a spread hides which props ` +
              'an element actually gets, so the kernel cannot tell prose formatting from executable behavior or ' +
              'counterfeit proof chrome. Write every prop out by name, as a plain string literal (prop="value") ' +
              'or as static literal data (prop={[…]}), and resubmit'
          });
          continue;
        }
        // The same rule the literal decoder applies one level down (prototypeMutatingKeys): a prop
        // NAME that mutates a prototype is not a prop either — the kernel's extractor stores props
        // by name into a metadata record, so the two levels must refuse exactly the same names.
        if (isPrototypeMutatingName(attribute.name)) {
          errors.push({
            code: 'dynamic-attribute',
            message:
              `<${elementName}> at offset ${offset} carries the prop name "${attribute.name}", which mutates an ` +
              'object prototype rather than naming a prop — no theme component declares it, and stored by name it ' +
              'would vanish from the manifest instead of being persisted. Rename the prop and resubmit'
          });
          continue;
        }
        if (attribute.value !== null && typeof attribute.value === 'object') {
          const literal = readStaticJsonLiteral(attribute.value, attribute.name);
          if (!literal.ok) {
            errors.push({
              code: 'dynamic-attribute',
              message:
                `<${elementName}> at offset ${offset} carries the expression-valued attribute ` +
                `${attribute.name}={…}, which contains ${literal.reason} — an expression value is accepted ONLY ` +
                'when the WHOLE of it is static literal data (strings, numbers, true/false, null, arrays and ' +
                'objects, nested freely). Anything else is computed when the page renders, so the kernel cannot ' +
                `read what the element actually gets. Write a text prop as ${attribute.name}="value", or a ` +
                `structured prop as literal data (${attribute.name}={[{ label: "npm", value: "npm" }]}), and resubmit`
            });
            continue;
          }
          for (const issue of literalContentIssues(literal.value, attribute.name)) {
            errors.push({
              code: issue.code,
              message:
                `<${elementName}> at offset ${offset} carries the "${attribute.name}" prop where ${issue.detail}. ` +
                'The rules that govern a string prop govern every string and key inside literal data too — write ' +
                'plain text (put markup you want to SHOW in a code fence), rename kernel-owned names, and resubmit'
            });
          }
          continue;
        }
        // PROPS CARRY PLAIN TEXT, NOT MARKUP (see tagOpenShapePattern): the script/style and
        // handler scans above stay as defense in depth, but THIS is the rule that holds — they
        // parse markup, this refuses that a prop value may look like markup at all.
        if (typeof attribute.value === 'string' && tagOpenShapePattern.test(attribute.value)) {
          errors.push({
            code: 'markup-attribute',
            message:
              `<${elementName}> at offset ${offset} carries the "${attribute.name}" attribute whose value contains ` +
              'markup (a "<" immediately followed by a letter or "/") — component props carry PLAIN TEXT only. ' +
              'Markup inside a prop value is what renderer directives execute, and no scan of an attribute string ' +
              'can tell prose from a tag reliably. Write the prop as plain text; if you meant to SHOW markup, put ' +
              'it in a code fence or `inline code`, and if you meant a less-than sign, leave a space after it ' +
              '("a < b") — then resubmit'
          });
        }
      }
    }
    if (node.type === 'html' && typeof node.value === 'string') {
      if (scriptStyleTagPattern.test(node.value)) {
        errors.push({
          code: 'page-script',
          message:
            `the page contains raw HTML with a <script>/<style> tag at offset ${node.position?.start?.offset ?? 0} — ` +
            'generated pages must not carry executable or style elements; the theme owns page behavior and ' +
            'styling. Remove the raw HTML (a code FENCE showing example markup is fine) and resubmit'
        });
        return;
      }
      if (markupEventHandlerPattern.test(node.value)) {
        errors.push({
          code: 'page-script',
          message:
            `the page contains raw HTML with an event handler at offset ${node.position?.start?.offset ?? 0} — ` +
            'generated pages must not carry executable page behavior; the theme owns it. Remove the raw HTML (a ' +
            'code FENCE showing example markup is fine) and resubmit'
        });
        return;
      }
      if (kernelNamespaceMarkupPattern.test(node.value)) {
        errors.push({
          code: 'kernel-namespace',
          message:
            `the page contains raw HTML in docstube's presentation namespace at offset ` +
            `${node.position?.start?.offset ?? 0} — the "${KERNEL_CLASS_PREFIX}" class/id prefix and every ` +
            `"${KERNEL_DATA_ATTRIBUTE_PREFIX}*" attribute belong to the kernel proof components, so authored ` +
            'markup using them would counterfeit verification chrome. Rename it to your own names and resubmit'
        });
        return;
      }
      // Any remaining raw-HTML node carrying a tag is refused for the same reason an intrinsic JSX
      // element is: the theme owns presentation, and no attribute deny-list can secure markup the
      // kernel only sees as text.
      if (rawHtmlTagPattern.test(node.value)) {
        errors.push({
          code: 'raw-html-element',
          message:
            `the page contains raw HTML at offset ${node.position?.start?.offset ?? 0} — generated pages carry NO ` +
            'raw HTML: the theme owns presentation, and authored markup can restyle, hide, or overwrite the very ' +
            `prose the ledger vouches for. Use ordinary Markdown, or a registered component ` +
            `(${renderAllowedComponents(allowed)}), and resubmit (a code FENCE showing example markup is fine)`
        });
        return;
      }
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
      // The {…} wrapper launders an event handler exactly as it launders a <script> tag.
      if (typeof node.value === 'string' && markupEventHandlerPattern.test(node.value)) {
        errors.push({
          code: 'page-script',
          message:
            `the page contains a JSX expression with an event handler at offset ${node.position?.start?.offset ?? 0} — ` +
            'generated pages must not carry executable page behavior; the theme owns it. Remove the expression (a ' +
            'code FENCE showing example markup is fine) and resubmit'
        });
        return;
      }
      if (typeof node.value === 'string' && kernelNamespaceMarkupPattern.test(node.value)) {
        errors.push({
          code: 'kernel-namespace',
          message:
            `the page contains a JSX expression in docstube's presentation namespace at offset ` +
            `${node.position?.start?.offset ?? 0} — the "${KERNEL_CLASS_PREFIX}" class/id prefix and every ` +
            `"${KERNEL_DATA_ATTRIBUTE_PREFIX}*" attribute belong to the kernel proof components; an expression ` +
            'emitting them would counterfeit verification chrome. Rename it to your own names and resubmit'
        });
        return;
      }
      if (typeof node.value === 'string' && node.value.includes('<Claim')) {
        errors.push({
          code: 'marker-in-expression',
          message: `a <Claim> marker sits inside a JSX expression at offset ${node.position?.start?.offset ?? 0} — markers must be plain inline MDX in the prose, never inside {…} expressions`
        });
        return;
      }
      // NO EXPRESSIONS IN A PAGE BODY (wave 2b close final — Sol's expression-wrapped-JSX probe):
      // the element whitelist walks ELEMENTS, but an expression's contents are one opaque source
      // string to mdast — `{<div>}`, `{<Sneaky/>}`, `{<>…</>}` and `{<Callout tone={x}/>}` all
      // compile to real elements while producing no element node the whitelist could refuse. The
      // same shrink-the-surface move the whitelist made for elements applies here: generated
      // documentation never needs an embedded expression, so the whole node kind is refused and
      // there is nothing left to deny-list inside it. The payload-specific codes above still fire
      // first, because a named cause repairs faster than a generic one.
      //
      // Inside a <Claim>, collectClaim already reported 'marker-expression' against the marker id —
      // the more precise message for the same prohibition, so this does not pile a second error on.
      if (context.inClaim) {
        return;
      }
      errors.push({
        code: 'mdx-expression',
        message:
          `the page contains an MDX expression ({…}) at offset ${node.position?.start?.offset ?? 0} — generated ` +
          'pages carry NO embedded expressions: an expression is evaluated at render time, so it can emit elements, ' +
          'props and text the kernel never saw when it checked the page. Write the literal text instead (a code ' +
          'FENCE or `inline code` containing braces is documentation and stays fine) and resubmit'
      });
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
    'ledger. The page may contain plain Markdown, <Claim> markers, and the registered components listed in your ' +
    'instructions — no raw HTML elements, no {…} expressions anywhere in the page, and no import/export statements. ' +
    'Every component prop is either a plain string literal carrying plain text (title="Setup") or, for a structured ' +
    'prop, STATIC literal data: strings, numbers, true/false, null, arrays and objects only, e.g. ' +
    '<Tabs tabs={[{ label: "npm", value: "npm" }]} />. No identifiers, calls, template literals, spreads, operators ' +
    'or expressions of any other kind, and no markup inside any value or key. The submission is validated; on ' +
    'errors, fix exactly what is listed and call ' +
    'submit_page again with the full corrected page. The task result is your last accepted submission.',
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
export const validateSubmission = (
  args: unknown,
  // Fail-closed: with no policy only <Claim> is a legal element (see elementPolicySchema).
  policy?: ElementPolicy
): { accepted: AcceptedSubmission | undefined; errors: string[] } => {
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
  const scan = scanClaimMarkers(shape.data.mdx, policy);
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
  args: unknown,
  policy?: ElementPolicy
): { response: SubmitPageResponse; accepted: AcceptedSubmission | undefined } => {
  const outcome = validateSubmission(args, policy);
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

export const createSubmitPageTool = (rawPolicy?: unknown): SubmitPageTool => {
  let accepted: AcceptedSubmission | undefined;
  // VALIDATED AT THE PARENT END TOO: the policy is normalized once, here, so a malformed one
  // degrades to Claim-only instead of throwing inside the scan — and the value that rides to the
  // MCP child is already the canonical shape the child re-validates.
  const policy = normalizeElementPolicy(rawPolicy);
  return {
    tool: {
      descriptor: submitPageDescriptor,
      // The policy rides on the tool because it must cross the MCP-child process boundary: the
      // child cannot receive the handler closure, but this is plain JSON and ships with the
      // descriptor (transports/forwarded-tools.ts), so in-session validation is identical there.
      ...(policy === undefined ? {} : { policy }),
      handler: async (args) => {
        const outcome = evaluateSubmitPageCall(args, policy);
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
