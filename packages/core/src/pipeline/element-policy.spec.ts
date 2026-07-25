import { describe, expect, it } from 'vitest';
import { createSubmitPageTool, validateSubmission } from '@docstube/agent-runtime';
import { configElementPolicy } from './element-policy.ts';
import { buildWriterSystemPrompt } from './write-page.ts';
import type { WritePromptInput } from './write-page.ts';

// PROMPT AND GATE IN LOCKSTEP (wave 2b close): the writer is told exactly which components it may
// author, and submit_page accepts exactly that list — both read `config.components`, the project's
// enabled entries in the block-type registry (entities/block-registry.ts).

const promptInput = (components: string[]): WritePromptInput => ({
  config: {
    projectContext: 'A retry library.',
    site: { title: 'Retry' },
    personas: [{ id: 'dev', description: 'application developer' }],
    components
  } as unknown as WritePromptInput['config'],
  glossary: { schemaVersion: 1, terms: [] } as unknown as WritePromptInput['glossary'],
  codemap: { schemaVersion: 1, commit: 'a'.repeat(40), symbols: [] } as unknown as WritePromptInput['codemap'],
  node: {
    kind: 'page',
    title: 'Retry',
    slug: 'retry',
    brief: 'How retrying works.',
    depth: 'standard',
    primaryPersona: 'dev'
  } as unknown as WritePromptInput['node'],
  priorFindings: [],
  enabledComponents: components,
  instructions: [],
  knowledge: []
});

const mdxWith = (body: string): string => `---\ntitle: "Retry"\n---\n\n# Retry\n\n${body}\n`;
const emptyLedger = { schemaVersion: 1, claims: [] };

describe('configElementPolicy', () => {
  it('is the enabled component registry — and nothing else is authorable', () => {
    const policy = configElementPolicy({ components: ['Callout', 'Steps'] });
    expect(policy.allowedComponents).toEqual(['Callout', 'Steps']);

    const enabled = validateSubmission(
      { mdx: mdxWith('<Callout tone="info">Body.</Callout>'), ledger: emptyLedger },
      policy
    );
    expect(enabled.errors).toEqual([]);

    const notEnabled = validateSubmission({ mdx: mdxWith('<Badge>beta</Badge>'), ledger: emptyLedger }, policy);
    expect(notEnabled.errors.some((error) => error.includes('is not a registered component'))).toBe(true);

    const rawHtml = validateSubmission({ mdx: mdxWith('<div class="dt-claims">x</div>'), ledger: emptyLedger }, policy);
    expect(rawHtml.errors.some((error) => error.includes('the theme owns presentation'))).toBe(true);
  });

  it('fails closed on a project with no components: only <Claim> and plain Markdown', () => {
    const policy = configElementPolicy({ components: [] });
    expect(policy.allowedComponents).toEqual([]);
    const markdown = validateSubmission(
      { mdx: mdxWith('Plain **prose** with `code` and a [link](/docs).'), ledger: emptyLedger },
      policy
    );
    expect(markdown.errors).toEqual([]);
    const component = validateSubmission({ mdx: mdxWith('<Callout>Body.</Callout>'), ledger: emptyLedger }, policy);
    expect(component.errors.some((error) => error.includes('enables no components at all'))).toBe(true);
  });

  it('rides on the submit_page tool so the MCP child validates identically', () => {
    const policy = configElementPolicy({ components: ['Callout'] });
    expect(createSubmitPageTool(policy).tool.policy).toEqual(policy);
    expect(createSubmitPageTool().tool.policy).toBeUndefined();
  });

  it('fails closed on a components value that is not the array the contract promises', () => {
    // ONE SCHEMA, BOTH ENDS (wave 2b close final): the kernel builds the policy the validator
    // consumes, so a config the contract could not have produced — a hand-edited docstube.yml, a
    // plugin returning a string — must degrade to Claim-only HERE too, exactly as it would in the
    // MCP child, instead of throwing or spreading a string into a per-character allow-list.
    for (const components of ['Callout', 42, null, undefined, ['Callout', 7]]) {
      const policy = configElementPolicy({ components } as unknown as { components: readonly string[] });
      expect(policy).toEqual({ allowedComponents: [] });
      const scan = validateSubmission({ mdx: mdxWith('<Callout>Body.</Callout>'), ledger: emptyLedger }, policy);
      expect(scan.errors.some((error) => error.includes('enables no components at all'))).toBe(true);
      // A single-character element name is what a spread string used to admit.
      const single = validateSubmission({ mdx: mdxWith('<C>Body.</C>'), ledger: emptyLedger }, policy);
      expect(single.errors.some((error) => error.includes('is not a registered component'))).toBe(true);
    }
  });
});

describe('buildWriterSystemPrompt', () => {
  it('states the element rule the gate enforces: listed components only, literal props, no raw HTML', () => {
    const prompt = buildWriterSystemPrompt(promptInput(['Callout', 'Steps']));
    expect(prompt).toContain('You may use these MDX components and NO others: Callout, Steps.');
    expect(prompt).toContain('NO RAW HTML, EVER');
    expect(prompt).toContain('COMPONENT PROPS ARE PLAIN STRING LITERALS');
    expect(prompt).toContain('data-docstube');
  });

  it('teaches the STRUCTURED prop shape the gate accepts, with an example (wave 2b close)', () => {
    // PROMPT AND GATE IN LOCKSTEP, second axis: five registered components declare array/object
    // props that JSX can only spell as an expression. The gate accepts a static literal, so the
    // prompt must show that shape — otherwise the writer reads "plain string literals only",
    // hits a guaranteed repair loop on <Steps>, and quietly stops using half the registry.
    const prompt = buildWriterSystemPrompt(promptInput(['Steps', 'Tabs']));
    expect(prompt).toContain('STATIC LITERAL DATA');
    expect(prompt).toContain('<Tabs tabs={[{ label: "npm", value: "npm" }, { label: "pnpm", value: "pnpm" }]}');
    expect(prompt).toContain('function call (prop={getSteps()})');
    // The page-body expression ban is stated as exactly that, so it does not read as forbidding
    // the prop form the very next rule requires.
    expect(prompt).toContain('NO {…} EXPRESSIONS IN THE PAGE BODY');

    // The prompt's own example is authorable under the policy it describes.
    const policy = configElementPolicy({ components: ['Tabs'] });
    const example = validateSubmission(
      {
        mdx: mdxWith(
          '<Tabs tabs={[{ label: "npm", value: "npm" }, { label: "pnpm", value: "pnpm" }]} defaultValue="npm" />'
        ),
        ledger: emptyLedger
      },
      policy
    );
    expect(example.errors).toEqual([]);
  });

  it('tells a component-less project to use plain Markdown, matching the fail-closed policy', () => {
    expect(buildWriterSystemPrompt(promptInput([]))).toContain('no components are enabled for this project');
  });
});
