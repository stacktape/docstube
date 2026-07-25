import { describe, expect, it } from 'vitest';
import { validateSubmission } from '@docstube/agent-runtime';
import { componentBlockType } from '@docstube/contracts';
import type { BlockEntity, PageEntity } from '@docstube/contracts';
import { configElementPolicy, createBlockRegistry, extractPageEntity } from '@docstube/core';
import { builtinComponentNames, builtinComponents } from '@docstube/theme';

// THE ORPHANED-COMPONENT REGRESSION GUARD (wave 2b close). The literal-props-only element policy
// accepted string literals and valueless booleans only, so EVERY registered component with a
// non-string prop — Steps, Tabs, FileTree, ParamTable, ComparisonTable (array/object props) and
// CardGrid (a numeric one) — was advertised to the writer in the prompt and in the submit_page
// descriptor while every authored use was rejected. The writer could only hit a repair loop and
// stop using them.
//
// A component is AUTHORABLE only when both ends agree, so this asserts both: submit_page accepts
// the authored form, AND the kernel's own extraction of that same MDX produces block metadata that
// validates against the component's registered props schema (what entity-integrity checks). The
// sample table must cover the registry exactly — a component added without an authorable form, or
// a policy change that orphans an existing one, fails here loudly.
//
// The CLI is where the three sides meet (agent-runtime's gate, core's extraction, theme's
// registry), which is why the guard lives here.

// A component that wraps children is authored as a BLOCK (its own lines) — that is the form MDX
// parses as a flow element, and therefore the form the kernel extracts as a component block.
const authoredForms: Record<string, string> = {
  Callout: '<Callout tone="warning" title="Heads up">\n  Read this first.\n</Callout>',
  CodeBlock: '<CodeBlock language="ts" title="Example" code="const x = 1;" />',
  CodeGroup: '<CodeGroup title="Install">\n  Alternatives below.\n</CodeGroup>',
  Terminal: '<Terminal command="docstube generate" output="Wrote 3 pages." title="Generate" />',
  Card: '<Card title="Quickstart" href="/docs/quickstart" description="Start here." />',
  CardGrid: '<CardGrid columns={3}>\n  Cards go here.\n</CardGrid>',
  Steps: '<Steps items={["Install the CLI", "Run docstube init", "Commit .docstube/"]} />',
  Tabs: '<Tabs tabs={[{ label: "npm", value: "npm" }, { label: "pnpm", value: "pnpm" }]} defaultValue="npm">\n  Panels.\n</Tabs>',
  FileTree: '<FileTree entries={[{ path: "src", kind: "directory" }, { path: "src/cli.ts", kind: "file" }]} />',
  Badge: '<Badge tone="success" label="stable">\n  stable\n</Badge>',
  ParamTable:
    '<ParamTable params={[{ name: "retries", type: "number", required: false, description: "Attempts before failing." }]} />',
  ComparisonTable:
    '<ComparisonTable columns={["Feature", "v1", "v2"]} rows={[["Retries", false, true], ["Timeout", 30, 60]]} />'
};

const pageMdx = (body: string): string =>
  `---\ntitle: "Components"\ndescription: "Authorable components."\n---\n\n# Components\n\n${body}\n`;

const allBlocks = (page: PageEntity): BlockEntity[] => [
  ...page.preamble,
  ...page.sections.flatMap((section) => section.blocks)
];

describe('registered component authorability', () => {
  it('covers the registry exactly — a component with no authorable form is a bug, not a missing test', () => {
    expect(Object.keys(authoredForms).toSorted()).toEqual(builtinComponentNames.toSorted());
  });

  it('accepts every registered component in at least one authored form, end to end', () => {
    const policy = configElementPolicy({ components: builtinComponentNames });
    const registry = createBlockRegistry(builtinComponents);

    for (const component of builtinComponents) {
      const body = authoredForms[component.name];
      expect(body, `no authored form for <${component.name}>`).toBeDefined();
      const mdx = pageMdx(body as string);

      // 1. The writer's gate accepts it.
      const submission = validateSubmission({ mdx, ledger: { schemaVersion: 1, claims: [] } }, policy);
      expect(submission.errors, `<${component.name}> rejected by submit_page`).toEqual([]);

      // 2. The kernel's extraction reads the same props the renderer will get, and they validate
      //    against the registered schema (the check entity-integrity runs on every page).
      const page = extractPageEntity({ mdx, slug: 'components' });
      const blockType = componentBlockType(component.name);
      const block = allBlocks(page).find((candidate) => candidate.blockType === blockType);
      expect(block, `<${component.name}> did not extract as ${blockType}`).toBeDefined();
      expect(registry.get(blockType)).toBeDefined();
      const props = registry.get(blockType)?.propsSchema.safeParse(block?.metadata ?? {});
      expect(
        props?.success ? [] : (props?.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ?? []),
        `<${component.name}> metadata does not match its props schema`
      ).toEqual([]);
    }
  });

  it('decodes structured props to real values, not raw expression text', () => {
    const mdx = pageMdx(authoredForms.Steps as string);
    const page = extractPageEntity({ mdx, slug: 'components' });
    const block = allBlocks(page).find((candidate) => candidate.blockType === componentBlockType('Steps'));
    expect(block?.metadata).toEqual({ items: ['Install the CLI', 'Run docstube init', 'Commit .docstube/'] });
  });

  it('keeps a computed prop out — an unreadable expression stays raw and fails schema validation', () => {
    const mdx = pageMdx('<Steps items={getSteps()} />');
    const policy = configElementPolicy({ components: builtinComponentNames });
    expect(
      validateSubmission({ mdx, ledger: { schemaVersion: 1, claims: [] } }, policy).errors.some((error) =>
        error.includes('a function call')
      )
    ).toBe(true);

    const page = extractPageEntity({ mdx, slug: 'components' });
    const block = allBlocks(page).find((candidate) => candidate.blockType === componentBlockType('Steps'));
    expect(block?.metadata).toEqual({ items: { $expression: 'getSteps()' } });
    const registry = createBlockRegistry(builtinComponents);
    expect(registry.get(componentBlockType('Steps'))?.propsSchema.safeParse(block?.metadata).success).toBe(false);
  });
});
