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
});

describe('buildWriterSystemPrompt', () => {
  it('states the element rule the gate enforces: listed components only, literal props, no raw HTML', () => {
    const prompt = buildWriterSystemPrompt(promptInput(['Callout', 'Steps']));
    expect(prompt).toContain('You may use these MDX components and NO others: Callout, Steps.');
    expect(prompt).toContain('NO RAW HTML, EVER');
    expect(prompt).toContain('COMPONENT PROPS ARE PLAIN STRING LITERALS');
    expect(prompt).toContain('data-docstube');
  });

  it('tells a component-less project to use plain Markdown, matching the fail-closed policy', () => {
    expect(buildWriterSystemPrompt(promptInput([]))).toContain('no components are enabled for this project');
  });
});
