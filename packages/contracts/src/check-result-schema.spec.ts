import { describe, expect, it } from 'vitest';
import { checkResultSchema, checkStatuses } from './check-result-schema.ts';

describe('deterministic-check result taxonomy', () => {
  it('fixes the status taxonomy', () => {
    expect([...checkStatuses]).toEqual(['passed', 'failed', 'skipped', 'errored']);
  });

  it('requires findings on a failed result', () => {
    expect(checkResultSchema.safeParse({ checkId: 'mdx-compile', status: 'failed', findings: [] }).success).toBe(false);
  });

  it('requires a reason on a skipped result', () => {
    expect(checkResultSchema.safeParse({ checkId: 'python-snippet', status: 'skipped' }).success).toBe(false);
  });

  it('snapshots one result of each status', () => {
    const results = [
      checkResultSchema.parse({ checkId: 'mdx-compile', status: 'passed' }),
      checkResultSchema.parse({
        checkId: 'link-check',
        status: 'failed',
        findings: [
          {
            code: 'broken-internal-link',
            severity: 'major',
            origin: 'verifier',
            message: 'Link target /missing does not exist',
            pageId: 'guides/install',
            location: { path: 'docs/guides/install.mdx', line: 8 }
          }
        ]
      }),
      checkResultSchema.parse({ checkId: 'python-snippet', status: 'skipped', reason: 'pyright not installed' }),
      checkResultSchema.parse({ checkId: 'd2-render', status: 'errored', error: 'd2 binary not found' })
    ];

    expect(results).toMatchSnapshot();
  });
});
