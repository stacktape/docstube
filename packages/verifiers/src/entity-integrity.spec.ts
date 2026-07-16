import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { BlockTypeRegistry } from '@docstube/plugin-sdk';
import { entityIntegrityVerifier } from './entity-integrity.ts';
import { makeArtifact, makeBlock, makeContext, makePage, makeSection } from './test-support.ts';

const calloutRegistry: BlockTypeRegistry = {
  get: (blockType) =>
    blockType === 'component:Callout'
      ? { propsSchema: z.object({ kind: z.enum(['info', 'warning', 'danger']) }) }
      : undefined,
  list: () => ['component:Callout']
};

describe('entity-integrity', () => {
  it('passes a consistent page', async () => {
    const page = makePage({
      slug: 'guide',
      preamble: [makeBlock({ content: 'intro' })],
      sections: [makeSection({ anchor: 'usage', blocks: [makeBlock({ content: 'body' })] })]
    });

    const result = await entityIntegrityVerifier.verify(makeContext(), [makeArtifact(page, '# Guide\n')]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toEqual([page.id]);
  });

  it('fails on duplicate entity ids', async () => {
    const duplicated = makeBlock({ content: 'one' });
    const page = makePage({
      slug: 'guide',
      preamble: [duplicated, { ...makeBlock({ content: 'two' }), id: duplicated.id }]
    });

    const result = await entityIntegrityVerifier.verify(makeContext(), [makeArtifact(page, '# Guide\n')]);

    expect(result.status).toBe('fail');
    expect(result.findings[0]?.severity).toBe('error');
    expect(result.findings[0]?.message).toContain(duplicated.id);
  });

  it('fails on duplicate section anchors', async () => {
    const page = makePage({
      slug: 'guide',
      sections: [makeSection({ anchor: 'setup' }), makeSection({ anchor: 'setup' })]
    });

    const result = await entityIntegrityVerifier.verify(makeContext(), [makeArtifact(page, '# Guide\n')]);

    expect(result.status).toBe('fail');
    expect(result.findings[0]?.message).toContain('duplicate section anchor "setup"');
  });

  it('fails on an invalid block contentHash', async () => {
    const block = { ...makeBlock({ content: 'x' }), contentHash: 'not-a-sha256' };
    const page = makePage({ slug: 'guide', preamble: [block] });

    const result = await entityIntegrityVerifier.verify(makeContext(), [makeArtifact(page, '# Guide\n')]);

    expect(result.status).toBe('fail');
    expect(result.findings[0]?.message).toContain('invalid contentHash');
    expect(result.findings[0]?.entity?.entityId).toBe(block.id);
  });

  it('reports an unknown component block type as a warning that still passes', async () => {
    const block = makeBlock({ content: 'x', blockType: 'component:Foo', metadata: {} });
    const page = makePage({ slug: 'guide', preamble: [block] });

    const result = await entityIntegrityVerifier.verify(makeContext(calloutRegistry), [
      makeArtifact(page, '# Guide\n')
    ]);

    expect(result.status).toBe('pass');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('warning');
    expect(result.findings[0]?.message).toContain('unknown block type "component:Foo", guarantee capped');
  });

  it('fails component metadata that violates the registry schema and passes valid metadata', async () => {
    const invalid = makeBlock({ content: 'a', blockType: 'component:Callout', metadata: { kind: 'loud' } });
    const valid = makeBlock({ content: 'b', blockType: 'component:Callout', metadata: { kind: 'info' } });
    const page = makePage({ slug: 'guide', preamble: [invalid, valid] });

    const result = await entityIntegrityVerifier.verify(makeContext(calloutRegistry), [
      makeArtifact(page, '# Guide\n')
    ]);

    expect(result.status).toBe('fail');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('error');
    expect(result.findings[0]?.entity?.entityId).toBe(invalid.id);
    expect(result.findings[0]?.message).toContain('component:Callout');
  });
});
